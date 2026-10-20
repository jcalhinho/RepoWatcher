import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveExistingInsideRoot, resolveInsideRoot, resolveWritableInsideRoot, toRelativePosix } from "./path-guard.js";

const execFileAsync = promisify(execFile);
const rgAvailableCache = new Map<string, { value: boolean; checkedAt: number }>();
const RG_CACHE_TTL_MS = 60_000;

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".angular",
  ".cache",
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
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

export function parseRipgrepJsonOutput(rootPath: string, output: string, maxResults = 20): SearchResult[] {
  const results: SearchResult[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line || results.length >= maxResults) continue;
    try {
      const record = JSON.parse(line) as { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      if (record.type !== "match" || !record.data?.path?.text) continue;
      const pathApi = /^[a-z]:[\\/]/i.test(rootPath) ? path.win32 : path;
      const absolute = pathApi.isAbsolute(record.data.path.text)
        ? record.data.path.text
        : pathApi.resolve(rootPath, record.data.path.text);
      const relative = pathApi.relative(pathApi.resolve(rootPath), pathApi.resolve(absolute))
        .split(pathApi.sep).join("/");
      if (relative === ".." || relative.startsWith("../")) continue;
      results.push({
        path: relative,
        line: record.data.line_number || 1,
        preview: (record.data.lines?.text || "").replace(/[\r\n]+$/, "")
      });
    } catch { /* ignore non-JSON diagnostics */ }
  }
  return results;
}

export class LocalRepository {
  readonly rootPath: string;

  private constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  static async open(rootPath: string): Promise<LocalRepository> {
    const resolved = await realpath(path.resolve(rootPath));
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) {
      throw new Error(`Repository path is not a directory: ${rootPath}`);
    }

    await access(resolved, fsConstants.R_OK);
    return new LocalRepository(resolved);
  }

  async listFiles(relativePath = ".", maxEntries = 200): Promise<string[]> {
    const startDirectory = await resolveExistingInsideRoot(this.rootPath, relativePath);
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
        if (entry.isSymbolicLink()) continue;
        const safeAbsolute = await resolveExistingInsideRoot(this.rootPath, absolute);
        if (entry.isDirectory()) {
          queue.push(safeAbsolute);
        } else if (entry.isFile()) {
          if (shouldIgnoreFileName(entry.name)) {
            continue;
          }
          output.push(toRelativePosix(this.rootPath, safeAbsolute));
          if (output.length >= maxEntries) {
            break;
          }
        }
      }
    }

    return output.sort((a, b) => a.localeCompare(b));
  }

  async readTextFile(relativePath: string, maxBytes = 200_000): Promise<string> {
    const absolute = await resolveExistingInsideRoot(this.rootPath, relativePath);
    const buffer = await readFile(absolute);
    return buffer.subarray(0, maxBytes).toString("utf8");
  }

  async readTextFileExact(relativePath: string, maxBytes: number): Promise<string> {
    const absolute = await resolveExistingInsideRoot(this.rootPath, relativePath);
    const metadata = await stat(absolute);
    if (metadata.size > maxBytes) {
      const error = new Error(`File exceeds the ${maxBytes} byte limit: ${relativePath}`) as NodeJS.ErrnoException;
      error.code = "ETOOBIG";
      throw error;
    }
    const buffer = await readFile(absolute);
    if (buffer.byteLength > maxBytes) {
      const error = new Error(`File exceeds the ${maxBytes} byte limit: ${relativePath}`) as NodeJS.ErrnoException;
      error.code = "ETOOBIG";
      throw error;
    }
    return buffer.toString("utf8");
  }

  async writeTextFile(relativePath: string, content: string): Promise<void> {
    const absolute = await resolveWritableInsideRoot(this.rootPath, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    const safeAbsolute = await resolveWritableInsideRoot(this.rootPath, relativePath);
    await writeFile(safeAbsolute, content, "utf8");
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
          ["--json", "--no-follow", "--max-count", String(maxResults), query, this.rootPath],
          { maxBuffer: 2_000_000 }
        );

        return parseRipgrepJsonOutput(this.rootPath, stdout, maxResults);
      } catch {
        return this.searchWithoutRipgrep(query, maxResults);
      }
    }

    return this.searchWithoutRipgrep(query, maxResults);
  }

  private async searchWithoutRipgrep(query: string, maxResults: number): Promise<SearchResult[]> {
    const files = await this.listFiles(".", 2_000);
    const matches: SearchResult[] = [];

    for (const filePath of files) {
      const absolute = await resolveExistingInsideRoot(this.rootPath, filePath);
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
    const now = Date.now();
    const cached = rgAvailableCache.get(this.rootPath);
    if (cached && now - cached.checkedAt < RG_CACHE_TTL_MS) {
      return cached.value;
    }

    try {
      await execFileAsync("rg", ["--version"]);
      rgAvailableCache.set(this.rootPath, { value: true, checkedAt: now });
      return true;
    } catch {
      rgAvailableCache.set(this.rootPath, { value: false, checkedAt: now });
      return false;
    }
  }
}
