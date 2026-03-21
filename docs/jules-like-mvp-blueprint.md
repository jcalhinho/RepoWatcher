# MVP: App "Type Jules" (Assistant de code)

## 1) Objectif produit

Construire une application qui:
- prend une demande en langage naturel
- comprend un depot code cible
- propose puis applique des modifications
- execute des validations (lint/test/build)
- explique ce qui a ete change et pourquoi

## 2) Portee MVP (a livrer en premier)

Inclus:
- chat de session unique
- connexion a un seul depot local ou clone git
- recherche de code (fichiers + symboles)
- generation de patchs sur une branche de travail
- execution de commandes de verification (allowlist)
- resume des changements + etat des checks

Exclus (phase 2+):
- multi-agent complexe
- review automatique avancee multi-PR
- marketplace d’extensions
- execution cloud distribuee multi-tenant

## 3) Architecture cible (simple, evolutive)

Composants:
- `web`: interface chat + diff viewer + logs
- `api`: orchestration session, auth, policies
- `worker`: boucle agent + appels outils
- `sandbox`: execution isolee (commande/fichiers/git)
- `storage`: Postgres (sessions, messages, runs, artefacts)

Flux principal:
1. L’utilisateur envoie une tache.
2. Le worker planifie des etapes.
3. L’agent utilise des outils (read/search/edit/run).
4. Le sandbox applique les changements sur branche dediee.
5. Les checks sont executes et traces.
6. L’UI affiche diff, logs, verdict et prochaines actions.

## 4) Outils agent (contrats minimaux)

Outils a exposer:
- `repo.read(path)`
- `repo.search(query)`
- `repo.edit(path, patch)`
- `repo.list()`
- `git.status()`
- `git.branch_create(name)`
- `git.commit(message)`
- `shell.run(command)` (allowlist stricte)

Garde-fous:
- timeout par outil
- limite de sortie (tokens/lignes)
- retries bornes
- journalisation complete (qui a lance quoi)

## 5) Securite (non-negociable)

- sandbox sans privilege par defaut
- deny-by-default pour commandes shell
- secrets masques dans logs/reponses
- isolation par workspace
- validation stricte des inputs utilisateur
- aucune execution destructive sans confirmation explicite

## 6) Modele de donnees MVP

Tables minimales:
- `users`
- `projects`
- `sessions`
- `messages`
- `runs`
- `run_steps`
- `artifacts` (diffs, logs, resultats de checks)

Contraintes:
- timestamps UTC
- idempotence sur relance de run
- etats explicites: `queued/running/succeeded/failed/canceled`

## 7) Stack recommandee (pragmatique)

- Frontend: Next.js + TypeScript
- API: Fastify ou Next route handlers
- Worker: Node.js + queue (BullMQ/Redis)
- DB: PostgreSQL
- Sandbox: process isole (container/namespace selon infra)
- Observabilite: logs structures + traces + erreurs

## 8) Roadmap (4 increments)

Increment 1: "Hello Agent"
- chat + lecture repo + reponse explicative
- pas d’ecriture

Increment 2: "Patch Local"
- edition de fichiers + diff viewer
- branche de travail dediee

Increment 3: "Validate"
- execution lint/test/build via allowlist
- synthese des resultats

Increment 4: "Production Hardening"
- auth/projets multi-workspace
- quotas, audit trail, monitoring, retries

## 9) Criteres d’acceptation MVP

- une tache simple (ex: corriger bug mineur) peut etre completee de bout en bout
- diff lisible et reproductible
- checks techniques affiches et fiables
- aucune commande non autorisee n’est executee
- echec explicite et recuperable (pas de blocage silencieux)

## 10) Risques majeurs + mitigations

- Hallucination de code/API:
  - mitigation: outils de lecture obligatoires avant ecriture
- Boucles agent:
  - mitigation: limite d’iterations + watchdog
- Regressions:
  - mitigation: checks automatiques + branche isolee
- Fuite de secrets:
  - mitigation: redaction centralisee + scans
- Cout inference:
  - mitigation: budget par run + cache contextuel

## 11) Plan de test initial

Tests unitaires:
- parse des commandes, policies allow/deny, transitions d’etats

Tests integration:
- session complete: prompt -> patch -> checks -> resume
- erreurs sandbox, timeout outil, commande interdite

Tests e2e:
- utilisateur cree session, lance tache, voit diff, approuve/rejette

Tests securite:
- tentatives de prompt injection outil
- commandes shell interdites
- verification redaction de secrets dans logs

## 12) Definition of Done (phase MVP)

- code lint/typecheck/tests verts
- zero warning critique securite
- documentation d’exploitation minimale
- runbook incident basique (timeouts, echec sandbox, queue bloquee)
