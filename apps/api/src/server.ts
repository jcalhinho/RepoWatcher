import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import { createDefaultCommandPolicy, LocalRepository, type CommandPolicy } from "@repo-watcher/core";
import { z } from "zod";
import { runAgentWithTools } from "./agent-orchestrator.js";
import { createEnvLlmClient, type LlmClient } from "./llm-client.js";
import { isManualCommand, runManualCommand } from "./manual-commands.js";
import { openFileInEditor } from "./file-opener.js";
import { buildPatchPreview, hashContent } from "./patch-utils.js";
import { generateFileExplanation, generateRepoOverview } from "./repo-intelligence.js";
import { buildRepoGraph } from "./repo-graph.js";
import { getWebUiHtml } from "./web-ui.js";

type SessionRecord = {
  id: string;
  repoPath: string;
  createdAt: string;
};

const sessionStore = new Map<string, SessionRecord>();

const createSessionSchema = z.object({
  repoPath: z.string().min(1)
});

const chatSchema = z.object({
  message: z.string().min(1)
});

const sessionIdParamsSchema = z.object({
  sessionId: z.string().uuid()
});

const fileReadSchema = z.object({
  path: z.string().min(1).max(500)
});

const fileOpenSchema = z.object({
  path: z.string().min(1).max(500),
  line: z.number().int().min(1).max(1_000_000).optional().default(1),
  column: z.number().int().min(1).max(1_000_000).optional().default(1),
  dryRun: z.boolean().optional().default(false)
});

const applyPatchSchema = z.object({
  path: z.string().min(1).max(500),
  newContent: z.string().max(1_000_000),
  expectedOldHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  apply: z.boolean().optional().default(false)
});

const repoGraphSchema = z.object({
  rootPath: z.string().min(1).max(500).optional().default("."),
  maxNodes: z.number().int().min(20).max(400).optional().default(180)
});

const explainFileSchema = z.object({
  path: z.string().min(1).max(500),
  rootPath: z.string().min(1).max(500).optional().default("."),
  maxNodes: z.number().int().min(20).max(400).optional().default(220),
  trailPaths: z.array(z.string().min(1).max(500)).max(12).optional().default([])
});

export type BuildServerOptions = {
  llmClient?: LlmClient | null;
  commandPolicy?: CommandPolicy;
};

function clampPreview(content: string, maxChars = 12_000): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n...[truncated]`;
}

function splitReplyForStream(reply: string, chunkSize = 48): string[] {
  if (!reply) {
    return [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < reply.length; index += chunkSize) {
    chunks.push(reply.slice(index, index + chunkSize));
  }
  return chunks;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAssistantMessage(
  repository: LocalRepository,
  message: string,
  llmClient: LlmClient | null,
  commandPolicy: CommandPolicy
): Promise<{ reply: string; mode: "manual" | "agent"; steps: unknown[] }> {
  if (isManualCommand(message)) {
    const reply = await runManualCommand(repository, message, commandPolicy);
    return { reply, mode: "manual", steps: [] };
  }

  if (!llmClient) {
    return {
      reply: [
        "Mode LLM non configure.",
        "Configure LLM_API_KEY + LLM_MODEL + LLM_BASE_URL pour activer l'agent autonome.",
        "En attendant, utilise /help pour les commandes manuelles."
      ].join("\n"),
      mode: "manual",
      steps: []
    };
  }

  const result = await runAgentWithTools(repository, message, llmClient, commandPolicy);
  return {
    reply: result.reply,
    mode: "agent",
    steps: result.steps
  };
}

export async function buildServer(options: BuildServerOptions = {}) {
  const fastify = Fastify({
    logger: true
  });
  const llmClient = options.llmClient ?? createEnvLlmClient();
  const commandPolicy = options.commandPolicy ?? createDefaultCommandPolicy();

  fastify.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return getWebUiHtml();
  });

  fastify.get("/health", async () => ({ status: "ok" }));

  fastify.post("/api/sessions", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten()
      });
    }

    const repoPath = path.resolve(parsed.data.repoPath);
    try {
      await LocalRepository.open(repoPath);
    } catch (error) {
      return reply.status(400).send({
        error: "Invalid repo path",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }

    const id = randomUUID();
    const record: SessionRecord = {
      id,
      repoPath,
      createdAt: new Date().toISOString()
    };
    sessionStore.set(id, record);

    return reply.status(201).send(record);
  });

  fastify.post("/api/sessions/:sessionId/chat", async (request, reply) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid session ID"
      });
    }

    const body = chatSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten()
      });
    }

    const session = sessionStore.get(params.data.sessionId);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found"
      });
    }

    try {
      const repository = await LocalRepository.open(session.repoPath);
      const assistant = await runAssistantMessage(
        repository,
        body.data.message,
        llmClient,
        commandPolicy
      );
      return {
        sessionId: session.id,
        mode: assistant.mode,
        steps: assistant.steps,
        reply: assistant.reply
      };
    } catch (error) {
      return reply.status(500).send({
        error: "Assistant command failed",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  fastify.post("/api/sessions/:sessionId/chat/stream", async (request, reply) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid session ID"
      });
    }

    const body = chatSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten()
      });
    }

    const session = sessionStore.get(params.data.sessionId);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found"
      });
    }

    const writeEvent = (event: Record<string, unknown>) => {
      reply.raw.write(`${JSON.stringify(event)}\n`);
    };

    reply.raw.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();

    try {
      const repository = await LocalRepository.open(session.repoPath);
      const assistant = await runAssistantMessage(
        repository,
        body.data.message,
        llmClient,
        commandPolicy
      );

      writeEvent({
        type: "meta",
        sessionId: session.id,
        mode: assistant.mode
      });

      for (const chunk of splitReplyForStream(assistant.reply)) {
        writeEvent({
          type: "delta",
          text: chunk
        });
        await sleep(12);
      }

      writeEvent({
        type: "done",
        steps: assistant.steps
      });
    } catch (error) {
      writeEvent({
        type: "error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    } finally {
      reply.raw.end();
    }

    return reply;
  });

  fastify.post("/api/sessions/:sessionId/file/read", async (request, reply) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid session ID"
      });
    }

    const body = fileReadSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten()
      });
    }

    const session = sessionStore.get(params.data.sessionId);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found"
      });
    }

    try {
      const repository = await LocalRepository.open(session.repoPath);
      const content = await repository.readTextFile(body.data.path, 1_000_000);
      return {
        sessionId: session.id,
        path: body.data.path,
        content,
        contentHash: hashContent(content)
      };
    } catch (error) {
      return reply.status(400).send({
        error: "Cannot read file",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  fastify.post("/api/sessions/:sessionId/file/open", async (request, reply) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid session ID"
      });
    }

    const body = fileOpenSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten()
      });
    }

    const session = sessionStore.get(params.data.sessionId);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found"
      });
    }

    try {
      const openResult = await openFileInEditor(session.repoPath, body.data.path, {
        line: body.data.line,
        column: body.data.column,
        dryRun: body.data.dryRun
      });

      return {
        sessionId: session.id,
        path: body.data.path,
        ...openResult
      };
    } catch (error) {
      return reply.status(400).send({
        error: "Cannot open file",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  fastify.post("/api/sessions/:sessionId/apply_patch", async (request, reply) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid session ID"
      });
    }

    const body = applyPatchSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten()
      });
    }

    const session = sessionStore.get(params.data.sessionId);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found"
      });
    }

    try {
      const repository = await LocalRepository.open(session.repoPath);
      let oldContent = "";
      let fileExisted = true;
      try {
        oldContent = await repository.readTextFile(body.data.path, 1_000_000);
      } catch (error) {
        const isNotFound =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "ENOENT";
        if (!isNotFound) {
          throw error;
        }
        fileExisted = false;
      }
      const oldHash = hashContent(oldContent);

      if (body.data.expectedOldHash && body.data.expectedOldHash !== oldHash) {
        return reply.status(409).send({
          error: "File changed since last preview",
          expectedOldHash: body.data.expectedOldHash,
          actualOldHash: oldHash
        });
      }

      const preview = buildPatchPreview(oldContent, body.data.newContent);
      const newHash = hashContent(body.data.newContent);

      if (body.data.apply) {
        await repository.writeTextFile(body.data.path, body.data.newContent);
      }

      return {
        sessionId: session.id,
        path: body.data.path,
        fileExisted,
        applied: body.data.apply,
        oldHash,
        newHash,
        beforePreview: clampPreview(oldContent),
        afterPreview: clampPreview(body.data.newContent),
        preview
      };
    } catch (error) {
      return reply.status(400).send({
        error: "Cannot apply patch",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  fastify.post("/api/sessions/:sessionId/repo_graph", async (request, reply) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid session ID"
      });
    }

    const body = repoGraphSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten()
      });
    }

    const session = sessionStore.get(params.data.sessionId);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found"
      });
    }

    try {
      const repository = await LocalRepository.open(session.repoPath);
      const graph = await buildRepoGraph(
        repository,
        body.data.rootPath,
        body.data.maxNodes
      );
      return {
        sessionId: session.id,
        ...graph
      };
    } catch (error) {
      return reply.status(400).send({
        error: "Cannot build repo graph",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  fastify.post("/api/sessions/:sessionId/repo_overview", async (request, reply) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid session ID"
      });
    }

    const body = repoGraphSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten()
      });
    }

    const session = sessionStore.get(params.data.sessionId);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found"
      });
    }

    try {
      const repository = await LocalRepository.open(session.repoPath);
      const graph = await buildRepoGraph(
        repository,
        body.data.rootPath,
        body.data.maxNodes
      );
      const overview = await generateRepoOverview(repository, llmClient, graph);
      return {
        sessionId: session.id,
        mode: overview.mode,
        summary: graph.summary,
        overview: overview.overview
      };
    } catch (error) {
      return reply.status(400).send({
        error: "Cannot generate repo overview",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  fastify.post("/api/sessions/:sessionId/explain_file", async (request, reply) => {
    const params = sessionIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "Invalid session ID"
      });
    }

    const body = explainFileSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: body.error.flatten()
      });
    }

    const session = sessionStore.get(params.data.sessionId);
    if (!session) {
      return reply.status(404).send({
        error: "Session not found"
      });
    }

    try {
      const repository = await LocalRepository.open(session.repoPath);
      const graph = await buildRepoGraph(
        repository,
        body.data.rootPath,
        body.data.maxNodes
      );

      const fileExists = graph.nodes.some((node) => node.data.path === body.data.path);
      if (!fileExists) {
        return reply.status(404).send({
          error: "File not found in current graph scope",
          details: body.data.path
        });
      }

      const explained = await generateFileExplanation(
        repository,
        llmClient,
        body.data.path,
        graph,
        body.data.trailPaths
      );

      return {
        sessionId: session.id,
        path: body.data.path,
        mode: explained.mode,
        explanation: explained.explanation
      };
    } catch (error) {
      return reply.status(400).send({
        error: "Cannot explain file",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return fastify;
}

async function start() {
  const server = await buildServer({});
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  await server.listen({ port, host });
}

const currentModulePath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentModulePath) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
