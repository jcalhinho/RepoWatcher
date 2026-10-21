import { describe, expect, it } from "vitest";
import { filterByRepository, repositoryForEvent, unresolvedProjectPaths, type WorkspaceRepository } from "./workspace";
import type { SessionEvent } from "./types";

const repos: WorkspaceRepository[] = [
  { path: "/Users/me/Projects/api", name: "api", project_hash: "hash-api" },
  { path: "/Users/me/Projects/web", name: "web", project_hash: "hash-web" },
  { path: "/Users/me/Projects/web/packages/ui", name: "ui", project_hash: "hash-ui" },
  { path: "C:\\work\\tool", name: "tool", project_hash: "hash-tool" }
];

let counter = 0;
function event(extra: Partial<SessionEvent>): SessionEvent {
  counter += 1;
  return { event_id: `e${counter}`, session_id: "s", occurred_at: "2026-10-21T12:00:00Z", provider: "codex", kind: "tool_started", project_path: null, tool_name: null, file_path: null, ...extra };
}

describe("workspace repository matching", () => {
  it("matches the deepest repository containing the agent's folder, including subfolders", () => {
    expect(repositoryForEvent(event({ project_path: "/Users/me/Projects/api/src" }), repos)?.name).toBe("api");
    expect(repositoryForEvent(event({ project_path: "/Users/me/Projects/web/packages/ui" }), repos)?.name).toBe("ui");
    expect(repositoryForEvent(event({ project_path: "/Users/me/Projects/web/" }), repos)?.name).toBe("web");
    expect(repositoryForEvent(event({ project_path: "/Users/me/Projects/webapp" }), repos)).toBeNull();
  });

  it("ignores separators and case for Windows paths and falls back to the file path", () => {
    expect(repositoryForEvent(event({ project_path: "c:/WORK/Tool/src" }), repos)?.name).toBe("tool");
    expect(repositoryForEvent(event({ file_path: "/Users/me/Projects/api/README.md" }), repos)?.name).toBe("api");
  });

  it("maps worktrees through resolved main repositories and Gemini events by hash", () => {
    const worktree = event({ project_path: "/private/tmp/api-feature" });
    expect(repositoryForEvent(worktree, repos)).toBeNull();
    expect(repositoryForEvent(worktree, repos, { "/private/tmp/api-feature": "/Users/me/Projects/api" })?.name).toBe("api");
    expect(repositoryForEvent(event({ provider: "gemini_cli", project_hash: "hash-web" }), repos)?.name).toBe("web");
  });

  it("lists unmatched project paths once and filters events by repository", () => {
    const events = [
      event({ project_path: "/Users/me/Projects/api" }),
      event({ project_path: "/tmp/elsewhere" }),
      event({ project_path: "/tmp/elsewhere" }),
      event({ project_path: "/tmp/known" })
    ];
    expect(unresolvedProjectPaths(events, repos, { "/tmp/known": null })).toEqual(["/tmp/elsewhere"]);
    const of = (item: SessionEvent) => repositoryForEvent(item, repos);
    expect(filterByRepository(events, "/Users/me/Projects/api/", of)).toHaveLength(1);
    expect(filterByRepository(events, "outside", of)).toHaveLength(3);
    expect(filterByRepository(events, "all", of)).toHaveLength(4);
  });
});
