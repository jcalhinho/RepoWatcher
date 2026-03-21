import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveInsideRoot, toRelativePosix } from "./path-guard.js";

const execFileAsync = promisify(execFile);
let rgAvailable: boolean | undefined;

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "venv",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  "site-packages",
  ".idea",
  ".vscode",
  "coverage"
]);

const IGNORED_FILE_SUFFIXES = [
  ".pyc",
  ".pyo",
  ".so",
  ".dylib",
  ".dll",
  ".class",
  ".o",
  ".a",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz"
];

function shouldIgnoreDirectoryName(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name);
}

function shouldIgnoreFileName(name: string): boolean {
  const normalized = name.toLowerCase();
  return IGNORED_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export interface SearchResult {
  path: string;
  line: number;
  preview: string;
}

export interface SearchOptions {
  maxResults?: number;
}

export class LocalRepository {
  readonly rootPath: string;

  private constructor(rootPath: string) {
    this.rootPath = path.resolve(rootPath);
  }

  static async open(rootPath: string): Promise<LocalRepository> {
    const resolved = path.resolve(rootPath);
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) {
      throw new Error(`Repository path is not a directory: ${rootPath}`);
    }

    await access(resolved, fsConstants.R_OK);
    return new LocalRepository(resolved);
  }

  async listFiles(relativePath = ".", maxEntries = 200): Promise<string[]> {
    const startDirectory = resolveInsideRoot(this.rootPath, relativePath);
    const output: string[] = [];
    const queue: string[] = [startDirectory];

    while (queue.length > 0 && output.length < maxEntries) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && shouldIgnoreDirectoryName(entry.name)) {
          continue;
        }

        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(absolute);
        } else if (entry.isFile()) {
          if (shouldIgnoreFileName(entry.name)) {
            continue;
          }
          output.push(toRelativePosix(this.rootPath, absolute));
          if (output.length >= maxEntries) {
            break;
          }
        }
      }
    }

    return output.sort((a, b) => a.localeCompare(b));
  }

  async readTextFile(relativePath: string, maxBytes = 200_000): Promise<string> {
    const absolute = resolveInsideRoot(this.rootPath, relativePath);
    const buffer = await readFile(absolute);
    return buffer.subarray(0, maxBytes).toString("utf8");
  }

  async writeTextFile(relativePath: string, content: string): Promise<void> {
    const absolute = resolveInsideRoot(this.rootPath, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? 20;
    if (!query.trim()) {
      return [];
    }

    if (await this.hasRipgrep()) {
      try {
        const { stdout } = await execFileAsync(
          "rg",
          ["--line-number", "--no-heading", "--max-count", String(maxResults), query, this.rootPath],
          { maxBuffer: 2_000_000 }
        );

        return stdout
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .slice(0, maxResults)
          .map((line) => {
            const [file, lineNumber, ...rest] = line.split(":");
            return {
              path: toRelativePosix(this.rootPath, file),
              line: Number(lineNumber) || 1,
              preview: rest.join(":")
            };
          });
      } catch {
        return [];
      }
    }

    return this.searchWithoutRipgrep(query, maxResults);
  }

  private async searchWithoutRipgrep(query: string, maxResults: number): Promise<SearchResult[]> {
    const files = await this.listFiles(".", 2_000);
    const matches: SearchResult[] = [];

    for (const filePath of files) {
      const absolute = resolveInsideRoot(this.rootPath, filePath);
      const content = await readFile(absolute, "utf8").catch(() => "");
      if (!content) {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (lines[lineIndex].includes(query)) {
          matches.push({
            path: filePath,
            line: lineIndex + 1,
            preview: lines[lineIndex]
          });
          if (matches.length >= maxResults) {
            return matches;
          }
        }
      }
    }

    return matches;
  }

  private async hasRipgrep(): Promise<boolean> {
    if (rgAvailable !== undefined) {
      return rgAvailable;
    }

    try {
      await execFileAsync("rg", ["--version"]);
      rgAvailable = true;
    } catch {
      rgAvailable = false;
    }

    return rgAvailable;
  }
}
