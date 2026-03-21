# RepoWatcher

Assistant local pour explorer rapidement un dépôt: structure, interactions entre fichiers, zones à risque, explications pédagogiques par clic, et chat outillé sécurisé.

## Ce que fait l'application

- Ouvre une session sur un repo local.
- Lance un **scan de codebase** (fichiers + interactions) et construit un graphe interactif.
- Affiche deux types de liens dans le graphe:
  - **Imports** (dépendances techniques)
  - **User flow** (parcours fonctionnel estimé)
- Met en avant:
  - fichiers clés
  - zones de risque
  - interactions importantes
- Au clic sur un fichier, génère une explication IA orientée onboarding:
  - rôle du fichier
  - fonctions et variables importantes
  - imports/exports
  - utilité dans le flow global
- Fournit un chat (streaming) avec outils contrôlés (`list/read/search/run`).
- Propose une édition supervisée (`read`, preview diff, apply patch avec garde hash).

## Stack

- Monorepo npm workspaces
- Node.js + TypeScript
- API: Fastify
- Validation: Vitest + TypeScript typecheck

## Arborescence

- `apps/api` : serveur HTTP + UI web
- `apps/worker` : worker local (base pour exécution future)
- `packages/core` : sécurité repo local, path guard, policy commandes
- `docs` : blueprint/backlog

## Prérequis

- Node.js 20+
- npm 10+

## Installation

```bash
npm install
```

## Vérification

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

## Lancer l'API

```bash
npm run --workspace @repo-watcher/api dev
```

- API: `http://127.0.0.1:8787`
- UI: `http://127.0.0.1:8787/`

## Variables d'environnement (mode agent LLM)

Le mode manuel fonctionne sans clé LLM.

Pour activer le mode agent:

```bash
export LLM_API_KEY="<secret>"
export LLM_MODEL="gpt-4.1-mini"
export LLM_BASE_URL="https://api.openai.com/v1"
npm run --workspace @repo-watcher/api dev
```

Variables supportées:

- `LLM_API_KEY`
- `LLM_MODEL` (défaut: `gpt-4.1-mini`)
- `LLM_BASE_URL` (défaut: `https://api.openai.com/v1`)
- `LLM_TIMEOUT_MS` (défaut: `30000`)

## Endpoints principaux

### Santé

- `GET /health`

### Session

- `POST /api/sessions`

```json
{ "repoPath": "/abs/path/to/repo" }
```

### Chat

- `POST /api/sessions/:sessionId/chat`
- `POST /api/sessions/:sessionId/chat/stream`

### Fichiers / patch

- `POST /api/sessions/:sessionId/file/read`
- `POST /api/sessions/:sessionId/apply_patch`

### Graphe / intelligence repo

- `POST /api/sessions/:sessionId/repo_graph`
- `POST /api/sessions/:sessionId/repo_overview`
- `POST /api/sessions/:sessionId/explain_file`

## Commandes manuelles disponibles

- `/help`
- `/list [path]`
- `/read <path>`
- `/search <query>`
- `/run <commande>`

## Politique sécurité commandes (`/run`)

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
- pipeline de lecture sans shell (2-3 segments max):
  - `head -n 400 fichier.ts | tail -n 50`
  - `cat README.md | tail -n 20`

Contraintes:

- pas de chemins absolus
- pas de `..`
- pas de shell libre

## Limites actuelles

- Sessions en mémoire (pas de persistance DB)
- Détection user-flow heuristique
- Explications IA dépendantes du contexte scanné
- Pas de workflow Git automatique (branch/commit)

## Licence

Ce projet est sous licence **MIT**. Voir [LICENSE](./LICENSE).
