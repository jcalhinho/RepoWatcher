# Connecting an agent

Agent Observer ships with built-in connectors for Claude Code, Codex, Gemini CLI, OpenCode and
Qwen Code. Any other agent, script or tool can show up in the app through the **open local API**,
and new built-in connectors can be contributed in Rust.

## 1. Open local API (no code change in the app)

1. In the app, open **Connecteurs → Connecteurs personnalisés**, type a name and click
   **Ajouter un connecteur**. The connector gets its own colour and its own token.
2. Send events to `POST http://127.0.0.1:43821/v1/events` with the header
   `Authorization: Bearer <token>`. The collector only listens on `127.0.0.1`.
3. The agent appears like the built-in ones: card, race lane, charts, notifications, sessions.

Deleting the connector revokes its token. Events already received stay in the history.

### Request

The body is one event, or an array of up to 500 events (1 MB max).

```json
{
  "session_id": "2026-10-21-refactor",
  "kind": "tool_finished",
  "occurred_at": "2026-10-21T10:00:00Z",
  "event_id": "call-42",
  "project_path": "/Users/me/projects/api",
  "tool_name": "bash",
  "file_path": "/Users/me/projects/api/src/main.rs",
  "duration_ms": 1250
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `session_id` | string (1–200) | yes | Groups events into a session (one conversation with the agent). |
| `kind` | string | yes | One of the event kinds below. |
| `occurred_at` | RFC 3339 date | no | When it happened; defaults to the time of reception. |
| `event_id` | string | no | Your own id. Sending the same id again updates the event instead of duplicating it (safe retries). |
| `project_path` | string | no | Folder the agent works in. Used to attach the event to a workspace repository and to “go to the agent”. |
| `tool_name` | string | no | Tool used (`bash`, `edit`, `read`…). |
| `file_path` | string | no | File the action targets. Tools named like `edit`/`write`/`patch` count as modifications. |
| `command` | string | no | Command line. **Stored only if the user enabled command capture.** |
| `content` | string | no | Prompt text. **Stored only if the user enabled prompt capture.** |
| `model` | string | no | Model id, used for the estimated cost (see `apps/desktop/src/ui/pricing.ts`). |
| `outcome` | string | no | Free status, e.g. `error`. A checkpoint whose outcome contains `error` is a failed turn. |
| `input_tokens`, `output_tokens` | integer | no | Tokens reported by the model provider. `input_tokens` is uncached input. |
| `cache_read_tokens`, `cache_write_tokens` | integer | no | Cached prompt tokens, reported apart. |
| `duration_ms` | integer | no | Duration of the action or turn. |

Unknown fields are rejected, so a typo is reported instead of being silently ignored.

### Event kinds

| `kind` | Use it when |
|---|---|
| `session_started` / `session_ended` | The agent starts or closes a session. |
| `user_message` | The user sends a message: starts a turn. |
| `tool_started` / `tool_finished` / `tool_failed` | The agent runs an action. If you only know the end, send `tool_finished` or `tool_failed` alone. |
| `file_read` / `file_changed` | A file was read or modified outside a tool call. |
| `model_usage` | A model response with its token counts. |
| `checkpoint` | The turn ended (the agent waits for the user). Use `outcome: "error"` for a failed turn. |
| `assistant_message` | The agent replied (text is never stored). |

The statuses shown in the app (working, waiting for you, silent, blocked, going round in circles)
are derived from this stream: send at least `user_message`, tool events and a `checkpoint` per
turn for them to be accurate.

### Responses

- `200 {"accepted": 3}`: stored.
- `400 {"error": "Événement 1 : unknown variant `dancing` …"}`: the message says which event and why.
- `401`: unknown token. `413`: body over 1 MB.

### Examples

```sh
curl -X POST http://127.0.0.1:43821/v1/events \
  -H "Authorization: Bearer $AGENT_OBSERVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id": "s1", "kind": "user_message", "project_path": "'"$PWD"'"}'
```

```python
import json, os, urllib.request

def observe(event: dict) -> None:
    request = urllib.request.Request(
        "http://127.0.0.1:43821/v1/events",
        data=json.dumps(event).encode(),
        headers={"Authorization": f"Bearer {os.environ['AGENT_OBSERVER_TOKEN']}", "Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(request, timeout=2)
    except OSError:
        pass  # never let observability break the agent
```

Keep the call non-blocking for the agent: short timeout, errors ignored.

## 2. Built-in connector (Rust)

Built-in connectors live in `apps/desktop/src-tauri/src/`, one module per agent
(`codex_rollout.rs`, `gemini_sessions.rs`, `qwen_sessions.rs`, `opencode_sessions.rs`,
`claude_transcripts.rs`). They follow the same pattern:

1. **Find the data the agent already writes** (logs, local database) or receives (hooks). Never
   change the agent's settings; read-only access.
2. **Read only what is appended after startup** — no history import — and survive truncated or
   rotated files.
3. **Project records to `SessionEvent`** (`crates/session-events`): metadata only. Prompt text and
   commands go through the shared capture policy; assistant text, reasoning and tool outputs are
   never stored. Values the agent does not report stay `None`: never estimate silently.
4. **Use stable event ids** when a record can be read twice (UUID v5 from the agent's own ids).
5. **Spawn the monitor** in `main.rs` and add the agent to `Provider` in `crates/session-events`
   and to the provider table in `apps/desktop/src/ui/providers.ts` (keys must match — a test checks it).
6. **Test with fixtures** built in the test (see the `tests` modules of existing connectors) and
   check the projection on real local data without printing its content.

Pull requests adding a connector should state which agent versions were tested and what the
connector cannot observe.
