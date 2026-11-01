import path from "node:path";
import { lstat, realpath } from "node:fs/promises";

function isInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function throwPathEscape(candidatePath: string): never {
  throw new Error(`Path escapes repository root: ${candidatePath}`);
}

export function resolveInsideRoot(rootPath: string, candidatePath: string): string {
  const normalizedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(normalizedRoot, candidatePath);
  if (isInside(normalizedRoot, resolvedPath)) {
    return resolvedPath;
  }

  return throwPathEscape(candidatePath);
}

export async function resolveExistingInsideRoot(
  rootPath: string,
  candidatePath: string
): Promise<string> {
  const normalizedRoot = await realpath(path.resolve(rootPath));
  const candidate = resolveInsideRoot(normalizedRoot, candidatePath);
  const resolvedCandidate = await realpath(candidate);
  if (!isInside(normalizedRoot, resolvedCandidate)) {
    throwPathEscape(candidatePath);
  }
  return resolvedCandidate;
}

export async function resolveWritableInsideRoot(
  rootPath: string,
  candidatePath: string
): Promise<string> {
  const normalizedRoot = await realpath(path.resolve(rootPath));
  const candidate = resolveInsideRoot(normalizedRoot, candidatePath);

  try {
    const resolvedCandidate = await realpath(candidate);
    if (!isInside(normalizedRoot, resolvedCandidate)) {
      throwPathEscape(candidatePath);
    }
    return resolvedCandidate;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
    const candidateInfo = await lstat(candidate).catch((lstatError: NodeJS.ErrnoException) => {
      if (lstatError.code === "ENOENT") return null;
      throw lstatError;
    });
    if (candidateInfo?.isSymbolicLink()) throwPathEscape(candidatePath);
  }

  const missingSegments: string[] = [];
  let ancestor = path.dirname(candidate);
  while (true) {
    try {
      const resolvedAncestor = await realpath(ancestor);
      if (!isInside(normalizedRoot, resolvedAncestor)) {
        throwPathEscape(candidatePath);
      }
      return path.join(resolvedAncestor, ...missingSegments, path.basename(candidate));
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
      const ancestorInfo = await lstat(ancestor).catch((lstatError: NodeJS.ErrnoException) => {
        if (lstatError.code === "ENOENT") return null;
        throw lstatError;
      });
      if (ancestorInfo?.isSymbolicLink()) throwPathEscape(candidatePath);
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        throw error;
      }
      missingSegments.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

export function toRelativePosix(rootPath: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(rootPath), path.resolve(absolutePath));
  return relative.split(path.sep).join("/");
}
