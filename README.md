# RepoWatcher

Assistant local pour explorer rapidement un dépôt: structure, interactions entre fichiers, zones à risque, explications pédagogiques par clic, et chat outillé sécurisé.

---

## FR - Vue d'ensemble

### Ce que fait l'application

- Ouvre une session sur un repo local.
- Lance un scan de codebase (fichiers + interactions) et construit un graphe interactif.
- Affiche quatre types de liens dans le graphe:
  - `Imports` (dépendances techniques)
  - `API links` (appels détectés entre fichiers frontend et routes backend)
  - `Config links` (interactions détectées entre fichiers de config, y compris backend/frontend)
  - `User flow` (parcours fonctionnel estimé)
- Met en avant fichiers clés, zones de risque, et parcours d'exploration.
- Raccourcit les chemins dans les chips pour la lisibilité (chemin complet en tooltip).
- Au clic sur un fichier, génère une explication IA orientée onboarding (junior -> senior):
  - rôle du fichier
  - fonctions et variables importantes
  - imports/exports
  - utilité dans le flow global
- Fournit un chat (streaming) avec outils contrôlés (`list/read/search/run`).
- Propose une édition supervisée (`read`, preview diff, apply patch avec garde hash).

### Support multi-langages (graphe)

Le graphe indexe désormais de nombreux langages, par exemple:

- JS/TS, Python
- Java/Kotlin/Scala/Groovy
- Go, Rust
- C#/F#/VB
- C/C++/ObjC
- PHP, Ruby, Lua, Perl, Shell
- Swift, Dart, Elixir, Erlang, Haskell, Clojure, R, Julia

### Prompts LLM (Gemini via endpoint OpenAI-compatible)

RepoWatcher utilise plusieurs prompts système, par design, car chaque endpoint a un objectif différent.

#### Quand les prompts sont appelés

1. `POST /api/sessions/:sessionId/chat` et `/chat/stream`
   - Prompt: `apps/api/src/agent-orchestrator.ts` (`SYSTEM_PROMPT`)
   - Rôle précis:
     - piloter un agent outillé (`list/read/search/run`)
     - forcer un format JSON strict (`action` ou `final`)
     - analyser le repo sans halluciner
     - produire la réponse finale en français

2. `POST /api/sessions/:sessionId/explain_file`
   - Prompt: `apps/api/src/repo-intelligence.ts` (`systemPrompt` de `generateFileExplanation`)
   - Rôle précis:
     - expliquer un fichier dans son contexte d'application
     - rendre l'explication pédagogique tous niveaux
     - renvoyer un JSON structuré (`overview`, `utilityInApp`, `interactions`, etc.)
     - imposer des valeurs de sortie en français

3. `POST /api/sessions/:sessionId/repo_overview`
   - Prompt: `apps/api/src/repo-intelligence.ts` (`systemPrompt` de `generateRepoOverview`)
   - Rôle précis:
     - fournir un brief d'onboarding global du repo
     - renvoyer un JSON structuré (`overview`, `directoryNotes`, `entryPoints`, `suggestedCommands`)
     - imposer des valeurs de sortie en français

Pourquoi plusieurs prompts:

- Ce n'est pas une confusion.
- C'est une séparation de responsabilités:
  - agent outillé de conversation
  - explication d'un fichier
  - synthèse globale du repo

### Stack

- Monorepo npm workspaces
- Node.js + TypeScript
- API: Fastify
- Validation: Vitest + TypeScript typecheck

### Arborescence

- `apps/api`: serveur HTTP + UI web
- `apps/worker`: worker local (base pour exécution future)
- `packages/core`: sécurité repo local, path guard, policy commandes
- `docs`: blueprint/backlog

### Prérequis

- Node.js 20+
- npm 10+

### Installation

```bash
npm install
```

### Vérification

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

### Lancer l'API

```bash
npm run --workspace @repo-watcher/api dev
```

- API: `http://127.0.0.1:8787`
- UI: `http://127.0.0.1:8787/`

### Variables d'environnement (mode agent LLM)

Le mode manuel fonctionne sans clé LLM.

Pour activer le mode agent:

```bash
export LLM_API_KEY="<secret>"
export LLM_MODEL="gemini-2.5-pro"
export LLM_BASE_URL="<openai-compatible-endpoint>"
npm run --workspace @repo-watcher/api dev
```

Variables supportées:

- `LLM_API_KEY`
- `LLM_MODEL` (défaut: `gpt-4.1-mini`)
- `LLM_BASE_URL` (défaut: `https://api.openai.com/v1`)
- `LLM_TIMEOUT_MS` (défaut: `30000`)

### Endpoints principaux

- Santé: `GET /health`
- Session: `POST /api/sessions`
- Chat: `POST /api/sessions/:sessionId/chat`, `POST /api/sessions/:sessionId/chat/stream`
- Fichiers/Patch: `POST /api/sessions/:sessionId/file/read`, `POST /api/sessions/:sessionId/apply_patch`
- Graphe/Intelligence:
  - `POST /api/sessions/:sessionId/repo_graph`
  - `POST /api/sessions/:sessionId/repo_overview`
  - `POST /api/sessions/:sessionId/explain_file`

### Commandes manuelles disponibles

- `/help`
- `/list [path]`
- `/read <path>`
- `/search <query>`
- `/run <commande>`

### Politique sécurité commandes (`/run`)

Allowlist stricte (deny-by-default):

- `ls -la`
- `npm test`
- `npm run lint`
- `npm run build`
- `pnpm test|lint|build`
- `yarn test|lint|build`
- `cat <fichier_relatif>`
- `head -n <1..500> <fichier_relatif>`
- `tail -n <1..500> <fichier_relatif>`
- pipeline de lecture sans shell (2-3 segments max), ex:
  - `head -n 400 fichier.ts | tail -n 50`
  - `cat README.md | tail -n 20`
- commandes de lecture Windows (sans WSL, uniquement sous Windows):
  - `cmd /c dir`
  - `cmd /c dir docs`
  - `cmd /c type README.md`
  - `powershell -NoProfile -Command Get-Content -Path README.md`
  - `powershell -NoProfile -Command Get-Content -Path README.md -Tail 20`
  - `powershell -NoProfile -Command Get-Content -Path README.md -TotalCount 20`

Contraintes:

- pas de chemins absolus
- pas de `..`
- pas de shell libre

### Limites actuelles

- Sessions en mémoire (pas de persistance DB)
- Détection user-flow et config-links partiellement heuristique
- Explications IA dépendantes du contexte scanné
- Pas de workflow Git automatique (branch/commit)

---

## EN - Overview

### What the application does

- Opens a session on a local repository.
- Scans the codebase (files + interactions) and builds an interactive graph.
- Shows four graph edge types:
  - `Imports` (technical dependencies)
  - `API links` (detected frontend-to-backend route calls)
  - `Config links` (detected interactions between config files, including backend/frontend)
  - `User flow` (estimated functional journey)
- Highlights key files, risk areas, and exploration trail.
- Shortens chip paths for readability (full path kept in tooltip).
- On file click, generates onboarding-oriented AI explanations (junior -> senior):
  - file role
  - key functions/variables
  - imports/exports
  - role in overall flow
- Provides a streaming chat with controlled tools (`list/read/search/run`).
- Provides supervised editing (`read`, diff preview, hash-guarded apply patch).

### Multi-language graph support

The graph now indexes many languages, including:

- JS/TS, Python
- Java/Kotlin/Scala/Groovy
- Go, Rust
- C#/F#/VB
- C/C++/ObjC
- PHP, Ruby, Lua, Perl, Shell
- Swift, Dart, Elixir, Erlang, Haskell, Clojure, R, Julia

### LLM prompts (Gemini through OpenAI-compatible endpoint)

RepoWatcher intentionally uses multiple system prompts because each endpoint has a different responsibility.

#### When prompts are called

1. `POST /api/sessions/:sessionId/chat` and `/chat/stream`
   - Prompt: `apps/api/src/agent-orchestrator.ts` (`SYSTEM_PROMPT`)
   - Purpose:
     - orchestrate a tool-using analysis agent (`list/read/search/run`)
     - enforce strict JSON output (`action` or `final`)
     - keep analysis grounded in repository evidence
     - enforce final answer content in French

2. `POST /api/sessions/:sessionId/explain_file`
   - Prompt: `apps/api/src/repo-intelligence.ts` (`generateFileExplanation` system prompt)
   - Purpose:
     - explain one file in app context
     - keep explanations pedagogical for mixed seniority
     - return structured JSON (`overview`, `utilityInApp`, `interactions`, etc.)
     - force French output values

3. `POST /api/sessions/:sessionId/repo_overview`
   - Prompt: `apps/api/src/repo-intelligence.ts` (`generateRepoOverview` system prompt)
   - Purpose:
     - generate a repository onboarding brief
     - return structured JSON (`overview`, `directoryNotes`, `entryPoints`, `suggestedCommands`)
     - force French output values

Why multiple prompts:

- This is not confusion.
- It is separation of concerns:
  - conversational tool-using agent
  - file-level pedagogical explanation
  - repository-level onboarding summary

### Stack

- npm workspaces monorepo
- Node.js + TypeScript
- API: Fastify
- Validation: Vitest + TypeScript typecheck

### Structure

- `apps/api`: HTTP server + web UI
- `apps/worker`: local worker (future execution base)
- `packages/core`: local repo security, path guard, command policy
- `docs`: blueprint/backlog

### Requirements

- Node.js 20+
- npm 10+

### Install

```bash
npm install
```

### Verify

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

### Run API

```bash
npm run --workspace @repo-watcher/api dev
```

- API: `http://127.0.0.1:8787`
- UI: `http://127.0.0.1:8787/`

### Environment variables (LLM agent mode)

Manual mode works without LLM credentials.

To enable agent mode:

```bash
export LLM_API_KEY="<secret>"
export LLM_MODEL="gemini-2.5-pro"
export LLM_BASE_URL="<openai-compatible-endpoint>"
npm run --workspace @repo-watcher/api dev
```

Supported variables:

- `LLM_API_KEY`
- `LLM_MODEL` (default: `gpt-4.1-mini`)
- `LLM_BASE_URL` (default: `https://api.openai.com/v1`)
- `LLM_TIMEOUT_MS` (default: `30000`)

## License

MIT. See [LICENSE](./LICENSE).
