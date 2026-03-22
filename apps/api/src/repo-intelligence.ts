import path from "node:path";
import { LocalRepository } from "@repo-watcher/core";
import { z } from "zod";
import type { LlmClient, LlmUsage } from "./llm-client.js";
import { buildRepoGraph, type RepoGraph } from "./repo-graph.js";
import type { UserLanguage } from "./manual-commands.js";

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
  suggestedCommands: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  urgentImprovements: z.array(z.string()).default([]),
  attentionPoints: z.array(z.string()).default([]),
  securityFindings: z.array(z.string()).default([]),
  suspiciousFiles: z.array(z.string()).default([])
});

type FileExplainPayload = z.output<typeof fileExplainSchema>;
type RepoOverviewPayload = z.output<typeof repoOverviewSchema>;

function isEnglish(language: UserLanguage): boolean {
  return language === "en";
}

function txt(language: UserLanguage, fr: string, en: string): string {
  return isEnglish(language) ? en : fr;
}

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
}, language: UserLanguage = "fr"): FileExplainPayload {
  return {
    overview: payload.overview,
    utilityInApp: payload.utilityInApp,
    whyInFlow: payload.whyInFlow ?? txt(language, "Pas de contexte de parcours fourni.", "No flow context provided."),
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
  strengths?: string[];
  weaknesses?: string[];
  urgentImprovements?: string[];
  attentionPoints?: string[];
  securityFindings?: string[];
  suspiciousFiles?: string[];
}): RepoOverviewPayload {
  return {
    overview: payload.overview,
    directoryNotes: payload.directoryNotes ?? [],
    entryPoints: payload.entryPoints ?? [],
    suggestedCommands: payload.suggestedCommands ?? [],
    strengths: payload.strengths ?? [],
    weaknesses: payload.weaknesses ?? [],
    urgentImprovements: payload.urgentImprovements ?? [],
    attentionPoints: payload.attentionPoints ?? [],
    securityFindings: payload.securityFindings ?? [],
    suspiciousFiles: payload.suspiciousFiles ?? []
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
): Promise<{ data: T; usage: LlmUsage | null }> {
  const completion = await llmClient.completeWithUsage([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ]);
  const parsed = JSON.parse(extractFirstJsonObject(completion.content));
  return {
    data: schema.parse(parsed),
    usage: completion.usage
  };
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
  const isJvm = [".java", ".kt", ".kts", ".scala", ".groovy"].includes(ext);
  const isGo = ext === ".go";
  const isRust = ext === ".rs";
  const isDotNet = [".cs", ".fs", ".vb"].includes(ext);

  const imports = isPython
    ? unique([
        ...collectMatches(content, /^\s*from\s+([a-zA-Z0-9_\.]+)\s+import\s+/gm),
        ...collectMatches(content, /^\s*import\s+([a-zA-Z0-9_\.]+)/gm)
      ]).slice(0, 12)
    : isJvm
      ? unique(collectMatches(content, /^\s*import\s+([a-zA-Z0-9_\.]+)(?:\.\*)?\s*;/gm)).slice(0, 12)
      : isGo
        ? unique([
            ...collectMatches(
              content,
              /^\s*import\s+(?:[a-zA-Z_][a-zA-Z0-9_]*\s+)?["']([^"']+)["']/gm
            ),
            ...collectMatches(content, /^\s*["']([^"']+)["']\s*$/gm)
          ]).slice(0, 12)
        : isRust
          ? unique([
              ...collectMatches(content, /^\s*use\s+([a-zA-Z0-9_:]+)\s*;/gm),
              ...collectMatches(content, /^\s*mod\s+([a-zA-Z0-9_]+)\s*;/gm)
            ]).slice(0, 12)
          : isDotNet
            ? unique(collectMatches(content, /^\s*using\s+([a-zA-Z0-9_\.]+)\s*;/gm)).slice(0, 12)
            : unique([
                ...collectMatches(content, /\bimport\s+(?:[^"']*from\s+)?["']([^"']+)["']/g),
                ...collectMatches(content, /\brequire\(\s*["']([^"']+)["']\s*\)/g),
                ...collectMatches(content, /\b(?:include|include_once|require|require_once)\s*\(?\s*["']([^"']+)["']/g),
                ...collectMatches(content, /\b(?:require_relative|require)\s+["']([^"']+)["']/g),
                ...collectMatches(content, /^\s*#include\s+"([^"]+)"/gm)
              ]).slice(0, 12);

  const exports = isPython
    ? unique(collectMatches(content, /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)).slice(0, 10)
    : isJvm
      ? unique([
          ...collectMatches(content, /\bclass\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g),
          ...collectMatches(content, /\binterface\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g),
          ...collectMatches(content, /\benum\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g)
        ]).slice(0, 10)
      : isGo
        ? unique([
            ...collectMatches(content, /^\s*func\s+([A-Z][a-zA-Z0-9_]*)\s*\(/gm),
            ...collectMatches(content, /^\s*type\s+([A-Z][a-zA-Z0-9_]*)\s+/gm)
          ]).slice(0, 10)
        : isRust
          ? unique([
              ...collectMatches(content, /^\s*pub\s+fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm),
              ...collectMatches(content, /^\s*pub\s+(?:struct|enum|trait)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm)
            ]).slice(0, 10)
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
    : isJvm
      ? unique([
          ...collectMatches(
            content,
            /\b(?:public|private|protected)?\s*(?:static\s+)?[a-zA-Z0-9_<>,\[\]\.?]+\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g
          ),
          ...collectMatches(content, /\bclass\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/g)
        ]).slice(0, 12)
      : isGo
        ? unique([
            ...collectMatches(content, /^\s*func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm),
            ...collectMatches(content, /^\s*type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+/gm)
          ]).slice(0, 12)
        : isRust
          ? unique([
              ...collectMatches(content, /^\s*(?:pub\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm),
              ...collectMatches(content, /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm)
            ]).slice(0, 12)
          : unique([
              ...collectMatches(content, /\b(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g),
              ...collectMatches(
                content,
                /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g
              ),
              ...collectMatches(content, /\bclass\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g),
              ...collectMatches(content, /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm),
              ...collectMatches(content, /^\s*function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm),
              ...collectMatches(content, /^\s*sub\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/gm),
              ...collectMatches(content, /^\s*proc\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+/gm)
            ]).slice(0, 12);

  const keyVariables = isPython
    ? unique(collectMatches(content, /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gm)).slice(0, 12)
    : isGo
      ? unique([
          ...collectMatches(content, /^\s*var\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm),
          ...collectMatches(content, /^\s*const\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm)
        ]).slice(0, 12)
      : isRust
        ? unique([
            ...collectMatches(content, /^\s*let\s+(?:mut\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/gm),
            ...collectMatches(content, /^\s*const\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm)
          ]).slice(0, 12)
        : unique(
            collectMatches(content, /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g)
          ).slice(0, 12);

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
  trailPaths: string[],
  language: UserLanguage
): string {
  if (trailPaths.length === 0) {
    return txt(
      language,
      "Point de depart de l'exploration. Clique ensuite sur les fichiers relies pour suivre le parcours technique.",
      "Starting point of the exploration. Click related files to follow the technical path."
    );
  }

  const previous = trailPaths[trailPaths.length - 1];
  if (!previous || previous === filePath) {
    return txt(
      language,
      "Tu restes sur le meme fichier pour approfondir les details internes.",
      "You stayed on the same file to go deeper into internal details."
    );
  }

  const linkedFromPrevious = interactions.some((item) => item.includes(previous));
  if (linkedFromPrevious) {
    return txt(
      language,
      `Transition depuis ${previous} -> ${filePath}: ce passage est relie dans le graphe d'import et aide a suivre le flux applicatif.`,
      `Transition from ${previous} -> ${filePath}: this step is linked in the import graph and helps follow the app flow.`
    );
  }

  return txt(
    language,
    `Fichier selectionne apres ${previous}. Le lien n'est pas direct dans les imports locaux, mais il peut representer une etape fonctionnelle du parcours utilisateur.`,
    `Selected after ${previous}. The link is not direct in local imports, but it may still represent a functional step in the user journey.`
  );
}

function heuristicFileExplain(
  filePath: string,
  content: string,
  interactions: string[],
  trailPaths: string[],
  language: UserLanguage
): FileExplainPayload {
  const lines = content.split(/\r?\n/);
  const ext = extensionOf(filePath);
  const looksApiRoute = /(route|router|controller|endpoint)/i.test(filePath + content.slice(0, 4000));
  const looksConfig = /(config|settings|env)/i.test(filePath + content.slice(0, 3000));
  const looksService = /(service|manager|client)/i.test(filePath + content.slice(0, 3000));
  const signals = collectCodeSignals(filePath, content);

  let utility = txt(language, "Fichier de support dans l'application.", "Support file in the application.");
  if (looksApiRoute) {
    utility = txt(
      language,
      "Expose des endpoints ou des routes et connecte la couche HTTP au coeur applicatif.",
      "Exposes endpoints/routes and connects the HTTP layer to core application logic."
    );
  } else if (looksConfig) {
    utility = txt(
      language,
      "Centralise la configuration (environnement, options runtime, parametres).",
      "Centralizes configuration (environment, runtime options, parameters)."
    );
  } else if (looksService) {
    utility = txt(
      language,
      "Contient la logique metier ou l'integration avec des services externes.",
      "Contains business logic or integration with external services."
    );
  } else if (ext === ".tsx" || ext === ".jsx") {
    utility = txt(
      language,
      "Definit une vue/composant UI dans l'application frontend.",
      "Defines a UI view/component in the frontend application."
    );
  } else if ([".java", ".kt", ".kts", ".scala", ".groovy"].includes(ext)) {
    utility = txt(
      language,
      "Participe au backend/service JVM (API, configuration, services, modeles).",
      "Participates in JVM backend/service code (API, config, services, models)."
    );
  } else if ([".go", ".rs", ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".m", ".mm"].includes(ext)) {
    utility = txt(
      language,
      "Participe au coeur backend/systeme (services, performances, modules bas niveau).",
      "Participates in core backend/system code (services, performance, low-level modules)."
    );
  } else if ([".cs", ".fs", ".vb"].includes(ext)) {
    utility = txt(
      language,
      "Participe a un service/backend .NET (API, logique metier, integrations).",
      "Participates in a .NET backend/service (API, business logic, integrations)."
    );
  } else if ([".php", ".rb", ".lua", ".pl", ".pm"].includes(ext)) {
    utility = txt(
      language,
      "Participe au backend/script applicatif (routes, jobs, services, utilitaires).",
      "Participates in backend/script code (routes, jobs, services, utilities)."
    );
  } else if ([".swift", ".dart"].includes(ext)) {
    utility = txt(
      language,
      "Participe a l'application mobile (UI, logique client, services).",
      "Participates in mobile application code (UI, client logic, services)."
    );
  } else if ([".sh", ".bash", ".zsh"].includes(ext)) {
    utility = txt(
      language,
      "Script d'automatisation/execution (build, deploy, maintenance, outillage).",
      "Automation/execution script (build, deploy, maintenance, tooling)."
    );
  } else if (ext === ".py") {
    utility = txt(
      language,
      "Participe au backend Python (API, modele, services ou utilitaires).",
      "Participates in Python backend code (API, models, services, utilities)."
    );
  }

  return {
    overview: txt(
      language,
      `${safeBaseName(filePath)} contient ${lines.length} lignes et semble orienté ${utility.toLowerCase()}`,
      `${safeBaseName(filePath)} contains ${lines.length} lines and appears oriented toward ${utility.toLowerCase()}`
    ),
    utilityInApp: utility,
    whyInFlow: buildFlowNarrative(filePath, interactions, trailPaths, language),
    interactions:
      interactions.length > 0
        ? interactions
        : [txt(language, "Aucune interaction locale detectee dans le graphe courant.", "No local interaction detected in the current graph.")],
    keyFunctions: signals.keyFunctions,
    keyVariables: signals.keyVariables,
    imports: signals.imports,
    exports: signals.exports,
    risks: [
      txt(
        language,
        "Verifier la couverture de tests autour des points d'entree critiques.",
        "Check test coverage around critical entry points."
      ),
      txt(
        language,
        "Verifier la validation des entrees si ce fichier traite des donnees externes.",
        "Check input validation if this file handles external data."
      )
    ],
    confidence: interactions.length > 0 ? "medium" : "low"
  };
}

function looksTestFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return (
    normalized.includes("/__tests__/") ||
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/spec/") ||
    normalized.includes("/specs/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".test.js") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.endsWith(".spec.js")
  );
}

function suspiciousNameReason(filePath: string): string | null {
  const normalized = filePath.toLowerCase();
  if (/(backdoor|dropper|rat|keylogger|cryptominer|miner|payload|injector|exploit)/.test(normalized)) {
    return "malicious-name";
  }
  if (/(temp|tmp|debug|old|backup|copy)\.(js|ts|py|sh|php|rb)$/i.test(normalized)) {
    return "leftover-file";
  }
  if (normalized.endsWith(".min.js") || normalized.endsWith(".bundle.js")) {
    return "minified-artifact";
  }
  return null;
}

type SecurityScanResult = {
  findings: string[];
  suspiciousFiles: string[];
};

async function scanSecuritySignals(
  repository: LocalRepository,
  graph: RepoGraph,
  language: UserLanguage
): Promise<SecurityScanResult> {
  const findings: string[] = [];
  const suspiciousFiles: string[] = [];

  const candidatePaths = unique([
    ...graph.summary.riskFiles,
    ...graph.summary.keyFiles,
    ...graph.nodes.filter((node) => node.data.riskLevel === "high").map((node) => node.data.path)
  ]).slice(0, 30);

  for (const filePath of graph.nodes.map((node) => node.data.path)) {
    const reason = suspiciousNameReason(filePath);
    if (reason) {
      const localizedReason =
        reason === "malicious-name"
          ? txt(language, "nom de fichier potentiellement malveillant", "potentially malicious file name")
          : reason === "leftover-file"
            ? txt(language, "fichier potentiellement oublie en production", "file potentially left in production")
            : txt(language, "artifact/minifie a surveiller", "minified artifact to review");
      suspiciousFiles.push(`${filePath} (${localizedReason})`);
    }
  }

  const secretPattern =
    /\b(api[_-]?key|secret|token|password|private[_-]?key|client[_-]?secret)\b[^\n=:]{0,40}[:=]\s*["'][^"'\n]{8,}["']/i;
  const dangerousExecPattern =
    /\b(eval\(|new Function\(|child_process\.(?:exec|spawn|execFile)|os\.system\(|subprocess\.Popen\(|Runtime\.getRuntime\(\)\.exec\()/;
  const weakCryptoPattern = /\b(md5|sha1)\s*\(/i;
  const deserializationPattern = /\b(pickle\.loads|yaml\.load\(|ObjectInputStream|BinaryFormatter)\b/i;
  const longEncodedPattern = /[A-Za-z0-9+/]{180,}={0,2}/;

  for (const filePath of candidatePaths) {
    const content = await repository.readTextFile(filePath, 36_000).catch(() => "");
    if (!content) {
      continue;
    }

    if (secretPattern.test(content)) {
      findings.push(
        txt(
          language,
          `Secret potentiellement hardcode dans ${filePath}`,
          `Potential hardcoded secret in ${filePath}`
        )
      );
    }
    if (dangerousExecPattern.test(content)) {
      findings.push(
        txt(
          language,
          `Execution dynamique detectee dans ${filePath} (eval/exec/spawn)`,
          `Dynamic execution detected in ${filePath} (eval/exec/spawn)`
        )
      );
    }
    if (weakCryptoPattern.test(content)) {
      findings.push(
        txt(
          language,
          `Usage crypto faible (MD5/SHA1) detecte dans ${filePath}`,
          `Weak crypto usage (MD5/SHA1) detected in ${filePath}`
        )
      );
    }
    if (deserializationPattern.test(content)) {
      findings.push(
        txt(
          language,
          `Deserialisation sensible detectee dans ${filePath}`,
          `Sensitive deserialization detected in ${filePath}`
        )
      );
    }
    if (longEncodedPattern.test(content)) {
      suspiciousFiles.push(
        txt(
          language,
          `${filePath} (bloc encode long a verifier)`,
          `${filePath} (long encoded blob to verify)`
        )
      );
    }
  }

  return {
    findings: unique(findings).slice(0, 8),
    suspiciousFiles: unique(suspiciousFiles).slice(0, 10)
  };
}

function topCoupledFiles(graph: RepoGraph, language: UserLanguage, limit = 5): string[] {
  const degree = new Map<string, number>();
  for (const node of graph.nodes) {
    degree.set(node.data.path, 0);
  }
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return [...degree.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([filePath, score]) =>
      txt(language, `${filePath} (couplage:${score})`, `${filePath} (coupling:${score})`)
    );
}

async function heuristicRepoOverview(
  repository: LocalRepository,
  graph: RepoGraph,
  language: UserLanguage
): Promise<RepoOverviewPayload> {
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
    .map(([dir, count]) => txt(language, `${dir}: ${count} fichiers`, `${dir}: ${count} files`));

  const testCount = graph.nodes.filter((node) => looksTestFile(node.data.path)).length;
  const highRiskNodes = graph.nodes.filter((node) => node.data.riskLevel === "high");
  const extensionCount = new Set(
    graph.nodes
      .map((node) => extensionOf(node.data.path))
      .filter((ext) => ext.length > 0)
  ).size;
  const securityScan = await scanSecuritySignals(repository, graph, language);

  const strengths = [
    txt(
      language,
      `Cartographie produite: ${graph.summary.nodeCount} fichiers et ${graph.summary.edgeCount} liens.`,
      `Map generated: ${graph.summary.nodeCount} files and ${graph.summary.edgeCount} links.`
    ),
    entries.length > 0
      ? txt(
          language,
          `Points d'entree detectes (${Array.from(new Set(entries)).length}).`,
          `Entry points detected (${Array.from(new Set(entries)).length}).`
        )
      : txt(
          language,
          "Aucun point d'entree explicite detecte; verifier la convention de nommage.",
          "No explicit entry point detected; verify naming conventions."
        ),
    graph.summary.flowEdgeCount > 0
      ? txt(
          language,
          `Flux applicatif detecte via ${graph.summary.flowEdgeCount} liens de flow.`,
          `Application flow detected through ${graph.summary.flowEdgeCount} flow links.`
        )
      : txt(
          language,
          "Structure import detectee, mais flux applicatif peu explicite.",
          "Import structure detected, but application flow is weakly explicit."
        ),
    testCount > 0
      ? txt(
          language,
          `Presence de tests detectee (${testCount} fichiers).`,
          `Tests detected (${testCount} files).`
        )
      : "",
    graph.summary.configEdgeCount > 0
      ? txt(
          language,
          `Interactions de configuration detectees (${graph.summary.configEdgeCount}).`,
          `Configuration interactions detected (${graph.summary.configEdgeCount}).`
        )
      : ""
  ].filter(Boolean);

  const weaknesses = [
    testCount === 0
      ? txt(
          language,
          "Peu/pas de fichiers de tests detectes dans le scope analyse.",
          "Few or no test files detected in the analyzed scope."
        )
      : "",
    highRiskNodes.length > 0
      ? txt(
          language,
          `${highRiskNodes.length} fichiers en zone de risque eleve (auth/secrets/db/exec).`,
          `${highRiskNodes.length} files in high-risk zone (auth/secrets/db/exec).`
        )
      : "",
    graph.summary.apiEdgeCount === 0
      ? txt(
          language,
          "Peu de liaisons API detectees; verifier si appels dynamiques non resolus.",
          "Few API links detected; verify whether dynamic calls are unresolved."
        )
      : "",
    graph.summary.nodeCount >= 300
      ? txt(
          language,
          "Surface code importante: prioriser des sous-domaines pour l'analyse detaillee.",
          "Large code surface: prioritize sub-domains for detailed analysis."
        )
      : ""
  ].filter(Boolean);

  const urgentImprovements = unique([
    ...highRiskNodes
      .slice(0, 4)
      .map((node) =>
        txt(language, `Auditer en priorite: ${node.data.path}`, `High-priority audit: ${node.data.path}`)
      ),
    ...securityScan.findings.map((item) =>
      txt(language, `Verifier rapidement: ${item}`, `Quick verification needed: ${item}`)
    ),
    testCount === 0
      ? txt(
          language,
          "Ajouter un socle de tests automatiques sur les points d'entree critiques.",
          "Add baseline automated tests on critical entry points."
        )
      : ""
  ])
    .filter(Boolean)
    .slice(0, 8);

  const attentionPoints = [
    ...topCoupledFiles(graph, language, 5).map((item) =>
      txt(language, `Fichier central a surveiller: ${item}`, `Central file to monitor: ${item}`)
    ),
    extensionCount >= 5
      ? txt(
          language,
          `Codebase polyglotte (${extensionCount} extensions): surveiller la coherence des conventions.`,
          `Polyglot codebase (${extensionCount} extensions): monitor convention consistency.`
        )
      : "",
    graph.summary.riskFiles.length > 0
      ? txt(
          language,
          `Points de vigilance fonctionnels: ${graph.summary.riskFiles.slice(0, 5).join(", ")}`,
          `Functional watch points: ${graph.summary.riskFiles.slice(0, 5).join(", ")}`
        )
      : ""
  ]
    .filter(Boolean)
    .slice(0, 8);

  const securityFindings =
    securityScan.findings.length > 0
      ? securityScan.findings
      : [
          txt(
            language,
            "Aucune alerte securite critique heuristique detectee dans l'echantillon scanne.",
            "No critical heuristic security alert detected in the scanned sample."
          )
        ];

  const suspiciousFiles = securityScan.suspiciousFiles;

  return {
    overview: txt(
      language,
      `Scan initial termine: ${graph.summary.nodeCount} fichiers source et ${graph.summary.edgeCount} interactions locales detectees.`,
      `Initial scan complete: ${graph.summary.nodeCount} source files and ${graph.summary.edgeCount} local interactions detected.`
    ),
    directoryNotes: topDirectories,
    entryPoints: Array.from(new Set(entries)).slice(0, 10),
    suggestedCommands: ["/run ls -la", "/run npm test", "/run npm run lint"],
    strengths,
    weaknesses,
    urgentImprovements,
    attentionPoints,
    securityFindings,
    suspiciousFiles
  };
}

export async function generateFileExplanation(
  repository: LocalRepository,
  llmClient: LlmClient | null,
  filePath: string,
  graph: RepoGraph,
  trailPaths: string[] = [],
  language: UserLanguage = "fr"
): Promise<{ mode: "llm" | "heuristic"; explanation: FileExplainPayload; usage: LlmUsage | null }> {
  const content = await repository.readTextFile(filePath, MAX_FILE_EXPLAIN_CHARS);
  const interactions = summarizeEdge(graph, filePath);
  const signals = collectCodeSignals(filePath, content);

  if (!llmClient) {
    return {
      mode: "heuristic",
      explanation: heuristicFileExplain(filePath, content, interactions, trailPaths, language),
      usage: null
    };
  }

  const outputLanguageLabel = isEnglish(language) ? "English" : "French";

  const systemPrompt = [
    "You are a senior software architect.",
    "Explain the target file in its application context for fast onboarding across junior to senior developers.",
    "Be pedagogical, concise, and actionable.",
    "Respond ONLY in JSON with this shape:",
    '{"overview":"...","utilityInApp":"...","whyInFlow":"...","interactions":["..."],"keyFunctions":["..."],"keyVariables":["..."],"imports":["..."],"exports":["..."],"risks":["..."],"confidence":"low|medium|high"}',
    "Do not invent dependencies or behavior.",
    "Ground your answer in the provided content, detected interactions, and prior click trail.",
    `All JSON string values must be written in ${outputLanguageLabel}.`
  ].join("\n");

  const userPrompt = [
    `Target file: ${filePath}`,
    "",
    "Previous exploration trail (click order):",
    trailPaths.length > 0 ? trailPaths.join(" -> ") : "(none)",
    "",
    "Detected interactions:",
    interactions.length > 0 ? interactions.join("\n") : "(no detected interaction)",
    "",
    "Static signals:",
    `keyFunctions=${signals.keyFunctions.join(", ") || "(none)"}`,
    `keyVariables=${signals.keyVariables.join(", ") || "(none)"}`,
    `imports=${signals.imports.join(", ") || "(none)"}`,
    `exports=${signals.exports.join(", ") || "(none)"}`,
    "",
    "File content:",
    clamp(content, MAX_FILE_EXPLAIN_CHARS)
  ].join("\n");

  try {
    const result = await llmJson(llmClient, systemPrompt, userPrompt, fileExplainSchema);
    return { mode: "llm", explanation: normalizeFileExplain(result.data, language), usage: result.usage };
  } catch {
    return {
      mode: "heuristic",
      explanation: heuristicFileExplain(filePath, content, interactions, trailPaths, language),
      usage: null
    };
  }
}

export async function generateRepoOverview(
  repository: LocalRepository,
  llmClient: LlmClient | null,
  graph: RepoGraph,
  language: UserLanguage = "fr"
): Promise<{ mode: "llm" | "heuristic"; overview: RepoOverviewPayload; usage: LlmUsage | null }> {
  const fallback = await heuristicRepoOverview(repository, graph, language);
  if (!llmClient) {
    return { mode: "heuristic", overview: fallback, usage: null };
  }

  const readme = await repository.readTextFile("README.md", MAX_README_CHARS).catch(() => "");
  const outputLanguageLabel = isEnglish(language) ? "English" : "French";
  const systemPrompt = [
    "You are a tech lead preparing onboarding notes.",
    "Produce an initial repository briefing that is clear for mixed experience levels.",
    "Respond ONLY in JSON with this shape:",
    '{"overview":"...","directoryNotes":["..."],"entryPoints":["..."],"suggestedCommands":["..."],"strengths":["..."],"weaknesses":["..."],"urgentImprovements":["..."],"attentionPoints":["..."],"securityFindings":["..."],"suspiciousFiles":["..."]}',
    "Stay factual and pragmatic.",
    `All JSON string values must be written in ${outputLanguageLabel}.`
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
    "Heuristic strengths:",
    fallback.strengths.join("\n") || "(none)",
    "",
    "Heuristic weaknesses:",
    fallback.weaknesses.join("\n") || "(none)",
    "",
    "Heuristic urgent improvements:",
    fallback.urgentImprovements.join("\n") || "(none)",
    "",
    "Heuristic attention points:",
    fallback.attentionPoints.join("\n") || "(none)",
    "",
    "Heuristic security findings:",
    fallback.securityFindings.join("\n") || "(none)",
    "",
    "Heuristic suspicious files:",
    fallback.suspiciousFiles.join("\n") || "(none)",
    "",
    "README excerpt:",
    readme ? clamp(readme, MAX_README_CHARS) : "(README absent ou inaccessible)"
  ].join("\n");

  try {
    const result = await llmJson(llmClient, systemPrompt, userPrompt, repoOverviewSchema);
    return { mode: "llm", overview: normalizeRepoOverview(result.data), usage: result.usage };
  } catch {
    return { mode: "heuristic", overview: fallback, usage: null };
  }
}
