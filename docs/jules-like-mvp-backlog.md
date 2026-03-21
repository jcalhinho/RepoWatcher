# Backlog d'Implementation - App Type Jules

## Priorite P0

1. Initialiser le mono-repo
- Contenu: `apps/web`, `apps/api`, `apps/worker`, `packages/shared`
- Acceptance: bootstrap OK, commandes `lint`/`test`/`build` presentes

2. Modele DB minimal
- Contenu: tables `projects/sessions/messages/runs/run_steps/artifacts`
- Acceptance: migrations applicables localement, schema versionne

3. API Sessions
- Contenu: create/get/list session, add message
- Acceptance: endpoints testes, validation d'entree stricte

4. Tooling lecture repo (read/list/search)
- Contenu: outils read-only encapsules
- Acceptance: impossible de sortir du workspace autorise

5. UI chat minimale
- Contenu: creer session, envoyer message, afficher reponse agent
- Acceptance: flux utilisateur complet sans crash

## Priorite P1

6. Edition de fichiers via patch
- Contenu: outil `repo.edit` + diff affiche cote UI
- Acceptance: diff exact avant/apres et rollback possible

7. Git workflow isole
- Contenu: branche de travail par run, status + commit
- Acceptance: aucun impact sur branche principale par defaut

8. Shell.run en allowlist
- Contenu: ex: `npm test`, `npm run lint`, `npm run build`
- Acceptance: commandes hors allowlist refusees avec message explicite

9. Orchestrateur de run
- Contenu: etats run + steps + retries bornes
- Acceptance: etats coherents meme en cas d'echec outil

10. Logs et observabilite de base
- Contenu: logs structures + correlation id run/session
- Acceptance: debug d'un echec possible sans reproduction manuelle

## Priorite P2

11. Auth + isolation projet
- Contenu: auth utilisateur + segregation donnees
- Acceptance: un user ne voit jamais les sessions d'un autre

12. Quotas et budget par run
- Contenu: limite outils, tokens, duree max
- Acceptance: depassement coupe proprement le run

13. Securite hardening
- Contenu: redaction secrets, scans patterns sensibles, audit trail
- Acceptance: aucune valeur sensible en clair dans logs standards

14. E2E critique
- Contenu: test "prompt -> patch -> checks -> resume"
- Acceptance: scenario stable sur CI

## Regles d'execution

- Un ticket = un intent = un diff court.
- Validation technique obligatoire a chaque ticket.
- Pas de nouvelle dependance sans justification ecrite.
- Toute commande potentiellement destructive doit exiger confirmation explicite.
