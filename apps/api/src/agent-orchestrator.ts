import type { CommandPolicy } from "@repo-watcher/core";
import { LocalRepository, runAllowedCommand } from "@repo-watcher/core";
import { z } from "zod";
import type { LlmClient, LlmMessage } from "./llm-client.js";

export type AgentStepTrace = {
  step: number;
  tool: "list" | "read" | "search" | "run";
  input: string;
  outputPreview: string;
};

export type AgentRunResult = {
  reply: string;
  steps: AgentStepTrace[];
};

const agentTurnSchema = z.object({
  action: z
    .object({
      tool: z.enum(["list", "read", "search", "run"]),
      input: z.string().min(1)
    })
    .optional(),
  final: z.string().min(1).optional()
});

const MAX_TOOL_STEPS = 8;
const TOOL_OUTPUT_LIMIT = 4_000;

const SYSTEM_PROMPT = [
  "Tu es un agent de codage local type Jules.",
  "Tu dois raisonner via outils securises avant de conclure.",
  "Outils disponibles:",
  "- list(input): liste des fichiers sous un path relatif",
  "- read(input): lit un fichier texte (path relatif)",
  "- search(input): cherche un texte dans le repo",
  "- run(input): execute une commande allowlist",
  "  Commandes run autorisees:",
  "  - ls -la",
  "  - npm|pnpm|yarn test|lint|build",
  "  - cat <fichier_relatif>",
  "  - head -n <1..500> <fichier_relatif>",
  "  - tail -n <1..500> <fichier_relatif>",
  "  - cat|head|tail avec pipe de lecture (ex: head -n 400 foo.ts | tail -n 50)",
  "",
  "Reponds UNIQUEMENT en JSON valide au format:",
  '{"action":{"tool":"list|read|search|run","input":"..."}}',
  "ou",
  '{"final":"..."}',
  "",
  "Regles:",
  "- si information manquante, appelle un outil",
  "- n'invente pas des fichiers inexistants",
  "- evite les actions redondantes (ne pas relancer list('.') inutilement)",
  "- privilegie README + fichiers d'entree (main, routes, config) pour expliquer un repo",
  "- propose des etapes concrètes et prudentes",
  "- quand tu as assez d’info, renvoie final"
].join("\n");

function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((item) => item.length > 0);
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

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n...[truncated]`;
}

async function executeTool(
  repository: LocalRepository,
  commandPolicy: CommandPolicy,
  tool: "list" | "read" | "search" | "run",
  input: string
): Promise<string> {
  if (tool === "list") {
    const files = await repository.listFiles(input, 200);
    return files.length > 0 ? files.join("\n") : "(no files found)";
  }

  if (tool === "read") {
    return repository.readTextFile(input, 150_000);
  }

  if (tool === "search") {
    const results = await repository.search(input, { maxResults: 30 });
    if (results.length === 0) {
      return "(no matches)";
    }
    return results.map((item) => `${item.path}:${item.line} ${item.preview}`).join("\n");
  }

  const command = tokenize(input);
  if (command.length === 0) {
    throw new Error("run tool requires a non-empty command");
  }
  const result = await runAllowedCommand(repository.rootPath, command, commandPolicy);
  return [
    `exitCode=${result.exitCode}`,
    "stdout:",
    result.stdout || "(empty)",
    "stderr:",
    result.stderr || "(empty)"
  ].join("\n");
}

export async function runAgentWithTools(
  repository: LocalRepository,
  userMessage: string,
  llmClient: LlmClient,
  commandPolicy: CommandPolicy
): Promise<AgentRunResult> {
  const steps: AgentStepTrace[] = [];
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Demande utilisateur:\n${userMessage}\n\nCommence par choisir action ou final.`
    }
  ];

  for (let step = 1; step <= MAX_TOOL_STEPS; step += 1) {
    const raw = await llmClient.complete(messages);
    const parsedJson = extractFirstJsonObject(raw);

    const parsedTurn = agentTurnSchema.safeParse(JSON.parse(parsedJson));
    if (!parsedTurn.success) {
      const formatError = "Format JSON agent invalide. Repond strictement avec {action} ou {final}.";
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: formatError });
      continue;
    }

    const turn = parsedTurn.data;
    if (turn.final) {
      return {
        reply: turn.final,
        steps
      };
    }

    if (!turn.action) {
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: "Tu dois fournir une action ou un final."
      });
      continue;
    }

    const output = await executeTool(repository, commandPolicy, turn.action.tool, turn.action.input);
    const preview = truncate(output, TOOL_OUTPUT_LIMIT);

    steps.push({
      step,
      tool: turn.action.tool,
      input: turn.action.input,
      outputPreview: preview
    });

    messages.push({
      role: "assistant",
      content: JSON.stringify({ action: turn.action })
    });
    messages.push({
      role: "user",
      content: `Observation outil ${turn.action.tool}:\n${preview}\n\nContinue.`
    });
  }

  return {
    reply: [
      "L'agent n'a pas finalise dans la limite de steps.",
      "Relance avec une demande plus ciblee ou utilise les commandes /help."
    ].join("\n"),
    steps
  };
}
