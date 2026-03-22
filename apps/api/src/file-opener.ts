import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveInsideRoot } from "@repo-watcher/core";

const execFileAsync = promisify(execFile);

export type OpenFileResult = {
  absolutePath: string;
  vscodeUri: string;
  line: number;
  column: number;
  launched: boolean;
  method: "monitor.js" | "code-cli" | "open-vscode-app" | "dry-run" | "uri-only";
  details: string;
};

type OpenFileOptions = {
  line?: number;
  column?: number;
  dryRun?: boolean;
};

function toVscodeUri(absolutePath: string, line: number, column: number): string {
  const normalized = absolutePath.replaceAll(path.sep, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const encoded = prefixed
    .split("/")
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join("/");
  return `vscode://file${encoded}:${line}:${column}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function openFileInEditor(
  repoRoot: string,
  relativePath: string,
  options: OpenFileOptions = {}
): Promise<OpenFileResult> {
  const line = Number.isInteger(options.line) && (options.line ?? 0) > 0 ? Number(options.line) : 1;
  const column =
    Number.isInteger(options.column) && (options.column ?? 0) > 0 ? Number(options.column) : 1;
  const absolutePath = resolveInsideRoot(repoRoot, relativePath);
  const vscodeUri = toVscodeUri(absolutePath, line, column);
  const dryRun = options.dryRun ?? false;
  const monitorScriptPath = path.join(repoRoot, "monitor.js");
  const monitorExists = await exists(monitorScriptPath);
  const commandErrors: string[] = [];

  if (dryRun) {
    return {
      absolutePath,
      vscodeUri,
      line,
      column,
      launched: false,
      method: "dry-run",
      details: monitorExists
        ? "Dry-run: monitor.js detecte."
        : "Dry-run: monitor.js absent."
    };
  }

  if (monitorExists) {
    try {
      await execFileAsync(
        "node",
        ["monitor.js", "open", relativePath, String(line), String(column)],
        {
          cwd: repoRoot,
          timeout: 4_000
        }
      );
      return {
        absolutePath,
        vscodeUri,
        line,
        column,
        launched: true,
        method: "monitor.js",
        details: "Ouverture via monitor.js."
      };
    } catch (error) {
      commandErrors.push(
        `monitor.js: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  const gotoTarget = `${absolutePath}:${line}:${column}`;
  try {
    await execFileAsync("code", ["-g", gotoTarget], {
      cwd: repoRoot,
      timeout: 4_000
    });
    return {
      absolutePath,
      vscodeUri,
      line,
      column,
      launched: true,
      method: "code-cli",
      details: "Ouverture via commande code -g."
    };
  } catch (error) {
    commandErrors.push(`code-cli: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  if (process.platform === "darwin") {
    try {
      await execFileAsync("open", ["-a", "Visual Studio Code", absolutePath], {
        cwd: repoRoot,
        timeout: 4_000
      });
      return {
        absolutePath,
        vscodeUri,
        line,
        column,
        launched: true,
        method: "open-vscode-app",
        details: "Ouverture via open -a Visual Studio Code."
      };
    } catch (error) {
      commandErrors.push(
        `open-vscode-app: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }

  return {
    absolutePath,
    vscodeUri,
    line,
    column,
    launched: false,
    method: "uri-only",
    details:
      commandErrors.length > 0
        ? commandErrors.join(" | ")
        : "Aucune commande locale disponible; utilise vscode://."
  };
}
