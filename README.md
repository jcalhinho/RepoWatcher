# RepoWatcher - MVP local "type Jules"

MVP oriente repo local:
- ouvrir un repo en local
- discuter avec une session
- utiliser des commandes outillees pour lire/rechercher du code
- executer uniquement des commandes de verification autorisees
- mode agent LLM avec tool-calls controles (optionnel)

## Stack

- Node.js + TypeScript (workspaces npm)
- API: Fastify
- Core: outils securises pour repo local
- Tests: Vitest

## Prerequis

- Node.js 20+
- npm 10+

## Installation

```bash
npm install
```

## Validation

```bash
npm run typecheck
npm run test
npm run build
```

## Lancer l'API

```bash
npm run --workspace @repo-watcher/api dev
```

API par defaut: `http://127.0.0.1:8787`

UI web minimale: ouvre `http://127.0.0.1:8787/`
- creation de session locale
- chat manuel et mode agent
- affichage des steps outils et de la reponse brute JSON
- edition de fichier supervisee (load, preview diff, apply explicite)
- schema clair de la structure fichiers + interactions (JSON React Flow)
- graphe visuel interactif (pan/zoom + clic fichier)
- auto-scan initial du repo apres creation de session
- explication IA du fichier clique (role, interactions, utilite)

## Activer le mode agent LLM (optionnel)

Par defaut, l'API fonctionne en mode manuel (`/help`, `/list`, etc.).
Pour activer le mode agent autonome sur messages naturels:

```bash
export LLM_API_KEY="<secret>"
export LLM_MODEL="gpt-4.1-mini"
export LLM_BASE_URL="https://api.openai.com/v1"
npm run --workspace @repo-watcher/api dev
```

Variables supportees:
- `LLM_API_KEY` (obligatoire pour mode agent)
- `LLM_MODEL` (defaut: `gpt-4.1-mini`)
- `LLM_BASE_URL` (defaut: `https://api.openai.com/v1`)
- `LLM_TIMEOUT_MS` (defaut: `30000`)

## Ouvrir une session sur un repo local

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions \
  -H "content-type: application/json" \
  -d '{"repoPath":"/chemin/vers/ton-repo-local"}'
```

Reponse:

```json
{
  "id": "uuid",
  "repoPath": "/abs/path",
  "createdAt": "..."
}
```

## Envoyer un message

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/chat \
  -H "content-type: application/json" \
  -d '{"message":"/help"}'
```

Commandes supportees dans `message`:
- `/help`
- `/list [path]`
- `/read <path>`
- `/search <query>`
- `/run <commande>`

Message naturel (mode agent):

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/chat \
  -H "content-type: application/json" \
  -d '{"message":"analyse ce repo et dis-moi quels tests lancer en premier"}'
```

Raccourci UI:
- `Ctrl+Enter` (ou `Cmd+Enter` sur macOS) pour envoyer le message.

## Endpoints edition supervisee

Lire un fichier:

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/file/read \
  -H "content-type: application/json" \
  -d '{"path":"README.md"}'
```

Preview patch (sans ecriture):

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/apply_patch \
  -H "content-type: application/json" \
  -d '{"path":"README.md","newContent":"nouveau texte\\n","apply":false}'
```

Apply patch (avec garde hash):

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/apply_patch \
  -H "content-type: application/json" \
  -d '{"path":"README.md","newContent":"nouveau texte\\n","expectedOldHash":"<oldHash>","apply":true}'
```

## Endpoint schema React Flow

Genere un schema repo compatible React Flow (`nodes` + `edges`) :

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/repo_graph \
  -H "content-type: application/json" \
  -d '{"rootPath":"frontend/src","maxNodes":180}'
```

Reponse:
- `summary`: volume et couverture
- `nodes`: fichiers (id, label, position)
- `edges`: interactions detectees via imports locaux

## Endpoint auto-scan du repo

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/repo_overview \
  -H "content-type: application/json" \
  -d '{"rootPath":".","maxNodes":180}'
```

Retour:
- `mode`: `llm` ou `heuristic`
- `overview.overview`: synthese globale
- `overview.directoryNotes`: lecture par dossiers
- `overview.entryPoints`: points d'entree probables

## Endpoint explication IA d'un fichier

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/explain_file \
  -H "content-type: application/json" \
  -d '{"path":"frontend/src/main.ts","rootPath":"frontend/src","maxNodes":180}'
```

Retour:
- `mode`: `llm` ou `heuristic`
- `explanation.overview`
- `explanation.utilityInApp`
- `explanation.interactions`
- `explanation.keyFunctions`
- `explanation.risks`

Exemple verification:

```bash
curl -s -X POST http://127.0.0.1:8787/api/sessions/<SESSION_ID>/chat \
  -H "content-type: application/json" \
  -d '{"message":"/run npm test"}'
```

## Securite MVP

- path traversal bloque (acces limite au repo selectionne)
- execution shell deny-by-default
- allowlist stricte des commandes:
  - `ls -la`
  - `npm test`
  - `npm run lint`
  - `npm run build`
  - `pnpm test|lint|build`
  - `yarn test|lint|build`
  - `cat <fichier_relatif>`
  - `head -n <1..500> <fichier_relatif>`
  - `tail -n <1..500> <fichier_relatif>`
  - pipeline lecture sans shell: `cat|head|tail ... | head|tail ...` (2-3 segments max)

## Limites actuelles

- session stockee en memoire (pas de persistance DB)
- patch base sur remplacement de contenu (pas encore de format unified patch)
- pas encore d'integration git (branch/commit automatiques)
- detection d'interactions basee surtout sur imports locaux (JS/TS/Python)
- explications IA dependantes de la qualite du contexte scanne (`rootPath`, `maxNodes`)

## Prochaine etape recommandee

- brancher un orchestrateur de run persistant + DB (sessions/messages/runs)
- ajouter UI chat + viewer de diff
- integrer edition de code supervisee et workflow git (branche dediee)
