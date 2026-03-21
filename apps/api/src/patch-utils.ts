import { createHash } from "node:crypto";

export type PatchPreview = {
  summary: string;
  addedLines: number;
  removedLines: number;
  unchangedLines: number;
  hunk: string;
};

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function clampPreview(content: string, maxChars = 40_000): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n...[truncated]`;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildPatchPreview(oldContent: string, newContent: string): PatchPreview {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);

  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let oldSuffixIndex = oldLines.length - 1;
  let newSuffixIndex = newLines.length - 1;
  while (
    oldSuffixIndex >= prefix &&
    newSuffixIndex >= prefix &&
    oldLines[oldSuffixIndex] === newLines[newSuffixIndex]
  ) {
    oldSuffixIndex -= 1;
    newSuffixIndex -= 1;
  }

  const removed = oldSuffixIndex >= prefix ? oldLines.slice(prefix, oldSuffixIndex + 1) : [];
  const added = newSuffixIndex >= prefix ? newLines.slice(prefix, newSuffixIndex + 1) : [];
  const unchanged = prefix + Math.max(0, oldLines.length - oldSuffixIndex - 1);

  const hunkHeader = `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`;
  const removedLines = removed.map((line) => `-${line}`);
  const addedLines = added.map((line) => `+${line}`);
  const hunk = [hunkHeader, ...removedLines, ...addedLines].join("\n");

  return {
    summary: removed.length === 0 && added.length === 0 ? "No change." : "Change detected.",
    addedLines: added.length,
    removedLines: removed.length,
    unchangedLines: unchanged,
    hunk: clampPreview(hunk, 16_000)
  };
}
