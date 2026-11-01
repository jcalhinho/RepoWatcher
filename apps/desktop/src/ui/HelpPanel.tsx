import { X } from "lucide-react";
import { statusInfo } from "./AgentCard";
import type { PulseStatus } from "./agentPulse";
import { t } from "./i18n";

function glossary(): Array<[string, string]> {
  return [
    [t("Agent", "Agent"), t("Un assistant de code (Claude Code, Codex, Gemini CLI, OpenCode, Qwen Code…) qui lit et modifie ton projet à ta demande.", "A coding assistant (Claude Code, Codex, Gemini CLI, OpenCode, Qwen Code…) that reads and edits your project on request.")],
    [t("Session", "Session"), t("Une conversation avec un agent, du premier message à la fermeture.", "One conversation with an agent, from the first message to closing it.")],
    [t("Tour", "Turn"), t("Un aller-retour : ton message, puis tout le travail que l’agent fait pour y répondre.", "One round trip: your message, then all the work the agent does to answer it.")],
    [t("Outil", "Tool"), t("Une action de l’agent : lire un fichier, le modifier, chercher dans le code, lancer une commande…", "An action of the agent: read a file, edit it, search the code, run a command…")],
    [t("Événement", "Event"), t("Une trace reçue par l’app : une action, un message, la fin d’un tour, un relevé de tokens.", "A trace received by the app: an action, a message, the end of a turn, a token report.")],
    ["Token", t("Unité de texte traitée par le modèle d’IA (environ ¾ de mot). Les « tokens lus » sont le contexte envoyé au modèle, les « tokens écrits » sa réponse.", "Unit of text processed by the AI model (about ¾ of a word). “Read” tokens are the context sent to the model, “written” tokens its answer.")],
    ["Cache", t("Partie du contexte que le fournisseur a déjà vue et réutilise : elle coûte beaucoup moins cher (10 % du prix chez Anthropic).", "Part of the context the provider has already seen and reuses: it costs far less (10% of the price at Anthropic).")],
    [t("Coût estimé", "Estimated cost"), t("Calcul à partir des prix publics du modèle. Ce n’est pas une facture : abonnements, forfaits et remises ne sont pas connus de l’app.", "Computed from the model’s public prices. Not an invoice: subscriptions, plans and discounts are unknown to the app.")],
    ["Workspace", t("Un dossier (ou un fichier .code-workspace de VS Code) qui regroupe plusieurs dépôts Git suivis ensemble.", "A folder (or a VS Code .code-workspace file) grouping several Git repositories followed together.")],
    [t("Dépôt", "Repository"), t("Un projet suivi par Git. L’app montre son état (branche, changements non enregistrés) à côté de l’activité des agents.", "A project tracked by Git. The app shows its state (branch, uncommitted changes) next to the agents’ activity.")],
    [t("Connecteur", "Connector"), t("La façon dont l’app observe un agent : en lisant ses journaux, en recevant ses notifications (hooks) ou via l’API locale.", "How the app observes an agent: reading its logs, receiving its notifications (hooks) or through the local API.")]
  ];
}

const STATUS_ORDER: PulseStatus[] = ["looping", "blocked", "stalled", "waiting", "working", "idle", "never"];

/** Side panel explaining how the app works, what every state means, and the vocabulary used. */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  return <div className="dialog-backdrop drawer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="help-drawer" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1}>
      <header className="dialog-header"><h2 id="help-title">{t("Comment ça marche", "How it works")}</h2><button className="icon-button" onClick={onClose} aria-label={t("Fermer l’aide", "Close help")}><X size={16} /></button></header>
      <div className="help-content">
        <section>
          <h3>{t("En une phrase", "In one sentence")}</h3>
          <p>{t("Agent Observer regarde travailler tes agents de code sur cet ordinateur et te montre, en direct, ce qu’ils font, où, ce que ça consomme, et quand ils ont besoin de toi. Il ne les pilote jamais et n’envoie rien sur Internet.", "Agent Observer watches your coding agents work on this computer and shows you, live, what they do, where, what it costs, and when they need you. It never drives them and sends nothing over the Internet.")}</p>
        </section>
        <section>
          <h3>{t("Bien démarrer", "Getting started")}</h3>
          <ol className="steps">
            <li><b>{t("Connecteurs", "Connectors")}</b> : {t("vérifie que tes agents sont détectés ; branche Claude Code si tu l’utilises.", "check that your agents are detected; set up Claude Code if you use it.")}</li>
            <li><b>Workspace</b> ({t("en haut à gauche", "top left")}) : {t("choisis le dossier qui contient tes projets.", "pick the folder that holds your projects.")}</li>
            <li>{t("Travaille normalement avec tes agents : la vue d’ensemble se remplit toute seule. Clique sur une carte pour aller directement à l’agent.", "Work with your agents as usual: the overview fills itself. Click a card to jump straight to the agent.")}</li>
          </ol>
        </section>
        <section>
          <h3>{t("Que veulent dire les statuts ?", "What do the statuses mean?")}</h3>
          <dl className="status-list">{STATUS_ORDER.map((status) => <div key={status} className={`status-${status}`}><dt><span className="status-badge">{statusInfo(status).label}</span></dt><dd>{statusInfo(status).explanation}</dd></div>)}</dl>
        </section>
        <section>
          <h3>{t("Notifications", "Notifications")}</h3>
          <p>{t("L’app te prévient quand un agent t’attend, demande une validation, devient silencieux, enchaîne les erreurs ou tourne en rond. Un clic sur la notification t’amène à l’agent. Les alertes (boucle, erreurs) s’affichent aussi en rouge en haut de l’app. Tout se règle dans Réglages.", "The app tells you when an agent waits for you, asks for approval, goes silent, keeps failing or goes round in circles. Clicking the notification takes you to the agent. Alerts (loops, errors) also show in red at the top of the app. Everything is set in Settings.")}</p>
        </section>
        <section>
          <h3>{t("Lire les chiffres", "Reading the numbers")}</h3>
          <p>{t("Les valeurs viennent de ce que chaque agent transmet. Quand un agent ne fournit pas une information (par exemple les tokens), l’app affiche « non fourni » plutôt que d’inventer un chiffre. Les estimations (coût) sont toujours signalées comme telles.", "Values come from what each agent reports. When an agent doesn’t provide something (tokens, for instance), the app shows “not reported” rather than making up a number. Estimates (cost) are always labelled as such.")}</p>
          <p>{t("Un changement Git n’est jamais attribué à un agent : l’app montre l’état des dépôts et l’activité des agents côte à côte, sans deviner qui a fait quoi.", "A Git change is never attributed to an agent: the app shows repository state and agent activity side by side, without guessing who did what.")}</p>
        </section>
        <section>
          <h3>{t("Astuces", "Tips")}</h3>
          <ul>
            <li>{t("Survole ou clique sur", "Hover or click")} <span className="inline-info">i</span> {t("pour une explication.", "for an explanation.")}</li>
            <li>{t("Tire la barre sous une section pour l’agrandir ; double-clic pour revenir à la taille d’origine. Le bouton en haut à droite d’une section l’affiche en plein écran (Échap pour revenir).", "Drag the bar under a section to resize it; double-click to reset. The button at the top right of a section shows it full screen (Escape to go back).")}</li>
            <li>{t("Le mode mini garde une colonne d’agents dans un coin de l’écran.", "Mini mode keeps a column of agents in a corner of the screen.")}</li>
          </ul>
        </section>
        <section>
          <h3>{t("Glossaire", "Glossary")}</h3>
          <dl className="glossary">{glossary().map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
        </section>
      </div>
    </aside>
  </div>;
}
