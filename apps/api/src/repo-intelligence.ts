import path from "node:path";
import { LocalRepository } from "@repo-watcher/core";
import { z } from "zod";
import type { LlmClient } from "./llm-client.js";
import { buildRepoGraph, type RepoGraph } from "./repo-graph.js";

const MAX_FILE_EXPLAIN_CHARS = 24_000;
const MAX_README_CHARS = 6_000;

const fileExplainSchema = z.object({
  overview: z.string().min(1),
  utilityInApp: z.string().min(1),
  whyInFlow: z.string().min(1),
  interactions: z.array(z.string()).default([]),
  keyFunctions: z.array(z.string()).default([]),
  keyVariables: z.array(z.string()).default([]),
  imports: z.array(z.string()).default([]),
  exports: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium")
});

const repoOverviewSchema = z.object({
  overview: z.string().min(1),
  directoryNotes: z.array(z.string()).default([]),
  entryPoints: z.array(z.string()).default([]),
  suggestedCommands: z.array(z.string()).default([])
});

type FileExplainPayload = z.output<typeof fileExplainSchema>;
type RepoOverviewPayload = z.output<typeof repoOverviewSchema>;

function normalizeFileExplain(payload: {
  overview: string;
  utilityInApp: string;
  whyInFlow?: string;
  interactions?: string[];
  keyFunctions?: string[];
  keyVariables?: string[];
  imports?: string[];
  exports?: string[];
  risks?: string[];
  confidence?: "low" | "medium" | "high";
}): FileExplainPayload {
  return {
    overview: payload.overview,
    utilityInApp: payload.utilityInApp,
    whyInFlow: payload.whyInFlow ?? "Pas de contexte de parcours fourni.",
    interactions: payload.interactions ?? [],
    keyFunctions: payload.keyFunctions ?? [],
    keyVariables: payload.keyVariables ?? [],
    imports: payload.imports ?? [],
    exports: payload.exports ?? [],
    risks: payload.risks ?? [],
    confidence: payload.confidence ?? "medium"
  };
}

function normalizeRepoOverview(payload: {
  overview: string;
  directoryNotes?: string[];
  entryPoints?: string[];
  suggestedCommands?: string[];
}): RepoOverviewPayload {
  return {
    overview: payload.overview,
    directoryNotes: payload.directoryNotes ?? [],
    entryPoints: payload.entryPoints ?? [],
    suggestedCommands: payload.suggestedCommands ?? []
  };
}

function clamp(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n...[truncated]`;
}

function extensionOf(filePath: string): string {
  return path.posix.extname(filePath).toLowerCase();
}

function safeBaseName(filePath: string): string {
  return path.posix.basename(filePath);
}

function extractFirstJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  if (start < 0) {
    throw new Error("No JSON object found in LLM output");
  }

  let depth = 0;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  throw new Error("Unterminated JSON object in LLM output");
}

async function llmJson<T>(
  llmClient: LlmClient,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>
): Promise<T> {
  const raw = await llmClient.complete([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ]);
  const parsed = JSON.parse(extractFirstJsonObject(raw));
  return schema.parse(parsed);
}

function summarizeEdge(graph: RepoGraph, filePath: string): string[] {
  const outgoing = graph.edges
    .filter((edge) => edge.source === filePath && edge.data.kind === "import")
    .map((edge) => `importe -> ${edge.target}`);
  const incoming = graph.edges
    .filter((edge) => edge.target === filePath && edge.data.kind === "import")
    .map((edge) => `utilise par <- ${edge.source}`);
  return [...outgoing, ...incoming].slice(0, 20);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

type CodeSignals = {
  keyFunctions: string[];
  keyVariables: string[];
  imports: string[];
  exports: string[];
};

function collectMatches(content: string, pattern: RegExp): string[] {
  const values: string[] = [];
  let match = pattern.exec(content);
  while (match) {
    if (match[1]) {
      values.push(match[1].trim());
    }
    match = pattern.exec(content);
  }
  return values;
}

function collectCodeSignals(filePath: string, content: string): CodeSignals {
  const ext = extensionOf(filePath);
  const isPython = ext === ".py";

  const imports = isPython
    ? unique([
        ...collectMatches(content, /^\s*from\s+([a-zA-Z0-9_\.]+)\s+import\s+/gm),
        ...collectMatches(content, /^\s*import\s+([a-zA-Z0-9_\.]+)/gm)
      ]).slice(0, 12)
    : unique([
        ...collectMatches(content, /\bimport\s+(?:[^"']*from\s+)?["']([^"']+)["']/g),
        ...collectMatches(content, /\brequire\(\s*["']([^"']+)["']\s*\)/g)
      ]).slice(0, 12);

  const exports = isPython
    ? unique(collectMatches(content, /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)).slice(0, 10)
    : unique(
        [
          ...collectMatches(
            content,
            /\bexport\s+(?:async\s+)?(?:function|const|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g
          ),
          ...collectMatches(content, /\bmodule\.exports\.(\w+)/g)
        ].filter(Boolean)
      ).slice(0, 10);

  const keyFunctions = isPython
    ? unique([
        ...collectMatches(content, /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm),
        ...collectMatches(content, /^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm)
      ]).slice(0, 12)
    : unique([
        ...collectMatches(content, /\b(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g),
        ...collectMatches(
          content,
          /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g
        ),
        ...collectMatches(content, /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g)
      ]).slice(0, 12);

  const keyVariables = isPython
    ? unique(collectMatches(content, /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gm)).slice(0, 12)
    : unique(collectMatches(content, /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g)).slice(
        0,
        12
      );

  return {
    keyFunctions,
    keyVariables,
    imports,
    exports
  };
}

function buildFlowNarrative(
  filePath: string,
  interactions: string[],
  trailPaths: string[]
): string {
  if (trailPaths.length === 0) {
    return "Point de depart de l'exploration. Clique ensuite sur les fichiers relies pour suivre le parcours technique.";
  }

  const previous = trailPaths[trailPaths.length - 1];
  if (!previous || previous === filePath) {
    return "Tu restes sur le meme fichier pour approfondir les details internes.";
  }

  const linkedFromPrevious = interactions.some((item) => item.includes(previous));
  if (linkedFromPrevious) {
    return `Transition depuis ${previous} -> ${filePath}: ce passage est relie dans le graphe d'import et aide a suivre le flux applicatif.`;
  }

  return `Fichier selectionne apres ${previous}. Le lien n'est pas direct dans les imports locaux, mais il peut representer une etape fonctionnelle du parcours utilisateur.`;
}

function heuristicFileExplain(
  filePath: string,
  content: string,
  interactions: string[],
  trailPaths: string[]
): FileExplainPayload {
  const lines = content.split(/\r?\n/);
  const ext = extensionOf(filePath);
  const looksApiRoute = /(route|router|controller|endpoint)/i.test(filePath + content.slice(0, 4000));
  const looksConfig = /(config|settings|env)/i.test(filePath + content.slice(0, 3000));
  const looksService = /(service|manager|client)/i.test(filePath + content.slice(0, 3000));
  const signals = collectCodeSignals(filePath, content);

  let utility = "Fichier de support dans l'application.";
  if (looksApiRoute) {
    utility = "Expose des endpoints ou des routes et connecte la couche HTTP au coeur applicatif.";
  } else if (looksConfig) {
    utility = "Centralise la configuration (environnement, options runtime, parametres).";
  } else if (looksService) {
    utility = "Contient la logique metier ou l'integration avec des services externes.";
  } else if (ext === ".tsx" || ext === ".jsx") {
    utility = "Definit une vue/composant UI dans l'application frontend.";
  } else if (ext === ".py") {
    utility = "Participe au backend Python (API, modele, services ou utilitaires).";
  }

  return {
    overview: `${safeBaseName(filePath)} contient ${lines.length} lignes et semble orienté ${utility.toLowerCase()}`,
    utilityInApp: utility,
    whyInFlow: buildFlowNarrative(filePath, interactions, trailPaths),
    interactions:
      interactions.length > 0
        ? interactions
        : ["Aucune interaction locale detectee dans le graphe courant."],
    keyFunctions: signals.keyFunctions,
    keyVariables: signals.keyVariables,
    imports: signals.imports,
    exports: signals.exports,
    risks: [
      "Verifier la couverture de tests autour des points d'entree critiques.",
      "Verifier la validation des entrees si ce fichier traite des donnees externes."
    ],
    confidence: interactions.length > 0 ? "medium" : "low"
  };
}

function heuristicRepoOverview(graph: RepoGraph): RepoOverviewPayload {
  const directoryCount = new Map<string, number>();
  const entries: string[] = [];

  for (const node of graph.nodes) {
    const dir = node.data.directory || ".";
    directoryCount.set(dir, (directoryCount.get(dir) ?? 0) + 1);
    if (/(main|index|app|server|routes|router|config)\./i.test(node.data.label)) {
      entries.push(node.data.path);
    }
  }

  const topDirectories = [...directoryCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([dir, count]) => `${dir}: ${count} fichiers`);

  return {
    overview: `Scan initial termine: ${graph.summary.nodeCount} fichiers source et ${graph.summary.edgeCount} interactions locales detectees.`,
    directoryNotes: topDirectories,
    entryPoints: Array.from(new Set(entries)).slice(0, 10),
    suggestedCommands: ["/run ls -la", "/run npm test", "/run npm run lint"]
  };
}

export async function generateFileExplanation(
  repository: LocalRepository,
  llmClient: LlmClient | null,
  filePath: string,
  graph: RepoGraph,
  trailPaths: string[] = []
): Promise<{ mode: "llm" | "heuristic"; explanation: FileExplainPayload }> {
  const content = await repository.readTextFile(filePath, MAX_FILE_EXPLAIN_CHARS);
  const interactions = summarizeEdge(graph, filePath);
  const signals = collectCodeSignals(filePath, content);

  if (!llmClient) {
    return {
      mode: "heuristic",
      explanation: heuristicFileExplain(filePath, content, interactions, trailPaths)
    };
  }

  const systemPrompt = [
    "Tu es un architecte logiciel.",
    "Tu expliques un fichier dans son contexte applicatif pour onboarding rapide.",
    "Tu donnes une explication pedagogique concise et actionnable.",
    "Reponds UNIQUEMENT en JSON au format:",
    '{"overview":"...","utilityInApp":"...","whyInFlow":"...","interactions":["..."],"keyFunctions":["..."],"keyVariables":["..."],"imports":["..."],"exports":["..."],"risks":["..."],"confidence":"low|medium|high"}',
    "N'invente pas des dependances absentes.",
    "Base-toi sur le contenu fourni, les interactions detectees et le parcours precedent."
  ].join("\n");

  const userPrompt = [
    `Fichier cible: ${filePath}`,
    "",
    "Parcours precedent (ordre de clic):",
    trailPaths.length > 0 ? trailPaths.join(" -> ") : "(aucun)",
    "",
    "Interactions detectees:",
    interactions.length > 0 ? interactions.join("\n") : "(aucune interaction detectee)",
    "",
    "Signaux statiques:",
    `keyFunctions=${signals.keyFunctions.join(", ") || "(none)"}`,
    `keyVariables=${signals.keyVariables.join(", ") || "(none)"}`,
    `imports=${signals.imports.join(", ") || "(none)"}`,
    `exports=${signals.exports.join(", ") || "(none)"}`,
    "",
    "Contenu fichier:",
    clamp(content, MAX_FILE_EXPLAIN_CHARS)
  ].join("\n");

  try {
    const payload = await llmJson(llmClient, systemPrompt, userPrompt, fileExplainSchema);
    return { mode: "llm", explanation: normalizeFileExplain(payload) };
  } catch {
    return {
      mode: "heuristic",
      explanation: heuristicFileExplain(filePath, content, interactions, trailPaths)
    };
  }
}

export async function generateRepoOverview(
  repository: LocalRepository,
  llmClient: LlmClient | null,
  graph: RepoGraph
): Promise<{ mode: "llm" | "heuristic"; overview: RepoOverviewPayload }> {
  const fallback = heuristicRepoOverview(graph);
  if (!llmClient) {
    return { mode: "heuristic", overview: fallback };
  }

  const readme = await repository.readTextFile("README.md", MAX_README_CHARS).catch(() => "");
  const systemPrompt = [
    "Tu es un tech lead en phase d'onboarding.",
    "Tu fournis un briefing initial d'un repository.",
    "Reponds UNIQUEMENT en JSON au format:",
    '{"overview":"...","directoryNotes":["..."],"entryPoints":["..."],"suggestedCommands":["..."]}',
    "Sois factuel et pragmatique."
  ].join("\n");

  const directoryList = fallback.directoryNotes.join("\n");
  const entryList = fallback.entryPoints.join("\n");
  const userPrompt = [
    `Graph summary: nodes=${graph.summary.nodeCount}, edges=${graph.summary.edgeCount}, dirs=${graph.summary.directories}`,
    "",
    "Top directories:",
    directoryList || "(none)",
    "",
    "Entry candidates:",
    entryList || "(none)",
    "",
    "README excerpt:",
    readme ? clamp(readme, MAX_README_CHARS) : "(README absent ou inaccessible)"
  ].join("\n");

  try {
    const payload = await llmJson(llmClient, systemPrompt, userPrompt, repoOverviewSchema);
    return { mode: "llm", overview: normalizeRepoOverview(payload) };
  } catch {
    return { mode: "heuristic", overview: fallback };
  }
}
