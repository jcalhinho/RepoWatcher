import type { CSSProperties } from "react";
import type { Provider } from "./providers";

export function ProviderMark({ provider, small = false }: { provider: Provider; small?: boolean }) {
  return <span className={`provider-mark ${small ? "small" : ""}`} style={{ "--provider-color": provider.color, "--provider-surface": provider.surface } as CSSProperties}>{provider.initials}</span>;
}

export function ProviderCard({ provider, active = false, onClick, label }: { provider: Provider; active?: boolean; onClick?: () => void; label?: string }) {
  return <div className={`connector-card ${active ? "configured" : ""}`}><ProviderMark provider={provider} /><span className="connector-name">{provider.name}{label && <small className="connector-scope">{label}</small>}</span>{onClick ? <button className="connector-action" onClick={onClick}>Configurer</button> : <span className="connector-state">Prévu</span>}{active && <span className="provider-ready" aria-label="Connecteur disponible" />}</div>;
}
