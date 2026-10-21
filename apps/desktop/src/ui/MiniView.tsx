import { Maximize2, Pin, PinOff } from "lucide-react";
import { AgentCard } from "./AgentCard";
import { useMemo } from "react";
import { agentPulse, sortPulses, type AgentPulse } from "./agentPulse";
import { CollectorStatus } from "./CollectorStatus";
import { activeProviders, providers } from "./providers";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

const providerNames = new Map(providers.map((provider) => [provider.eventKey, provider.name]));

/** Compact always-visible column: one card per agent, the ones that need you first. */
export function MiniView({ agentEvents, collectorState, pinned, onTogglePin, onExpand, repositoryName, onGoTo }: { agentEvents: SessionEvent[]; collectorState: string; pinned: boolean; onTogglePin: () => void; onExpand: () => void; repositoryName: (pulse: AgentPulse) => string | null; onGoTo: (pulse: AgentPulse) => void }) {
  const now = useNow(1000);
  const pulses = useMemo(() => sortPulses(activeProviders.map((provider) => agentPulse(provider.eventKey, agentEvents, now))), [agentEvents, now]);
  const seen = pulses.filter((pulse) => pulse.status !== "never");
  const unseen = pulses.filter((pulse) => pulse.status === "never");
  const attention = pulses.filter((pulse) => pulse.status === "looping" || pulse.status === "blocked" || pulse.status === "stalled" || pulse.status === "waiting").length;
  const working = pulses.filter((pulse) => pulse.status === "working").length;

  return <div className="mini-view">
    <header className="mini-header">
      <div className="mini-title">
        <CollectorStatus state={collectorState} compact />
        <span><b>{working}</b> au travail{attention ? <> · <em>{attention} à voir</em></> : null}</span>
      </div>
      <div className="mini-actions">
        <button className="icon-button" onClick={onTogglePin} aria-pressed={pinned} title={pinned ? "La fenêtre reste au premier plan — cliquer pour l’en retirer" : "Garder la fenêtre au premier plan"}>{pinned ? <Pin size={15} /> : <PinOff size={15} />}</button>
        <button className="icon-button" onClick={onExpand} title="Revenir au tableau de bord complet"><Maximize2 size={15} /></button>
      </div>
    </header>
    <div className="mini-cards">
      {seen.length
        ? seen.map((pulse) => <AgentCard key={pulse.key} pulse={pulse} now={now} repository={repositoryName(pulse)} compact onGoTo={onGoTo} />)
        : <p className="mini-empty">Aucun agent observé pour l’instant. Lance une session avec Claude Code, Codex, Gemini CLI, OpenCode ou Qwen Code : elle apparaîtra ici.</p>}
    </div>
    {unseen.length > 0 && <footer className="mini-footer">Pas encore vus : {unseen.map((pulse) => providerNames.get(pulse.key) ?? pulse.key).join(", ")}</footer>}
  </div>;
}
