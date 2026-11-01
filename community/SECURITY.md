# Security Policy

Agent Observer sees a lot about how you work: file paths, tool names, timings, and — if you
opt in — your prompts and the commands your agents run. We take its security seriously.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub:
**[Security → Report a vulnerability](https://github.com/jcalhinho/agent-observer/security/advisories/new)**.

Include what you can: affected version and OS, the steps or a proof of concept, and the
impact you expect. You will get an acknowledgement within **5 days** and an assessment
within **14 days**. We will keep you informed, agree on a disclosure date with you (90 days
at most by default), and credit you in the advisory unless you prefer otherwise.

## Supported versions

Agent Observer is pre-1.0: only the **latest release** receives security fixes.

## Scope

In scope — please report:

- **The local collector** (`127.0.0.1:43821`): reaching it from another machine, from a web
  page in a browser (CSRF, DNS rebinding, CORS), or without the bearer token; bypassing or
  leaking the token; crashing the app or exhausting memory/disk with crafted requests.
- **The collector token** (`collector-token` in the app config directory): weak generation,
  disclosure through the UI, logs, exports or the hook fragments.
- **Privacy guarantees**: content that should never be stored (agent responses, reasoning,
  tool outputs, file contents) ending up in the database or in an export; prompts or commands
  stored while their capture switch is off.
- **Connectors**: crafted agent logs, transcripts or databases leading to code execution,
  path traversal, writes outside the app's data directory, or any write to an agent's files.
- **Workspace and Git inspection**: a malicious repository or `.code-workspace` file causing
  command execution, writes, or reads outside the selected workspace.
- **The desktop shell**: Tauri capability or CSP weaknesses, script injection in the UI from
  observed data (file names, tool names, prompts).
- **Release integrity**: problems with how installers and checksums are built and published.

Out of scope:

- Attacks that need an attacker already running code as your user, or with access to your
  user's files (they can read the agents' own logs directly).
- The security of the observed agents themselves.
- Warnings from Gatekeeper or SmartScreen about unsigned builds — known and documented until
  releases are signed.
- Missing hardening without a demonstrated impact (we still welcome it as a normal issue).

## How Agent Observer limits exposure

- The collector binds to the loopback interface only and requires a random per-installation
  bearer token on every request.
- Agent databases are opened read-only; agent settings are never edited by the app.
- Private content is dropped by the connectors before anything is written to disk.
- No telemetry and no outgoing network requests.
