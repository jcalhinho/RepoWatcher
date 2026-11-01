import type { SessionEvent } from "./types";

export type WorkspaceRepository = { path: string; name: string; project_hash: string };
export type Workspace = { source: "folder" | "code-workspace"; path: string; label: string; repositories: WorkspaceRepository[]; missing_folders: string[] };

/** Repository filter: every event, one repository (by path), or events outside the workspace. */
export type RepositoryFilter = "all" | "outside" | string;

/** Separator-agnostic, trailing-slash-free, case-insensitive key (Windows and macOS paths are usually case-insensitive). */
export function pathKey(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function within(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Repository an event belongs to: the deepest workspace repository containing its project or file
 * path; otherwise the main repository `resolved` maps that path to (worktrees); Gemini CLI events,
 * which only carry a hash of their project path, match by hash.
 */
export function repositoryForEvent(event: Pick<SessionEvent, "project_path" | "file_path" | "project_hash">, repositories: WorkspaceRepository[], resolved: Record<string, string | null> = {}): WorkspaceRepository | null {
  const roots = repositories.map((repository) => ({ repository, key: pathKey(repository.path) })).sort((a, b) => b.key.length - a.key.length);
  const match = (path: string | null | undefined) => {
    if (!path) return null;
    const key = pathKey(path);
    return roots.find((root) => within(key, root.key))?.repository ?? null;
  };
  const direct = match(event.project_path) ?? match(event.file_path);
  if (direct) return direct;
  const main = event.project_path ? resolved[event.project_path] : null;
  const viaWorktree = match(main);
  if (viaWorktree) return viaWorktree;
  return event.project_hash ? repositories.find((repository) => repository.project_hash === event.project_hash) ?? null : null;
}

/** Project paths that matched no workspace repository and have not been resolved yet. */
export function unresolvedProjectPaths(events: SessionEvent[], repositories: WorkspaceRepository[], resolved: Record<string, string | null>) {
  const paths = new Set<string>();
  for (const event of events) {
    if (!event.project_path || event.project_path in resolved) continue;
    if (!repositoryForEvent({ project_path: event.project_path, file_path: null, project_hash: null }, repositories)) paths.add(event.project_path);
  }
  return [...paths];
}

export function filterByRepository(events: SessionEvent[], filter: RepositoryFilter, repositoryOf: (event: SessionEvent) => WorkspaceRepository | null) {
  if (filter === "all") return events;
  if (filter === "outside") return events.filter((event) => !repositoryOf(event));
  const key = pathKey(filter);
  return events.filter((event) => {
    const repository = repositoryOf(event);
    return repository !== null && pathKey(repository.path) === key;
  });
}
