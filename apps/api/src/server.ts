import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import { createDefaultCommandPolicy, LocalRepository, type CommandPolicy } from "@repo-watcher/core";
import { z } from "zod";
import { runAgentWithTools } from "./agent-orchestrator.js";
import { createEnvLlmClient, type LlmClient, type LlmUsage } from "./llm-client.js";
import { isManualCommand, runManualCommand, type UserLanguage } from "./manual-commands.js";
import { buildPatchPreview, hashContent } from "./patch-utils.js";
import { generateFileExplanation, generateRepoOverview } from "./repo-intelligence.js";
import { buildRepoGraph, type RepoGraph } from "./repo-graph.js";
import { getWebUiAsset, getWebUiHtml } from "./web-ui.js";

type SessionRecord = {
  id: string;
  repoPath: string;
  createdAt: string;
  usage: LlmUsage;
  graphCache?: {
    rootPath: string;
    maxNodes: number;
    graph: RepoGraph;
  };
};

const sessionStore = new Map<string, SessionRecord>();

type UsagePricing = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  usdToEur: number;
};

function parseBoundedNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const usagePricing: UsagePricing = {
  inputUsdPer1M: parseBoundedNumber(process.env.LLM_PRICE_INPUT_USD_PER_1M, 0.4, 0, 100),
  outputUsdPer1M: parseBoundedNumber(process.env.LLM_PRICE_OUTPUT_USD_PER_1M, 1.6, 0, 100),
  usdToEur: parseBoundedNumber(process.env.USD_TO_EUR, 0.92, 0.2, 2)
};

function emptyUsage(): LlmUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    requests: 0
  };
}

function mergeUsage(base: LlmUsage, delta: LlmUsage | null | undefined): LlmUsage {
  if (!delta) {
    return base;
  }
  const merged: LlmUsage = {
    inputTokens: Math.max(0, Math.round(base.inputTokens + (delta.inputTokens || 0))),
    outputTokens: Math.max(0, Math.round(base.outputTokens + (delta.outputTokens || 0))),
    totalTokens: Math.max(0, Math.round(base.totalTokens + (delta.totalTokens || 0))),
    requests: Math.max(0, Math.round(base.requests + (delta.requests || 0)))
  };
  if (delta.model) {
    merged.model = delta.model;
  } else if (base.model) {
    merged.model = base.model;
  }
  return merged;
}

function estimateUsageCostEur(usage: LlmUsage, pricing: UsagePricing): number {
  const usd =
    (usage.inputTokens / 1_000_000) * pricing.inputUsdPer1M +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPer1M;
  return Math.max(0, usd * pricing.usdToEur);
}

function usagePayload(usage: LlmUsage, pricing: UsagePricing) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    requests: usage.requests,
    costApproxEur: Number(estimateUsageCostEur(usage, pricing).toFixed(6))
  };
}

const languageSchema = z.enum(["fr", "en"]).optional().default("fr");

const createSessionSchema = z.object({
  repoPath: z.string().min(1)
});

const chatSchema = z.object({
  message: z.string().min(1),
  lang: languageSchema
});

const sessionIdParamsSchema = z.object({
  sessionId: z.string().uuid()
});

const uiAssetParamsSchema = z.object({
  asset: z.string().min(1).max(40)
});

const fileReadSchema = z.object({
  path: z.string().min(1).max(500)
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
  maxNodes: z.number().int().min(20).max(400).optional().default(180),
  lang: languageSchema
});

const explainFileSchema = z.object({
  path: z.string().min(1).max(500),
  rootPath: z.string().min(1).max(500).optional().default("."),
  maxNodes: z.number().int().min(20).max(400).optional().default(220),
  trailPaths: z.array(z.string().min(1).max(500)).max(12).optional().default([]),
  lang: languageSchema
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

function patchAccessToken(): string | null {
  const raw = process.env.REPO_WATCHER_PATCH_TOKEN;
  if (!raw) {
    return null;
  }
  const token = raw.trim();
  return token.length > 0 ? token : null;
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return typeof value === "string" ? value : "";
}

function isPatchRequestAuthorized(headers: {
  authorization?: string | string[];
  "x-repo-watcher-token"?: string | string[];
}): boolean {
  const requiredToken = patchAccessToken();
  if (!requiredToken) {
    return true;
  }

  const directToken = normalizeHeaderValue(headers["x-repo-watcher-token"]);
  if (directToken === requiredToken) {
    return true;
  }

  const authorization = normalizeHeaderValue(headers.authorization);
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() === requiredToken;
  }

  return false;
}

async function getOrBuildGraph(
  session: SessionRecord,
  repository: LocalRepository,
  rootPath: string,
  maxNodes: number
): Promise<RepoGraph> {
  const cache = session.graphCache;
  if (cache && cache.rootPath === rootPath && cache.maxNodes === maxNodes) {
    return cache.graph;
  }

  const graph = await buildRepoGraph(repository, rootPath, maxNodes);
  session.graphCache = { rootPath, maxNodes, graph };
  return graph;
}

function invalidateSessionGraphCache(session: SessionRecord): void {
  session.graphCache = undefined;
}

async function runAssistantMessage(
  repository: LocalRepository,
  message: string,
  llmClient: LlmClient | null,
  commandPolicy: CommandPolicy,
  language: UserLanguage,
  onReplyDelta?: (chunk: string) => void
): Promise<{ reply: string; mode: "manual" | "agent"; steps: unknown[]; usage: LlmUsage }> {
  if (isManualCommand(message)) {
    const reply = await runManualCommand(repository, message, commandPolicy, language);
    if (onReplyDelta) {
      onReplyDelta(reply);
    }
    return { reply, mode: "manual", steps: [], usage: emptyUsage() };
  }

  if (!llmClient) {
    const noLlmMessage =
      language === "en"
        ? [
            "LLM mode is not configured.",
            "Set LLM_API_KEY + LLM_MODEL + LLM_BASE_URL to enable autonomous agent mode.",
            "Meanwhile, use /help for manual commands."
          ]
        : [
            "Mode LLM non configure.",
            "Configure LLM_API_KEY + LLM_MODEL + LLM_BASE_URL pour activer l'agent autonome.",
            "En attendant, utilise /help pour les commandes manuelles."
          ];
    const reply = noLlmMessage.join("\n");
    if (onReplyDelta) {
      onReplyDelta(reply);
    }
    return {
      reply,
      mode: "manual",
      steps: [],
      usage: emptyUsage()
    };
  }

  const result = await runAgentWithTools(
    repository,
    message,
    llmClient,
    commandPolicy,
    language,
    onReplyDelta
  );
  return {
    reply: result.reply,
    mode: "agent",
    steps: result.steps,
    usage: result.usage
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

  fastify.get("/ui/:asset", async (request, reply) => {
    const params = uiAssetParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid UI asset path" });
    }

    const asset = getWebUiAsset(params.data.asset);
    if (!asset) {
      return reply.status(404).send({ error: "UI asset not found" });
    }

    reply.type(asset.contentType);
    return asset.content;
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
      createdAt: new Date().toISOString(),
      usage: emptyUsage()
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
        commandPolicy,
        body.data.lang
      );
      session.usage = mergeUsage(session.usage, assistant.usage);
      return {
        sessionId: session.id,
        mode: assistant.mode,
        steps: assistant.steps,
        reply: assistant.reply,
        usage: usagePayload(assistant.usage, usagePricing),
        sessionUsage: usagePayload(session.usage, usagePricing)
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
    writeEvent({
      type: "meta",
      sessionId: session.id,
      mode: "starting"
    });

    try {
      const repository = await LocalRepository.open(session.repoPath);
      let emittedAnyDelta = false;
      const assistant = await runAssistantMessage(
        repository,
        body.data.message,
        llmClient,
        commandPolicy,
        body.data.lang,
        (chunk) => {
          if (!chunk) {
            return;
          }
          emittedAnyDelta = true;
          writeEvent({
            type: "delta",
            text: chunk
          });
        }
      );
      session.usage = mergeUsage(session.usage, assistant.usage);

      writeEvent({
        type: "meta",
        sessionId: session.id,
        mode: assistant.mode,
        usage: usagePayload(assistant.usage, usagePricing)
      });

      if (!emittedAnyDelta && assistant.reply) {
        writeEvent({
          type: "delta",
          text: assistant.reply
        });
      }

      writeEvent({
        type: "done",
        steps: assistant.steps,
        usage: usagePayload(assistant.usage, usagePricing),
        sessionUsage: usagePayload(session.usage, usagePricing)
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
    if (!isPatchRequestAuthorized(request.headers)) {
      return reply.status(403).send({
        error: "Patch endpoint is protected",
        details: "Provide x-repo-watcher-token or Authorization: Bearer <token>."
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
        invalidateSessionGraphCache(session);
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
      const graph = await getOrBuildGraph(session, repository, body.data.rootPath, body.data.maxNodes);
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
      const graph = await getOrBuildGraph(session, repository, body.data.rootPath, body.data.maxNodes);
      const overview = await generateRepoOverview(repository, llmClient, graph, body.data.lang);
      session.usage = mergeUsage(session.usage, overview.usage);
      return {
        sessionId: session.id,
        mode: overview.mode,
        summary: graph.summary,
        overview: overview.overview,
        usage: usagePayload(overview.usage ?? emptyUsage(), usagePricing),
        sessionUsage: usagePayload(session.usage, usagePricing)
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
      const graph = await getOrBuildGraph(session, repository, body.data.rootPath, body.data.maxNodes);

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
        body.data.trailPaths,
        body.data.lang
      );
      session.usage = mergeUsage(session.usage, explained.usage);

      return {
        sessionId: session.id,
        path: body.data.path,
        mode: explained.mode,
        explanation: explained.explanation,
        usage: usagePayload(explained.usage ?? emptyUsage(), usagePricing),
        sessionUsage: usagePayload(session.usage, usagePricing)
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
