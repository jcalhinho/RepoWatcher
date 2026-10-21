import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readPreference, writePreference } from "./preferences";
import type { RepositorySnapshot, SessionEvent } from "./types";
import { pathKey, repositoryForEvent, unresolvedProjectPaths, type Workspace, type WorkspaceRepository } from "./workspace";

const SOURCE_KEY = "repowatcher.workspace-path";
const LEGACY_REPOSITORY_KEY = "repowatcher.selected-repository";
const ACTIVE_WINDOW_MS = 2 * 60_000;
const ACTIVE_REFRESH_MS = 5_000;
const IDLE_REFRESH_MS = 60_000;

export type RepositoryState = { snapshot: RepositorySnapshot | null; error: string | null };

function readSource() {
  const stored = readPreference<string | null>("workspace", null, (value): value is string | null => value === null || typeof value === "string");
  if (stored) return stored;
  try {
    // Earlier versions stored plain strings, including a single repository chosen before workspaces.
    return window.localStorage.getItem(SOURCE_KEY) ?? window.localStorage.getItem(LEGACY_REPOSITORY_KEY);
  } catch {
    return null;
  }
}

/**
 * The selected workspace (a folder or a `.code-workspace` file), its repositories, a matcher from
 * events to repositories, and Git snapshots refreshed often where agents are active, rarely elsewhere.
 */
export function useWorkspace(events: SessionEvent[]) {
  const [source, setSource] = useState<string | null>(readSource);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [states, setStates] = useState<Record<string, RepositoryState>>({});
  const lastFetched = useRef<Record<string, number>>({});
  const resolving = useRef(new Set<string>());

  useEffect(() => {
    writePreference("workspace", source);
    try {
      window.localStorage.removeItem(SOURCE_KEY);
      window.localStorage.removeItem(LEGACY_REPOSITORY_KEY);
    } catch { /* optional preference */ }
    setStates({});
    lastFetched.current = {};
    if (!source) {
      setWorkspace(null);
      setError(null);
      return;
    }
    let active = true;
    invoke<Workspace>("discover_workspace", { path: source })
      .then((found) => { if (active) { setWorkspace(found); setError(null); } })
      .catch((reason) => { if (active) { setWorkspace(null); setError(String(reason)); } });
    return () => { active = false; };
  }, [source]);

  const repositories = useMemo(() => workspace?.repositories ?? [], [workspace]);
  const repositoryOf = useCallback((event: Pick<SessionEvent, "project_path" | "file_path" | "project_hash">) => repositoryForEvent(event, repositories, resolved), [repositories, resolved]);

  // Paths outside every repository may be worktrees: ask Git for their main repository once.
  useEffect(() => {
    if (!repositories.length) return;
    const pending = unresolvedProjectPaths(events, repositories, resolved).filter((path) => !resolving.current.has(path));
    if (!pending.length) return;
    pending.forEach((path) => resolving.current.add(path));
    invoke<Record<string, string | null>>("resolve_repositories", { paths: pending })
      .then((result) => setResolved((current) => ({ ...current, ...result })))
      .catch(() => setResolved((current) => ({ ...current, ...Object.fromEntries(pending.map((path) => [path, null])) })));
  }, [events, repositories, resolved]);

  // Repositories with an agent event in the last two minutes.
  const activeKeys = useMemo(() => {
    const now = Date.now();
    const keys = new Set<string>();
    for (const event of events) {
      if (now - Date.parse(event.occurred_at) > ACTIVE_WINDOW_MS) break;
      const repository = repositoryOf(event);
      if (repository) keys.add(pathKey(repository.path));
    }
    return keys;
  }, [events, repositoryOf]);
  const activeRef = useRef(activeKeys);
  activeRef.current = activeKeys;

  useEffect(() => {
    if (!repositories.length) return;
    let cancelled = false;
    const refresh = async () => {
      const now = Date.now();
      const due = repositories.filter((repository) => {
        const interval = activeRef.current.has(pathKey(repository.path)) ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
        return now - (lastFetched.current[repository.path] ?? 0) >= interval;
      });
      // A few at a time so a large workspace does not spawn dozens of git processes at once.
      for (let index = 0; index < due.length && !cancelled; index += 4) {
        const batch = due.slice(index, index + 4);
        const results = await Promise.all(batch.map((repository) => invoke<RepositorySnapshot>("repository_snapshot", { path: repository.path })
          .then((snapshot): RepositoryState => ({ snapshot, error: null }))
          .catch((reason): RepositoryState => ({ snapshot: null, error: String(reason) }))));
        if (cancelled) return;
        batch.forEach((repository) => { lastFetched.current[repository.path] = Date.now(); });
        setStates((current) => ({ ...current, ...Object.fromEntries(batch.map((repository, position) => [repository.path, results[position]])) }));
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, ACTIVE_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [repositories]);

  return { source, setSource, workspace, error, repositories, repositoryOf, states, activeKeys };
}

export type WorkspaceModel = ReturnType<typeof useWorkspace>;
export type { WorkspaceRepository };
