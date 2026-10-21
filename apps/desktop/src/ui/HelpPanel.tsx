import { X } from "lucide-react";
import { STATUS_INFO } from "./AgentCard";
import type { PulseStatus } from "./agentPulse";

const GLOSSARY: Array<[string, string]> = [
  ["Agent", "Un assistant de code (Claude Code, Codex, Gemini CLI, OpenCode, Qwen Code) qui lit et modifie ton projet à ta demande."],
  ["Session", "Une conversation avec un agent, du premier message à la fermeture."],
  ["Tour", "Un aller-retour : ton message, puis tout le travail que l’agent fait pour y répondre."],
  ["Outil", "Une action de l’agent : lire un fichier, le modifier, chercher dans le code, lancer une commande…"],
  ["Événement", "Une trace reçue par l’app : une action, un message, la fin d’un tour, un relevé de tokens."],
  ["Token", "Unité de texte traitée par le modèle d’IA (environ ¾ de mot). Les « tokens lus » sont le contexte envoyé au modèle, les « tokens écrits » sa réponse."],
  ["Cache", "Partie du contexte que le fournisseur a déjà vue et réutilise : elle coûte beaucoup moins cher (10 % du prix chez Anthropic)."],
  ["Coût estimé", "Calcul à partir des prix publics du modèle. Ce n’est pas une facture : abonnements, forfaits et remises ne sont pas connus de l’app."],
  ["Workspace", "Un dossier (ou un fichier .code-workspace de VS Code) qui regroupe plusieurs dépôts Git suivis ensemble."],
  ["Dépôt", "Un projet suivi par Git. L’app montre son état (branche, changements non enregistrés) à côté de l’activité des agents."],
  ["Connecteur", "La façon dont l’app observe un agent : en lisant ses journaux ou en recevant ses notifications (hooks)."]
];

const STATUS_ORDER: PulseStatus[] = ["blocked", "stalled", "waiting", "working", "idle", "never"];

/** Side panel explaining how the app works, what every state means, and the vocabulary used. */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  return <div className="dialog-backdrop drawer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="help-drawer" role="dialog" aria-modal="true" aria-labelledby="help-title" tabIndex={-1}>
      <header className="dialog-header"><h2 id="help-title">Comment ça marche</h2><button className="icon-button" onClick={onClose} aria-label="Fermer l’aide"><X size={16} /></button></header>
      <div className="help-content">
        <section>
          <h3>En une phrase</h3>
          <p>Agent Observer regarde travailler tes agents de code sur cet ordinateur et te montre, en direct, ce qu’ils font, où, et ce que ça consomme. Il ne les pilote jamais et n’envoie rien sur Internet.</p>
        </section>
        <section>
          <h3>Bien démarrer</h3>
          <ol className="steps">
            <li><b>Connecteurs</b> : vérifie que tes agents sont détectés ; branche Claude Code si tu l’utilises.</li>
            <li><b>Workspace</b> (en haut à gauche) : choisis le dossier qui contient tes projets.</li>
            <li>Travaille normalement avec tes agents : la vue d’ensemble se remplit toute seule.</li>
          </ol>
        </section>
        <section>
          <h3>Que veulent dire les statuts ?</h3>
          <dl className="status-list">{STATUS_ORDER.map((status) => <div key={status} className={`status-${status}`}><dt><span className="status-badge">{STATUS_INFO[status].label}</span></dt><dd>{STATUS_INFO[status].explanation}</dd></div>)}</dl>
        </section>
        <section>
          <h3>Lire les chiffres</h3>
          <p>Les valeurs viennent de ce que chaque agent transmet. Quand un agent ne fournit pas une information (par exemple les tokens), l’app affiche « non fourni » plutôt que d’inventer un chiffre. Les estimations (coût) sont toujours signalées comme telles.</p>
          <p>Un changement Git n’est jamais attribué à un agent : l’app montre l’état des dépôts et l’activité des agents côte à côte, sans deviner qui a fait quoi.</p>
        </section>
        <section>
          <h3>Astuces</h3>
          <ul>
            <li>Survole ou clique sur <span className="inline-info">i</span> pour une explication.</li>
            <li>Tire la barre sous une section pour l’agrandir ; double-clic pour revenir à la taille d’origine. Le bouton en haut à droite d’une section l’affiche en plein écran (Échap pour revenir).</li>
            <li>Le <b>mode mini</b> garde une colonne d’agents dans un coin de l’écran.</li>
          </ul>
        </section>
        <section>
          <h3>Glossaire</h3>
          <dl className="glossary">{GLOSSARY.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
        </section>
      </div>
    </aside>
  </div>;
}
