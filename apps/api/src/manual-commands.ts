import type { CommandPolicy } from "@repo-watcher/core";
import { LocalRepository, runAllowedCommand } from "@repo-watcher/core";

export type UserLanguage = "fr" | "en";

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
  commandPolicy: CommandPolicy,
  language: UserLanguage = "fr"
): Promise<string> {
  const inEnglish = language === "en";
  const txt = (fr: string, en: string) => (inEnglish ? en : fr);

  if (message.startsWith("/help")) {
    return [
      txt("Commandes disponibles:", "Available commands:"),
      "- /help",
      "- /list [path]",
      "- /read <path>",
      "- /search <query>",
      "- /run <commande>",
      "",
      txt("Exemples:", "Examples:"),
      "- /list src",
      "- /read package.json",
      "- /search TODO",
      "- /run npm test",
      "- /run cmd /c dir (Windows)",
      "- /run powershell -NoProfile -Command Get-Content -Path README.md (Windows)"
    ].join("\n");
  }

  if (message.startsWith("/list")) {
    const parts = tokenize(message);
    const relativePath = parts[1] ?? ".";
    const files = await repo.listFiles(relativePath, 200);
    if (files.length === 0) {
      return txt(
        `Aucun fichier trouve sous '${relativePath}'.`,
        `No files found under '${relativePath}'.`
      );
    }
    return txt(`Fichiers (${files.length}):\n${files.join("\n")}`, `Files (${files.length}):\n${files.join("\n")}`);
  }

  if (message.startsWith("/read")) {
    const parts = tokenize(message);
    const relativePath = parts[1];
    if (!relativePath) {
      return inEnglish ? "Usage: /read <path>" : "Usage: /read <path>";
    }

    const content = await repo.readTextFile(relativePath, 100_000);
    return txt(`Contenu de ${relativePath}:\n\n${content}`, `Content of ${relativePath}:\n\n${content}`);
  }

  if (message.startsWith("/search")) {
    const query = message.replace(/^\/search\s+/, "").trim();
    if (!query) {
      return "Usage: /search <query>";
    }

    const results = await repo.search(query, { maxResults: 30 });
    if (results.length === 0) {
      return txt(`Aucun resultat pour '${query}'.`, `No results for '${query}'.`);
    }

    const lines = results.map((item) => `${item.path}:${item.line} ${item.preview}`);
    return txt(`Resultats (${results.length}):\n${lines.join("\n")}`, `Results (${results.length}):\n${lines.join("\n")}`);
  }

  if (message.startsWith("/run")) {
    const command = extractCommand(message);
    if (command.length === 0) {
      return txt("Usage: /run <commande>", "Usage: /run <command>");
    }

    const result = await runAllowedCommand(repo.rootPath, command, commandPolicy);
    const sections = [
      txt(`Commande: ${command.join(" ")}`, `Command: ${command.join(" ")}`),
      `Exit code: ${result.exitCode}`,
      "stdout:",
      result.stdout || txt("(vide)", "(empty)"),
      "stderr:",
      result.stderr || txt("(vide)", "(empty)")
    ];
    return sections.join("\n");
  }

  return [
    txt("Commande manuelle inconnue.", "Unknown manual command."),
    txt("Utilise /help pour voir les commandes supportees.", "Use /help to list supported commands.")
  ].join("\n");
}
