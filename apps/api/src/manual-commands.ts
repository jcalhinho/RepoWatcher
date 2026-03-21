import type { CommandPolicy } from "@repo-watcher/core";
import { LocalRepository, runAllowedCommand } from "@repo-watcher/core";

function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((item) => item.length > 0);
}

function extractCommand(message: string): string[] {
  return tokenize(message.replace(/^\/run\s+/, ""));
}

export function isManualCommand(message: string): boolean {
  return message.trim().startsWith("/");
}

export async function runManualCommand(
  repo: LocalRepository,
  message: string,
  commandPolicy: CommandPolicy
): Promise<string> {
  if (message.startsWith("/help")) {
    return [
      "Commandes disponibles:",
      "- /help",
      "- /list [path]",
      "- /read <path>",
      "- /search <query>",
      "- /run <commande>",
      "",
      "Exemples:",
      "- /list src",
      "- /read package.json",
      "- /search TODO",
      "- /run npm test"
    ].join("\n");
  }

  if (message.startsWith("/list")) {
    const parts = tokenize(message);
    const relativePath = parts[1] ?? ".";
    const files = await repo.listFiles(relativePath, 200);
    if (files.length === 0) {
      return `Aucun fichier trouve sous '${relativePath}'.`;
    }
    return `Fichiers (${files.length}):\n${files.join("\n")}`;
  }

  if (message.startsWith("/read")) {
    const parts = tokenize(message);
    const relativePath = parts[1];
    if (!relativePath) {
      return "Usage: /read <path>";
    }

    const content = await repo.readTextFile(relativePath, 100_000);
    return `Contenu de ${relativePath}:\n\n${content}`;
  }

  if (message.startsWith("/search")) {
    const query = message.replace(/^\/search\s+/, "").trim();
    if (!query) {
      return "Usage: /search <query>";
    }

    const results = await repo.search(query, { maxResults: 30 });
    if (results.length === 0) {
      return `Aucun resultat pour '${query}'.`;
    }

    const lines = results.map((item) => `${item.path}:${item.line} ${item.preview}`);
    return `Resultats (${results.length}):\n${lines.join("\n")}`;
  }

  if (message.startsWith("/run")) {
    const command = extractCommand(message);
    if (command.length === 0) {
      return "Usage: /run <commande>";
    }

    const result = await runAllowedCommand(repo.rootPath, command, commandPolicy);
    const sections = [
      `Commande: ${command.join(" ")}`,
      `Exit code: ${result.exitCode}`,
      "stdout:",
      result.stdout || "(vide)",
      "stderr:",
      result.stderr || "(vide)"
    ];
    return sections.join("\n");
  }

  return [
    "Commande manuelle inconnue.",
    "Utilise /help pour voir les commandes supportees."
  ].join("\n");
}
