import type { ReactNode } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { ProviderCard } from "./ProviderBadges";
import { activeProviders } from "./providers";

export type WorkspaceDialogKind = "connectors" | "preferences" | "help";

/** Centered workspace modal (connectors, preferences, help, history, repository map). */
export function WorkspaceModal({ titleId, title, className, onClose, children }: { titleId: string; title: string; className?: string; onClose: () => void; children: ReactNode }) {
  return <div className="workspace-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={className ? `workspace-dialog ${className}` : "workspace-dialog"} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={titleId}><button className="setup-close" onClick={onClose} aria-label="Fermer">×</button><h2 id={titleId}>{title}</h2>{children}</section></div>;
}

export function WorkspaceDialog({ kind, search, onSearch, onConfigure, onShow, onOpenHistory, onClose }: { kind: WorkspaceDialogKind; search: string; onSearch: (value: string) => void; onConfigure: (providerId: string) => void; onShow: (kind: WorkspaceDialogKind) => void; onOpenHistory: () => void; onClose: () => void }) {
  if (kind === "connectors") {
    const filteredProviders = activeProviders.filter((provider) => provider.name.toLowerCase().includes(search.toLowerCase()));
    return <WorkspaceModal titleId="workspace-dialog-title" title="Connecteurs" onClose={onClose}><p className="dialog-subtitle">Configure les sources locales et leurs préférences de confidentialité.</p><div className="connector-search"><Search size={14} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Filtrer les connecteurs" aria-label="Filtrer les connecteurs" /></div><div className="connector-list dialog-connectors">{filteredProviders.map((provider) => <ProviderCard key={provider.id} provider={provider} active={Boolean(provider.connector)} onClick={() => onConfigure(provider.id)} label={provider.connector?.scope} />)}</div><div className="connectors-footer">Claude Code, Codex, Gemini CLI, OpenCode et Qwen Code sont pris en charge localement. Les réglages de confidentialité se règlent dans chaque configuration.</div></WorkspaceModal>;
  }
  if (kind === "preferences") {
    return <WorkspaceModal titleId="workspace-dialog-title" title="Préférences et confidentialité" onClose={onClose}><p>Les événements sont conservés localement. Les prompts et commandes restent désactivés par défaut. Choisis un connecteur pour consulter ou modifier ses options de capture.</p><div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={15} /></div><div><b>Données locales</b><span>Rien n’est envoyé au cloud</span></div><span className="privacy-dot" /></div><button className="primary-button" onClick={() => onShow("connectors")}>Ouvrir les connecteurs</button></WorkspaceModal>;
  }
  return <WorkspaceModal titleId="workspace-dialog-title" title="Aide" onClose={onClose}><p>Agent Observer affiche l’activité exposée localement, l’état Git du dépôt choisi et les métriques observées. Les changements Git ne sont pas attribués à un agent sans preuve.</p><p>Les bulles résument les événements connus et ne montrent jamais les journaux bruts. Ouvre l’historique pour parcourir les détails d’une session.</p><button className="primary-button" onClick={onOpenHistory}>Ouvrir l’historique</button></WorkspaceModal>;
}
