import { useState, type ReactNode } from "react";
import { t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import type { ConnectorKind } from "./providers";

type ClaudeSetup = { endpoint: string; token: string; settings_fragment: string };
type CodexSetup = { sessions_dir: string; available: boolean };
type GeminiSetup = { sessions_dir: string; available: boolean };
type OpenCodeSetup = { data_dir: string; database_paths: string[]; available: boolean };
type QwenSetup = { projects_dir: string; available: boolean };
type SetupByKind = { claude: ClaudeSetup; codex: CodexSetup; gemini: GeminiSetup; opencode: OpenCodeSetup; qwen: QwenSetup };

export type ConnectorSetup = { [K in ConnectorKind]: { kind: K; setup: SetupByKind[K] } }[ConnectorKind];

const SETUP_COMMANDS: Record<ConnectorKind, string> = {
  claude: "claude_setup",
  codex: "codex_setup",
  gemini: "gemini_setup",
  opencode: "opencode_setup",
  qwen: "qwen_setup"
};

export async function loadConnectorSetup(kind: ConnectorKind): Promise<ConnectorSetup> {
  const setup = await invoke<SetupByKind[typeof kind]>(SETUP_COMMANDS[kind]);
  return { kind, setup } as ConnectorSetup;
}

/** Where a log-based connector reads from, and whether that place exists on this computer. */
export function connectorSource(connector: ConnectorSetup): { path: string; found: boolean } | null {
  switch (connector.kind) {
    case "claude": return null;
    case "codex": return { path: connector.setup.sessions_dir, found: connector.setup.available };
    case "gemini": return { path: connector.setup.sessions_dir, found: connector.setup.available };
    case "qwen": return { path: connector.setup.projects_dir, found: connector.setup.available };
    case "opencode": return { path: connector.setup.database_paths.join(" · ") || connector.setup.data_dir, found: connector.setup.available };
  }
}

function readOnlyCopy(kind: Exclude<ConnectorKind, "claude">): { name: string; how: string; tokens: string } {
  switch (kind) {
    case "codex": return { name: "Codex", how: t("L’app lit les journaux de session que Codex écrit sur ton disque, au fur et à mesure.", "The app reads the session logs Codex writes to your disk, as they are written."), tokens: t("Codex fournit les tokens de chaque requête au modèle.", "Codex reports the tokens of each model request.") };
    case "gemini": return { name: "Gemini CLI", how: t("L’app lit les enregistrements de conversation que Gemini CLI écrit pour chaque projet.", "The app reads the conversation records Gemini CLI writes for each project."), tokens: t("Gemini CLI fournit les tokens et la durée de chaque réponse.", "Gemini CLI reports the tokens and duration of each answer.") };
    case "qwen": return { name: "Qwen Code", how: t("L’app lit les journaux de conversation que Qwen Code écrit pour chaque projet.", "The app reads the conversation logs Qwen Code writes for each project."), tokens: t("Qwen Code fournit les tokens, le modèle et la durée de chaque requête.", "Qwen Code reports the tokens, model and duration of each request.") };
    case "opencode": return { name: "OpenCode", how: t("L’app lit la base de données d’OpenCode en lecture seule.", "The app reads OpenCode’s database, read-only."), tokens: t("OpenCode fournit les tokens de chaque réponse.", "OpenCode reports the tokens of each answer.") };
  }
}

/** How a connector works and, for Claude Code, the hooks to add. Capture options live in Réglages. */
export function ConnectorSetupDialog({ connector, onClose }: { connector: ConnectorSetup; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (connector.kind === "claude") {
    const { setup } = connector;
    const copy = async () => {
      await navigator.clipboard.writeText(setup.settings_fragment);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };
    return <Dialog id="claude" title={t("Brancher Claude Code", "Set up Claude Code")} onClose={onClose}>
      <p>{t("Claude Code prévient l’app de chacune de ses actions grâce à des hooks : de petites notifications envoyées à l’app pendant qu’il travaille. Les tokens viennent en plus de son journal de session, lu automatiquement.", "Claude Code tells the app about each of its actions through hooks: small notifications sent to the app while it works. Tokens also come from its session log, read automatically.")}</p>
      <ol className="steps">
        <li>{t("Ouvre ton fichier de réglages Claude Code :", "Open your Claude Code settings file:")} <code>~/.claude/settings.json</code> (Windows : <code>%USERPROFILE%\.claude\settings.json</code>).</li>
        <li>{t("Ajoute le bloc hooks ci-dessous à l’objet existant, sans effacer le reste du fichier.", "Add the hooks block below to the existing object, without erasing the rest of the file.")}</li>
        <li>{t("Les sessions Claude Code apparaissent ensuite dans l’app. L’app ne modifie jamais ce fichier elle-même.", "Claude Code sessions then show up in the app. The app never edits this file itself.")}</li>
      </ol>
      <textarea readOnly value={setup.settings_fragment} aria-label={t("Bloc hooks à ajouter aux réglages Claude Code", "Hooks block to add to the Claude Code settings")} />
      <p className="dialog-note">{t("Ce bloc contient un jeton propre à cette installation : si tu réinstalles l’app, recopie-le. Si l’app est fermée, les hooks abandonnent après 2 secondes sans gêner Claude Code.", "This block holds a token specific to this installation: copy it again if you reinstall the app. If the app is closed, hooks give up after 2 seconds without disturbing Claude Code.")}</p>
      <div className="dialog-actions"><button className="button" onClick={onClose}>{t("Fermer", "Close")}</button><button className="button primary" onClick={copy}>{copied ? t("Copié ✓", "Copied ✓") : t("Copier le bloc", "Copy the block")}</button></div>
    </Dialog>;
  }
  const copy = readOnlyCopy(connector.kind);
  const source = connectorSource(connector)!;
  return <Dialog id={connector.kind} title={t(`${copy.name} : observé automatiquement`, `${copy.name}: observed automatically`)} onClose={onClose}>
    <p>{copy.how} {t(`Il n’y a rien à configurer et aucun réglage de ${copy.name} n’est modifié.`, `Nothing to set up, and no ${copy.name} setting is changed.`)}</p>
    <dl className="facts">
      <div><dt>Source</dt><dd><code>{source.path}</code></dd></div>
      <div><dt>{t("État", "State")}</dt><dd>{source.found ? t("Trouvée sur cet ordinateur.", "Found on this computer.") : t(`Introuvable pour l’instant : lance ${copy.name} une première fois.`, `Not found yet: run ${copy.name} once.`)}</dd></div>
      <div><dt>Tokens</dt><dd>{copy.tokens}</dd></div>
      <div><dt>{t("Historique", "History")}</dt><dd>{t("Seules les sessions qui ont lieu pendant que l’app est ouverte sont observées.", "Only sessions that happen while the app is open are observed.")}</dd></div>
    </dl>
    <div className="dialog-actions"><button className="button primary" onClick={onClose}>{t("Compris", "Got it")}</button></div>
  </Dialog>;
}

function Dialog({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: ReactNode }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={`${id}-dialog-title`}>
      <header className="dialog-header"><h2 id={`${id}-dialog-title`}>{title}</h2><button className="icon-button" onClick={onClose} aria-label={t("Fermer", "Close")}><X size={16} /></button></header>
      <div className="dialog-body">
        {children}
        <p className="dialog-note">{t("Ce qui est enregistré (texte des prompts, commandes) se règle dans l’onglet Réglages.", "What is recorded (prompt text, commands) is set in the Settings tab.")}</p>
      </div>
    </section>
  </div>;
}
