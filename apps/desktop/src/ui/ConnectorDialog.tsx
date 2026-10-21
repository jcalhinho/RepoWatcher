import { useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectorKind } from "./providers";

type CapturePolicy = { capture_prompts: boolean; capture_commands: boolean };
type ClaudeSetup = CapturePolicy & { endpoint: string; token: string; settings_fragment: string };
type CodexSetup = CapturePolicy & { sessions_dir: string; available: boolean };
type GeminiSetup = CapturePolicy & { sessions_dir: string; available: boolean };
type OpenCodeSetup = CapturePolicy & { data_dir: string; database_paths: string[]; available: boolean };
type CursorSetup = CapturePolicy & { endpoint: string; settings_fragment: string };
type SetupByKind = { claude: ClaudeSetup; codex: CodexSetup; gemini: GeminiSetup; opencode: OpenCodeSetup; cursor: CursorSetup };

export type ConnectorSetup = { [K in ConnectorKind]: { kind: K; setup: SetupByKind[K] } }[ConnectorKind];

const SETUP_COMMANDS: Record<ConnectorKind, string> = {
  claude: "claude_setup",
  codex: "codex_setup",
  gemini: "gemini_setup",
  opencode: "opencode_setup",
  cursor: "cursor_setup"
};

export async function loadConnectorSetup(kind: ConnectorKind): Promise<ConnectorSetup> {
  const setup = await invoke<SetupByKind[typeof kind]>(SETUP_COMMANDS[kind]);
  return { kind, setup } as ConnectorSetup;
}

/** Setup dialog of the active connector; the capture policy is shared by all connectors. */
export function ConnectorSetupDialog({ connector, onClose }: { connector: ConnectorSetup; onClose: () => void }) {
  const [capturePrompts, setCapturePrompts] = useState(connector.setup.capture_prompts);
  const [captureCommands, setCaptureCommands] = useState(connector.setup.capture_commands);
  const [policyError, setPolicyError] = useState("");
  const [copyState, setCopyState] = useState("Copier le fragment JSON");

  async function saveCapturePolicy(prompts: boolean, commands: boolean) {
    setPolicyError("");
    setCapturePrompts(prompts);
    setCaptureCommands(commands);
    try {
      await invoke("update_capture_policy", { capturePrompts: prompts, captureCommands: commands });
    } catch {
      setPolicyError("Impossible d’enregistrer les préférences depuis l’aperçu web.");
    }
  }

  const commandsToggle = (title: string, hint: string) => <CaptureToggle checked={captureCommands} onChange={(checked) => saveCapturePolicy(capturePrompts, checked)} title={title} hint={hint} />;
  const promptsToggle = (hint: string) => <CaptureToggle checked={capturePrompts} onChange={(checked) => saveCapturePolicy(checked, captureCommands)} title="Enregistrer le texte de mes prompts" hint={hint} />;
  const error = policyError && <p className="policy-error">{policyError}</p>;

  switch (connector.kind) {
    case "claude": {
      const { setup } = connector;
      const copy = async () => {
        await navigator.clipboard.writeText(setup.settings_fragment);
        setCopyState("Copié");
        window.setTimeout(() => setCopyState("Copier le fragment JSON"), 1800);
      };
      return <ConnectorDialog id="claude" eyebrow="CONNECTEUR LOCAL" title="Brancher Claude Code" onClose={onClose}>
        <p>Ajoute ce fragment dans les réglages utilisateur Claude Code (`~/.claude/settings.json`, ou `%USERPROFILE%\.claude\settings.json` sous Windows). Fusionne-le avec l’existant : ne remplace pas tout le fichier. Aucun réglage n’est modifié automatiquement.</p>
        <ol><li>Ouvre les réglages utilisateur Claude Code.</li><li>Ajoute les entrées <code>hooks</code> dans l’objet existant.</li><li>Redémarre une session Claude Code pour recevoir les événements.</li></ol>
        <div className="privacy-options">{commandsToggle("Enregistrer les commandes Bash/PowerShell", "Peuvent contenir des chemins, jetons ou mots de passe collés dans le shell.")}{promptsToggle("Peut inclure du code privé ou des données confidentielles.")}{error}<small>Si activé, le contenu reste dans la base SQLite locale de cette installation. Les sorties d’outils et transcriptions ne sont jamais conservées.</small></div>
        <textarea readOnly value={setup.settings_fragment} aria-label="Configuration Claude Code" />
        <div className="setup-note">Toujours captés : identifiant de session, outil, chemin du dépôt/fichier et type d’événement. Entrée locale authentifiée : <code>{setup.endpoint}</code></div>
        <div className="setup-actions"><button className="outline-button" onClick={onClose}>Fermer</button><button className="primary-button" onClick={copy}>{copyState}</button></div>
      </ConnectorDialog>;
    }
    case "cursor": {
      const { setup } = connector;
      return <ConnectorDialog id="cursor" eyebrow="CONNECTEUR LOCAL · HOOKS CURSOR" title="Brancher Cursor" onClose={onClose}>
        <p>Fusionne ce fragment dans <code>~/.cursor/hooks.json</code> (Windows : <code>%USERPROFILE%\.cursor\hooks.json</code>). Ne remplace pas un fichier existant : ajoute les événements dans son bloc <code>hooks</code>. Aucun réglage Cursor n’est modifié automatiquement.</p>
        <ol><li>Laisse Agent Observer ouvert pendant une session Cursor.</li><li>Ajoute le fragment aux réglages de hooks utilisateur.</li><li>Cursor recharge les hooks ; démarre une conversation pour vérifier le flux.</li></ol>
        <div className="privacy-options">{commandsToggle("Enregistrer les commandes transmises aux outils", "Désactivé par défaut ; peut contenir des secrets.")}<small>Prompts, réponses, sorties, transcriptions, identités et pensées ne sont pas conservés. Cursor n’expose pas de compteurs de tokens dans ces hooks.</small>{error}</div>
        <textarea readOnly value={setup.settings_fragment} aria-label="Configuration des hooks Cursor" />
        <div className="setup-note">Les hooks d’observation n’interviennent pas dans les autorisations de Cursor. Entrée locale authentifiée : <code>{setup.endpoint}</code></div>
        <div className="setup-actions"><button className="outline-button" onClick={onClose}>Fermer</button><button className="primary-button" onClick={async () => { await navigator.clipboard.writeText(setup.settings_fragment); onClose(); }}>Copier le fragment JSON</button></div>
      </ConnectorDialog>;
    }
    case "codex":
    case "gemini":
    case "opencode": {
      const source = localSourceCopy(connector);
      return <ConnectorDialog id={connector.kind} eyebrow={source.eyebrow} title={source.title} onClose={onClose}>
        <p>{source.description}</p>
        <div className="privacy-options"><div><b>{source.sourceLabel}</b><small>{source.sourceState}<br /><code>{source.sourcePath}</code></small></div>{commandsToggle("Enregistrer les commandes transmises aux outils", "Désactivé par défaut ; une commande peut contenir des secrets.")}{promptsToggle("Désactivé par défaut ; peut contenir du code et des données privées.")}{error}<small>{source.retention}</small></div>
        <div className="setup-note">{source.note}</div>
        <div className="setup-actions"><button className="primary-button" onClick={onClose}>Terminé</button></div>
      </ConnectorDialog>;
    }
  }
}

/** Copy of the read-only connectors that tail local journals or databases. */
function localSourceCopy(connector: Extract<ConnectorSetup, { kind: "codex" | "gemini" | "opencode" }>) {
  switch (connector.kind) {
    case "codex": return {
      eyebrow: "CONNECTEUR LOCAL · JOURNAUX NATIFS",
      title: "Codex est observé localement",
      description: "RepoWatcher suit les journaux de session Codex sur cet ordinateur ; aucun réglage Codex n’est modifié. Les nouveaux événements sont lus à mesure qu’ils sont écrits. L’historique antérieur au démarrage de RepoWatcher n’est pas importé.",
      sourceLabel: "Source locale",
      sourceState: connector.setup.available ? "Dossier Codex détecté" : "Dossier Codex absent pour l’instant",
      sourcePath: connector.setup.sessions_dir,
      retention: "Les sorties d’outils, réponses assistant et raisonnements ne sont jamais conservés. Seuls les champs opérationnels nécessaires à la timeline sont extraits.",
      note: "Codex peut fournir les événements d’outils et les compteurs input/output par requête dans ses journaux locaux. Ces compteurs ne sont pas un coût total universel et peuvent évoluer selon la version de Codex."
    };
    case "gemini": return {
      eyebrow: "CONNECTEUR LOCAL · JOURNAUX NATIFS",
      title: "Gemini CLI est observé localement",
      description: "RepoWatcher suit les enregistrements de sessions Gemini CLI ; aucun réglage Gemini n’est modifié. Les nouveaux messages sont suivis à mesure qu’ils sont écrits. L’historique antérieur au démarrage n’est pas importé.",
      sourceLabel: "Source locale",
      sourceState: connector.setup.available ? "Dossier Gemini détecté" : "Dossier Gemini absent pour l’instant",
      sourcePath: connector.setup.sessions_dir,
      retention: "Les sorties d’outils, réponses assistant et pensées ne sont jamais conservées. Seuls les champs opérationnels nécessaires à la timeline sont extraits.",
      note: "Gemini CLI stocke séparément des fichiers par projet. Le SHA-256 du chemin du projet sert à rapprocher ces événements du dépôt sélectionné sans révéler ni transmettre ce chemin à Gemini."
    };
    case "opencode": return {
      eyebrow: "CONNECTEUR LOCAL · SQLITE EN LECTURE SEULE",
      title: "OpenCode est observé localement",
      description: "RepoWatcher lit la base de sessions OpenCode en lecture seule. Aucun serveur n’est lancé et aucun réglage OpenCode n’est modifié. Seules les lignes ajoutées ou mises à jour après le lancement sont observées ; l’historique antérieur n’est pas importé.",
      sourceLabel: "Base détectée",
      sourceState: connector.setup.available ? "Base(s) SQLite trouvée(s)" : "Aucune base détectée pour l’instant",
      sourcePath: connector.setup.database_paths.join(" · ") || connector.setup.data_dir,
      retention: "Les textes assistant, raisonnements, sorties et résultats d’outils sont ignorés. Les compteurs input/output ne sont conservés que s’ils figurent dans les enregistrements OpenCode.",
      note: "OpenCode utilise SQLite avec journal WAL. Les sessions précédant le démarrage de RepoWatcher ne sont pas importées."
    };
  }
}

function ConnectorDialog({ id, eyebrow, title, onClose, children }: { id: string; eyebrow: string; title: string; onClose: () => void; children: ReactNode }) {
  return <div className="setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="setup-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={`${id}-setup-title`}><button className="setup-close" onClick={onClose} aria-label="Fermer">×</button><div className="eyebrow">{eyebrow}</div><h2 id={`${id}-setup-title`}>{title}</h2>{children}</section></div>;
}

function CaptureToggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (checked: boolean) => void; title: string; hint: string }) {
  return <label><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><b>{title}</b><small>{hint}</small></span></label>;
}
