export type SessionEvent = {
  event_id: string;
  session_id: string;
  occurred_at: string;
  /** Backend provider key (see `Provider.eventKey`). */
  provider: string;
  /** Custom connector id when `provider` is "custom" (rekeyed to `custom:<id>` on load). */
  agent?: string | null;
  kind: string;
  project_path: string | null;
  project_hash?: string | null;
  tool_name: string | null;
  command?: string | null;
  file_path: string | null;
  content?: string | null;
  input_tokens?: { value: number; origin: string } | null;
  output_tokens?: { value: number; origin: string } | null;
  /** Cached prompt tokens, reported apart from `input_tokens` (Claude Code transcripts). */
  cache_read_tokens?: { value: number; origin: string } | null;
  cache_write_tokens?: { value: number; origin: string } | null;
  model?: { value: string; origin: string } | null;
  duration_ms?: { value: number; origin: string } | null;
  outcome?: string | null;
};

export type RepositorySnapshot = {
  root: string;
  project_hash: string;
  branch: string | null;
  /** Commits ahead of / behind the upstream branch; null without an upstream. */
  ahead: number | null;
  behind: number | null;
  changed_files: Array<{ path: string; status: string }>;
  recent_commits: Array<{ short_id: string; subject: string; relative_time: string }>;
};

export function sessionKey(event: SessionEvent) { return `${event.provider}:${event.session_id}`; }
export function compareEventsNewestFirst(a: SessionEvent, b: SessionEvent) {
  return b.occurred_at.localeCompare(a.occurred_at) || b.event_id.localeCompare(a.event_id);
}
