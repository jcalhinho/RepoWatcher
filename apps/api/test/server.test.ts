import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LlmClient, LlmMessage } from "../src/llm-client.js";
import { buildServer } from "../src/server.js";

class FakeLlmClient implements LlmClient {
  private readonly outputs: string[];
  private index = 0;

  constructor(outputs: string[]) {
    this.outputs = outputs;
  }

  async complete(_messages: LlmMessage[]): Promise<string> {
    const current = this.outputs[this.index];
    this.index += 1;
    if (!current) {
      return JSON.stringify({ final: "No fake output left." });
    }
    return current;
  }
}

const serversToClose: Array<Awaited<ReturnType<typeof buildServer>>> = [];

afterEach(async () => {
  while (serversToClose.length > 0) {
    const server = serversToClose.pop();
    if (server) {
      await server.close();
    }
  }
});

async function createLocalRepoFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repo-watcher-api-test-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "intro.md"), "# Hello\n", "utf8");
  await writeFile(path.join(root, "README.md"), "Fixture README\n", "utf8");
  return root;
}

async function createGraphRepoFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repo-watcher-graph-test-"));
  await mkdir(path.join(root, "frontend", "src"), { recursive: true });
  await writeFile(
    path.join(root, "frontend", "src", "main.ts"),
    "import { helper } from './utils';\nconsole.log(helper());\n",
    "utf8"
  );
  await writeFile(
    path.join(root, "frontend", "src", "utils.ts"),
    "export function helper() { return 42; }\n",
    "utf8"
  );
  return root;
}

describe("API chat modes", () => {
  it("serves the web UI shell on root route", async () => {
    const server = await buildServer();
    serversToClose.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("RepoWatcher Local UI");
  });

  it("returns manual mode for slash commands", async () => {
    const repoPath = await createLocalRepoFixture();
    const server = await buildServer();
    serversToClose.push(server);

    const sessionResponse = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repoPath }
    });

    const sessionPayload = sessionResponse.json() as { id: string };
    const chatResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/chat`,
      payload: { message: "/help" }
    });

    expect(chatResponse.statusCode).toBe(200);
    const chatPayload = chatResponse.json() as {
      mode: string;
      reply: string;
      steps: unknown[];
    };
    expect(chatPayload.mode).toBe("manual");
    expect(chatPayload.steps).toHaveLength(0);
    expect(chatPayload.reply).toContain("Commandes disponibles");
  });

  it("runs agent mode with tool calls when LLM is configured", async () => {
    const repoPath = await createLocalRepoFixture();
    const fakeLlm = new FakeLlmClient([
      JSON.stringify({ action: { tool: "list", input: "docs" } }),
      JSON.stringify({ final: "Le dossier docs contient intro.md." })
    ]);

    const server = await buildServer({ llmClient: fakeLlm });
    serversToClose.push(server);

    const sessionResponse = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repoPath }
    });

    const sessionPayload = sessionResponse.json() as { id: string };
    const chatResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/chat`,
      payload: { message: "liste le contenu du dossier docs" }
    });

    expect(chatResponse.statusCode).toBe(200);
    const chatPayload = chatResponse.json() as {
      mode: string;
      reply: string;
      steps: Array<{ tool: string; input: string }>;
    };
    expect(chatPayload.mode).toBe("agent");
    expect(chatPayload.steps).toHaveLength(1);
    expect(chatPayload.steps[0]).toMatchObject({ tool: "list", input: "docs" });
    expect(chatPayload.reply).toContain("docs");
  });

  it("streams chat response as ndjson events", async () => {
    const repoPath = await createLocalRepoFixture();
    const server = await buildServer();
    serversToClose.push(server);

    const sessionResponse = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repoPath }
    });
    const sessionPayload = sessionResponse.json() as { id: string };

    const streamResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/chat/stream`,
      payload: { message: "/help" }
    });

    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers["content-type"]).toContain("application/x-ndjson");

    const events = streamResponse.body
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { type: string; mode?: string; text?: string });

    expect(events.length).toBeGreaterThan(2);
    expect(events[0]).toMatchObject({ type: "meta", mode: "manual" });
    expect(events.some((event) => event.type === "delta" && (event.text || "").length > 0)).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("reads file content for supervised patch flow", async () => {
    const repoPath = await createLocalRepoFixture();
    const server = await buildServer();
    serversToClose.push(server);

    const sessionResponse = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repoPath }
    });
    const sessionPayload = sessionResponse.json() as { id: string };

    const fileResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/file/read`,
      payload: { path: "README.md" }
    });

    expect(fileResponse.statusCode).toBe(200);
    const filePayload = fileResponse.json() as { content: string; contentHash: string };
    expect(filePayload.content).toContain("Fixture README");
    expect(filePayload.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("previews and applies a patch with optimistic hash check", async () => {
    const repoPath = await createLocalRepoFixture();
    const server = await buildServer();
    serversToClose.push(server);

    const sessionResponse = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repoPath }
    });
    const sessionPayload = sessionResponse.json() as { id: string };

    const newContent = "Fixture README patched\\n";
    const previewResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/apply_patch`,
      payload: {
        path: "README.md",
        newContent,
        apply: false
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    const previewPayload = previewResponse.json() as {
      applied: boolean;
      oldHash: string;
      newHash: string;
      preview: { summary: string };
    };
    expect(previewPayload.applied).toBe(false);
    expect(previewPayload.oldHash).toMatch(/^[a-f0-9]{64}$/);
    expect(previewPayload.newHash).toMatch(/^[a-f0-9]{64}$/);
    expect(previewPayload.preview.summary).toBe("Change detected.");

    const applyResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/apply_patch`,
      payload: {
        path: "README.md",
        newContent,
        expectedOldHash: previewPayload.oldHash,
        apply: true
      }
    });
    expect(applyResponse.statusCode).toBe(200);
    const applyPayload = applyResponse.json() as { applied: boolean };
    expect(applyPayload.applied).toBe(true);

    const diskContent = await readFile(path.join(repoPath, "README.md"), "utf8");
    expect(diskContent).toBe(newContent);
  });

  it("builds a react-flow compatible repo graph", async () => {
    const repoPath = await createGraphRepoFixture();
    const server = await buildServer();
    serversToClose.push(server);

    const sessionResponse = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repoPath }
    });
    const sessionPayload = sessionResponse.json() as { id: string };

    const graphResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/repo_graph`,
      payload: {
        rootPath: "frontend/src",
        maxNodes: 120
      }
    });

    expect(graphResponse.statusCode).toBe(200);
    const graphPayload = graphResponse.json() as {
      summary: { nodeCount: number; edgeCount: number };
      nodes: Array<{ id: string; data: { path: string } }>;
      edges: Array<{ source: string; target: string }>;
    };

    expect(graphPayload.summary.nodeCount).toBeGreaterThanOrEqual(2);
    expect(graphPayload.nodes.some((node) => node.id === "frontend/src/main.ts")).toBe(true);
    expect(graphPayload.nodes.some((node) => node.id === "frontend/src/utils.ts")).toBe(true);
    expect(
      graphPayload.edges.some(
        (edge) =>
          edge.source === "frontend/src/main.ts" && edge.target === "frontend/src/utils.ts"
      )
    ).toBe(true);
  });

  it("returns auto-scan repo overview", async () => {
    const repoPath = await createGraphRepoFixture();
    const server = await buildServer();
    serversToClose.push(server);

    const sessionResponse = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repoPath }
    });
    const sessionPayload = sessionResponse.json() as { id: string };

    const overviewResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/repo_overview`,
      payload: {
        rootPath: "frontend/src",
        maxNodes: 120
      }
    });

    expect(overviewResponse.statusCode).toBe(200);
    const overviewPayload = overviewResponse.json() as {
      mode: string;
      overview: {
        overview: string;
        directoryNotes: string[];
        entryPoints: string[];
        suggestedCommands: string[];
      };
    };
    expect(overviewPayload.mode).toBe("heuristic");
    expect(overviewPayload.overview.overview).toContain("Scan initial termine");
    expect(Array.isArray(overviewPayload.overview.directoryNotes)).toBe(true);
  });

  it("explains a clicked file with interactions and utility", async () => {
    const repoPath = await createGraphRepoFixture();
    const server = await buildServer();
    serversToClose.push(server);

    const sessionResponse = await server.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { repoPath }
    });
    const sessionPayload = sessionResponse.json() as { id: string };

    const explainResponse = await server.inject({
      method: "POST",
      url: `/api/sessions/${sessionPayload.id}/explain_file`,
      payload: {
        path: "frontend/src/main.ts",
        rootPath: "frontend/src",
        maxNodes: 120
      }
    });

    expect(explainResponse.statusCode).toBe(200);
    const explainPayload = explainResponse.json() as {
      mode: string;
      explanation: {
        overview: string;
        utilityInApp: string;
        interactions: string[];
      };
    };
    expect(explainPayload.mode).toBe("heuristic");
    expect(explainPayload.explanation.overview.length).toBeGreaterThan(0);
    expect(explainPayload.explanation.utilityInApp.length).toBeGreaterThan(0);
    expect(explainPayload.explanation.interactions.length).toBeGreaterThan(0);
  });
});
