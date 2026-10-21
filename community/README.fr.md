<div align="center">

# Agent Observer

**Voir ce que font tes agents de code — et lequel a besoin de toi — sans rien envoyer nulle part.**

Une app de bureau locale pour macOS et Windows qui regarde travailler Claude Code, Codex,
Gemini CLI, OpenCode et Qwen Code sur ta machine, en direct.

[![CI](https://github.com/jcalhinho/agent-observer/actions/workflows/ci.yml/badge.svg)](https://github.com/jcalhinho/agent-observer/actions/workflows/ci.yml)
[![Dernière version](https://img.shields.io/github/v/release/jcalhinho/agent-observer?include_prereleases&sort=semver)](https://github.com/jcalhinho/agent-observer/releases)
[![Licence : MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Télécharger](#installation) · [Fonctionnalités](#fonctionnalités) · [Confidentialité](#confidentialité) · [Compiler](#compiler-depuis-les-sources) · [Contribuer](CONTRIBUTING.md) · [English](README.md)

<!-- Capture : docs/media/overview.png — tableau de bord avec les cartes d’agents et la course -->
<img src="docs/media/overview.png" alt="Tableau de bord d’Agent Observer : une carte par agent, la course 3D et les graphiques d’activité" width="900">

</div>

---

## Pourquoi

Faire tourner deux ou trois agents de code en parallèle est devenu courant. Savoir lequel a
fini, lequel attend ta validation et lequel échoue sur la même commande depuis cinq minutes,
beaucoup moins. Agent Observer répond d’un coup d’œil à une question : **qui a besoin de moi
maintenant ?**

Il ne fait **qu’observer**. Il ne pilote jamais un agent, ne modifie jamais ton code, ne
change pas les réglages d’un agent à ta place et ne communique pas avec Internet.

> **État :** jeune (0.x). L’interface est pour l’instant en **français** ; la traduction
> anglaise est prévue et les contributions sont bienvenues.

## Fonctionnalités

### Cartes d’agents — « qui a besoin de toi »

Une carte par agent, triées pour que ceux qui demandent ton attention passent en premier.
Chaque carte dit en clair ce que fait l’agent, dans quel dépôt, depuis combien de temps, et
ce que la session a consommé.

| Statut | Signification |
| --- | --- |
| **Bloqué** | Au moins deux outils ont échoué d’affilée : il tourne peut-être en rond. |
| **Silencieux** | Un tour est en cours mais rien ne se passe depuis plus de 2 minutes : il attend souvent ta validation. |
| **T’attend** | Son dernier tour est terminé : il est prêt pour ton prochain message. |
| **Au travail** | Des événements sont arrivés dans les 45 dernières secondes. |
| **Au repos** | Aucune activité récente. |
| **Pas encore vu** | Rien reçu : vérifie son connecteur. |

### Mode mini

Réduit l’app à une colonne toujours visible dans un coin de l’écran, une carte compacte par
agent, avec une épingle « garder au premier plan ».

<!-- GIF : docs/media/mini-mode.gif -->

### La course

Un stade low-poly en 3D où chaque agent est un coureur sur un 100 m : chaque événement le
fait sauter, un outil en échec le fait tomber puis se relever, la fin d’un tour l’envoie à
l’arrivée. Une bulle raconte ce qu’il fait. La distance est un indicateur d’activité, jamais
un pourcentage d’avancement. Le réglage système *réduire les animations* est respecté.

<!-- GIF : docs/media/race.gif -->

### Analyse

Rythme d’événements, appels d’outils et échecs, tokens lus / écrits / en cache par agent et
par modèle, sur 15 minutes, 1 heure, 24 heures ou tout l’historique. Un coût **estimé** est
affiché pour les modèles dont le prix public figure dans
[`pricing.ts`](apps/desktop/src/ui/pricing.ts) (pour l’instant les modèles Claude), toujours
présenté comme une estimation, jamais comme une facture. Quand un agent ne fournit pas une
valeur, l’app affiche *non fourni* au lieu de deviner.

<!-- Capture : docs/media/analytics.png -->

### Workspaces

Choisis un dossier (tous les dépôts Git jusqu’à quatre niveaux de profondeur sont trouvés)
ou un fichier `.code-workspace` de VS Code. Chaque événement est rattaché au dépôt où il a eu
lieu — un worktree compte pour le clone dont il dépend — et un filtre restreint la course, les
graphiques et le fil d’activité à un dépôt. Le tableau des dépôts montre côte à côte branche,
avance/retard, changements non commités, agents vus et dernière activité. Les dépôts sont lus,
jamais modifiés, et un changement Git n’est **jamais attribué à un agent** sans preuve.

<!-- Capture : docs/media/workspace.png -->

### Sessions

Toutes les sessions observées, des plus récentes aux plus anciennes, avec un résumé de fin de
session (durée, tours, outils, échecs, tokens, coût estimé, commits faits pendant la session)
et la chronologie complète des événements. Remonte dans les événements anciens, exporte tout
l’historique local en JSON, ou efface-le.

<!-- Capture : docs/media/sessions.png -->

## Agents pris en charge

| Agent | Comment il est observé | Ce que tu dois faire |
| --- | --- | --- |
| **Claude Code** | [Hooks HTTP](https://docs.claude.com/en/docs/claude-code/hooks) officiels envoyés au collecteur local, et consommation de tokens lue dans les nouvelles lignes de ses transcriptions (`~/.claude/projects/**.jsonl`, `CLAUDE_CONFIG_DIR` respecté). | Copier le fragment affiché dans l’onglet **Connecteurs** dans `~/.claude/settings.json`. L’app ne le modifie jamais à ta place. |
| **Codex** | Les enregistrements JSONL ajoutés dans `~/.codex/sessions` (`CODEX_HOME` respecté). | Rien. |
| **Gemini CLI** | Les journaux de conversation locaux dans `~/.gemini/tmp` (`GEMINI_CLI_HOME` respecté). | Rien. |
| **OpenCode** | Sa base SQLite locale (`~/.local/share/opencode/opencode*.db`, `OPENCODE_DB` / `OPENCODE_DATA_DIR` respectés), ouverte en **lecture seule**. | Rien. |
| **Qwen Code** | Les enregistrements JSONL ajoutés dans `~/.qwen/projects/<projet>/chats`. | Rien. |

Sous Windows, `~` correspond à `%USERPROFILE%`. Les connecteurs à journaux se placent à la
fin des fichiers existants et n’observent que les nouveaux enregistrements : l’historique
antérieur au lancement de l’app n’est pas importé.

Un connecteur Cursor (hooks) existe dans le moteur natif mais est masqué dans l’interface
pour l’instant. GitHub Copilot, Cline, Roo Code, Continue et Aider ne sont **pas** encore
connectés — voir [ajouter un agent](#ajouter-ton-agent).

## Confidentialité

Tout reste sur ton ordinateur. L’app ne fait aucune requête réseau, à part recevoir des hooks
sur `127.0.0.1`.

**Enregistré par défaut** — le *déroulé* du travail : quel agent, quelle session, quel outil,
quel chemin de fichier, quand, combien de temps, succès ou échec, nom du modèle et nombres de
tokens fournis par l’agent lui-même.

**Sur option** (Réglages, désactivé par défaut) — le texte de tes messages aux agents, et les
commandes lancées par les agents. Les deux peuvent contenir des secrets : à activer en
connaissance de cause.

**Jamais enregistré** — les réponses des agents, leurs raisonnements, les sorties et résultats
des outils, le contenu des fichiers, les chemins des transcriptions.

- Les événements sont stockés dans une base SQLite locale, dans le dossier de données de
  l’application (`~/Library/Application Support/dev.repowatcher.agentobserver/` sur macOS,
  `%LOCALAPPDATA%\dev.repowatcher.agentobserver\` sur Windows).
- La durée de conservation se règle (de 7 jours à illimitée) ; les événements plus anciens
  sont supprimés au démarrage puis toutes les heures. L’historique peut être exporté en JSON
  ou effacé depuis les Réglages.
- Le collecteur de hooks écoute uniquement sur `127.0.0.1:43821` et refuse toute requête sans
  le jeton propre à l’installation, généré au premier lancement.

Voir [SECURITY.md](SECURITY.md) pour le modèle de menace et le signalement des vulnérabilités.

## Installation

Télécharge le dernier installateur sur la [page Releases](https://github.com/jcalhinho/agent-observer/releases)
et vérifie-le avec le fichier `SHA256SUMS.txt` de la même release.

| Plateforme | Fichier |
| --- | --- |
| macOS, Apple Silicon (M1 et suivants) | `Agent-Observer_<version>_macos-arm64.dmg` |
| macOS, Intel | `Agent-Observer_<version>_macos-x64.dmg` |
| Windows 10/11, installation utilisateur (recommandé) | `Agent-Observer_<version>_windows-x64-setup.exe` |
| Windows 10/11, MSI pour déploiement géré | `Agent-Observer_<version>_windows-x64.msi` |

> [!IMPORTANT]
> Les premières versions ne sont **pas encore signées** (ni Apple Developer ID, ni certificat
> de signature Windows) : ton système va donc t’avertir la première fois. Les étapes
> ci-dessous sont la manière standard d’ouvrir une app en laquelle tu as confiance. En cas de
> doute, [compile-la toi-même](#compiler-depuis-les-sources). Sur un poste professionnel,
> respecte la politique de ton entreprise plutôt que de la contourner.

### macOS

1. Ouvre le `.dmg` et glisse **Agent Observer** dans **Applications**.
2. Lance-la une première fois depuis **Applications** : macOS indique qu’il ne peut pas
   vérifier le développeur.
3. Autorise-la, selon ta version de macOS :
   - **macOS 15 Sequoia et suivants :** clique sur **OK**, ouvre **Réglages Système →
     Confidentialité et sécurité**, descends jusqu’au message concernant l’app et clique sur
     **Ouvrir quand même**, puis confirme avec ton mot de passe.
   - **macOS 14 et antérieurs :** dans le Finder, **clic droit (ou Contrôle-clic) sur l’app →
     Ouvrir**, puis **Ouvrir** dans la fenêtre.

Ce n’est à faire qu’une fois. Si macOS affirme que l’app **« est endommagée et ne peut pas
être ouverte »**, c’est l’attribut de quarantaine posé au téléchargement d’une app non signée,
pas un vrai dommage. Retire-le dans le Terminal :

```bash
xattr -dr com.apple.quarantine "/Applications/RepoWatcher Agent Observer.app"
```

### Windows

1. Lance `…-setup.exe`. Il installe l’app pour l’utilisateur courant, sans droits
   administrateur.
2. Si **Microsoft Defender SmartScreen** affiche *« Windows a protégé votre ordinateur »*,
   clique sur **Informations complémentaires → Exécuter quand même**.
3. WebView2 est déjà présent sur Windows 10/11 ; l’installateur le télécharge s’il manque.

Vérifie l’empreinte dans PowerShell avant de le lancer :

```powershell
Get-FileHash .\Agent-Observer_*_windows-x64-setup.exe -Algorithm SHA256
```

### Premier lancement

1. Onglet **Connecteurs** : vérifie que tes agents sont détectés. Pour Claude Code, copie le
   fragment affiché dans `~/.claude/settings.json` (le jeton qu’il contient est propre à cet
   ordinateur).
2. **Workspace** (en haut à gauche) : choisis le dossier qui contient tes projets.
3. Travaille normalement avec tes agents : le tableau de bord se remplit tout seul. Le bouton
   **?** explique chaque statut et chaque chiffre.

Une seule instance tourne à la fois : la relancer ramène la fenêtre existante au premier plan.

## Compiler depuis les sources

Prérequis : [Node.js 22](https://nodejs.org/), [Rust](https://rustup.rs/) stable (1.85 ou
plus) et les [prérequis Tauri 2](https://v2.tauri.app/start/prerequisites/) de ton système
(Xcode Command Line Tools sur macOS ; Microsoft C++ Build Tools et WebView2 sur Windows ;
WebKitGTK 4.1 sur Linux).

```bash
git clone https://github.com/jcalhinho/agent-observer.git
cd agent-observer
npm ci
npm run desktop:dev      # développement, rechargement à chaud
npm run desktop:build    # installateurs dans target/release/bundle/
```

Sur macOS, `npm run desktop:install-mac` compile l’app et l’installe dans `/Applications`.
Linux compile mais n’est pas encore empaqueté ni officiellement pris en charge.

## Architecture

```
CLI des agents ──hooks (HTTP, 127.0.0.1 + jeton)───────┐
               ──journaux locaux / SQLite (lecture seule)┤
                                                         ▼
                 Connecteurs Rust (apps/desktop/src-tauri/src/*_sessions.rs, codex_rollout.rs, …)
                                                         │  SessionEvent (crates/session-events)
                                                         ▼
                 Stockage SQLite + commandes/événements Tauri (src-tauri/src/main.rs)
                                                         │
                                                         ▼
                 UI React (apps/desktop/src/ui) — cartes, mode mini, course, analyse, workspaces
```

- **`crates/session-events`** — le modèle d’événement commun à tous les connecteurs,
  indépendant des fournisseurs. Chaque valeur mesurée porte son origine (`Provider`,
  `LocalObservation`, `Derived`, `Estimated`) : un connecteur omet ce qu’il ne peut pas
  observer plutôt que de l’inventer.
- **Connecteurs** (`apps/desktop/src-tauri/src/`) — un module Rust par agent, qui transforme
  ses hooks, journaux JSONL ou lignes SQLite en `SessionEvent`, en écartant le contenu privé
  avant tout enregistrement.
- **Coquille de bureau** — Tauri 2 : collecteur local (axum), stockage SQLite (rusqlite),
  lecture des workspaces et de Git (lecture seule), conservation.
- **UI** — React 19 + Vite, graphiques en SVG, course en three.js via react-three-fiber. La
  logique pure (statuts, analyse, prix, rattachement aux dépôts) vit dans des modules `.ts`
  testés avec Vitest.

## Ajouter ton agent

Deux façons d’intégrer un nouvel agent :

- **API HTTP locale** *(en cours)* — envoyer des événements au collecteur local depuis un
  script, un hook ou un plugin, dans n’importe quel langage. Documentée dans
  [`docs/CONNECTORS.md`](docs/CONNECTORS.md).
- **Connecteur natif** — un module Rust dans l’app. Voir
  [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-connector).

Un prix de modèle manquant ou faux ? Ouvre une [issue « prix de modèle »](https://github.com/jcalhinho/agent-observer/issues/new?template=model_price.yml)
avec un lien vers la page de tarifs officielle du fournisseur.

## FAQ

**Est-ce que mon code ou mes messages partent quelque part ?**
Non. Aucune télémétrie, aucun accès réseau en dehors du collecteur local. Tes messages et les
commandes ne sont même pas enregistrés localement, sauf si tu l’actives.

**Est-ce que ça ralentit mes agents ?**
Les connecteurs à journaux lisent seulement les nouvelles lignes de fichiers que les agents
écrivent déjà. Les hooks de Claude Code sont des appels HTTP avec un délai de 2 secondes ; si
l’app est fermée, Claude Code continue normalement.

**Pourquoi le coût est-il « estimé » ?**
Il est calculé à partir des prix publics et des tokens déclarés par l’agent. Abonnements,
forfaits, remises et tarifs batch sont inconnus de l’app. Un modèle sans prix sourcé n’affiche
aucun coût.

**Pourquoi l’agent X n’affiche-t-il pas de tokens ?**
Parce qu’il ne les fournit pas dans ce que l’app peut lire. L’app affiche *non fourni* plutôt
qu’une estimation.

**Voit-il les sessions commencées avant son lancement ?**
Non. Les connecteurs observent l’activité à partir du lancement de l’app ; l’historique
antérieur n’est pas importé. Tout ce qui est observé ensuite reste disponible, selon ta durée
de conservation.

**Le port 43821 est déjà utilisé.**
Une autre copie de l’app (ou autre chose) l’occupe. Une seule instance peut recevoir les
hooks ; l’onglet Connecteurs affiche l’état du collecteur.

**Pourquoi l’app n’est-elle pas signée ?**
Les certificats de signature coûtent de l’argent et du temps ; la chaîne de publication est
prête à signer et notariser dès qu’ils seront disponibles. En attendant, chaque release est
compilée par GitHub Actions depuis le tag et accompagnée de ses empreintes SHA-256.

## Contribuer

Signalements de bugs, demandes de connecteurs, prix de modèles, traductions et code sont tous
bienvenus : commence par [CONTRIBUTING.md](CONTRIBUTING.md). Chaque participant s’engage à
respecter le [Code de conduite](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE). Agent Observer est un projet indépendant, sans lien avec Anthropic, OpenAI,
Google, Alibaba ou le projet OpenCode. Les noms de produits appartiennent à leurs
propriétaires.
