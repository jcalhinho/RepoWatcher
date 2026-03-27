import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const uiDirCandidates = [
  path.resolve(moduleDir, "../ui"),
  path.resolve(moduleDir, "../../../../ui"),
  path.resolve(process.cwd(), "apps/api/ui")
];

function resolveUiDir(): string {
  const found = uiDirCandidates.find((dir) => existsSync(dir));
  if (!found) {
    throw new Error(
      "UI assets directory not found. Expected one of: " + uiDirCandidates.join(", ")
    );
  }
  return found;
}

const uiFileCache = new Map<string, string>();
let resolvedUiDir: string | null = null;
let uiDirResolutionAttempted = false;

const uiAssetContentTypes: Record<string, string> = {
  "app.css": "text/css; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8"
};

function readUiFile(fileName: string): string {
  const cached = uiFileCache.get(fileName);
  if (cached !== undefined) {
    return cached;
  }

  if (!uiDirResolutionAttempted) {
    resolvedUiDir = resolveUiDir();
    uiDirResolutionAttempted = true;
  }
  const uiDir = resolvedUiDir ?? resolveUiDir();
  const filePath = path.join(uiDir, fileName);
  const content = readFileSync(filePath, "utf8");
  uiFileCache.set(fileName, content);
  return content;
}

export function getWebUiHtml(): string {
  return readUiFile("index.html");
}

export function getWebUiAsset(
  assetName: string
): { contentType: string; content: string } | null {
  const contentType = uiAssetContentTypes[assetName];
  if (!contentType) {
    return null;
  }

  return {
    contentType,
    content: readUiFile(assetName)
  };
}
