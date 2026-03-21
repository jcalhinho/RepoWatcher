import path from "node:path";

export function resolveInsideRoot(rootPath: string, candidatePath: string): string {
  const normalizedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(normalizedRoot, candidatePath);
  const relative = path.relative(normalizedRoot, resolvedPath);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedPath;
  }

  throw new Error(`Path escapes repository root: ${candidatePath}`);
}

export function toRelativePosix(rootPath: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(rootPath), path.resolve(absolutePath));
  return relative.split(path.sep).join("/");
}
