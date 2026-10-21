import { useState, type ReactNode } from "react";
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

const READ_ONLY_COPY: Record<Exclude<ConnectorKind, "claude">, { name: string; how: string; tokens: string }> = {
  codex: { name: "Codex", how: "L’app lit les journaux de session que Codex écrit sur ton disque, au fur et à mesure.", tokens: "Codex fournit les tokens de chaque requête au modèle." },
  gemini: { name: "Gemini CLI", how: "L’app lit les enregistrements de conversation que Gemini CLI écrit pour chaque projet.", tokens: "Gemini CLI fournit les tokens et la durée de chaque réponse." },
  qwen: { name: "Qwen Code", how: "L’app lit les journaux de conversation que Qwen Code écrit pour chaque projet.", tokens: "Qwen Code fournit les tokens, le modèle et la durée de chaque requête." },
  opencode: { name: "OpenCode", how: "L’app lit la base de données d’OpenCode en lecture seule.", tokens: "OpenCode fournit les tokens de chaque réponse." }
};

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
    return <Dialog id="claude" title="Brancher Claude Code" onClose={onClose}>
      <p>Claude Code prévient l’app de chacune de ses actions grâce à des <b>hooks</b> : de petites notifications envoyées à l’app pendant qu’il travaille. Les tokens viennent en plus de son journal de session, lu automatiquement.</p>
      <ol className="steps">
        <li>Ouvre ton fichier de réglages Claude Code : <code>~/.claude/settings.json</code> (Windows : <code>%USERPROFILE%\.claude\settings.json</code>).</li>
        <li>Ajoute le bloc <code>hooks</code> ci-dessous à l’objet existant, sans effacer le reste du fichier.</li>
        <li>Les sessions Claude Code apparaissent ensuite dans l’app. L’app ne modifie jamais ce fichier elle-même.</li>
      </ol>
      <textarea readOnly value={setup.settings_fragment} aria-label="Bloc hooks à ajouter aux réglages Claude Code" />
      <p className="dialog-note">Ce bloc contient un jeton propre à cette installation : si tu réinstalles l’app, recopie-le. Si l’app est fermée, les hooks abandonnent après 2 secondes sans gêner Claude Code.</p>
      <div className="dialog-actions"><button className="button" onClick={onClose}>Fermer</button><button className="button primary" onClick={copy}>{copied ? "Copié ✓" : "Copier le bloc"}</button></div>
    </Dialog>;
  }
  const copy = READ_ONLY_COPY[connector.kind];
  const source = connectorSource(connector)!;
  return <Dialog id={connector.kind} title={`${copy.name} : observé automatiquement`} onClose={onClose}>
    <p>{copy.how} Il n’y a rien à configurer et aucun réglage de {copy.name} n’est modifié.</p>
    <dl className="facts">
      <div><dt>Source</dt><dd><code>{source.path}</code></dd></div>
      <div><dt>État</dt><dd>{source.found ? "Trouvée sur cet ordinateur." : `Introuvable pour l’instant : lance ${copy.name} une première fois.`}</dd></div>
      <div><dt>Tokens</dt><dd>{copy.tokens}</dd></div>
      <div><dt>Historique</dt><dd>Seules les sessions qui ont lieu pendant que l’app est ouverte sont observées.</dd></div>
    </dl>
    <div className="dialog-actions"><button className="button primary" onClick={onClose}>Compris</button></div>
  </Dialog>;
}

function Dialog({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: ReactNode }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={`${id}-dialog-title`}>
      <header className="dialog-header"><h2 id={`${id}-dialog-title`}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fermer"><X size={16} /></button></header>
      <div className="dialog-body">
        {children}
        <p className="dialog-note">Ce qui est enregistré (texte des prompts, commandes) se règle dans l’onglet Réglages.</p>
      </div>
    </section>
  </div>;
}
