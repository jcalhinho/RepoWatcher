import { Maximize2, Pin, PinOff } from "lucide-react";
import { t } from "./i18n";
import { AgentCard } from "./AgentCard";
import { useMemo } from "react";
import { agentPulse, sortPulses, type AgentPulse } from "./agentPulse";
import { CollectorStatus } from "./CollectorStatus";
import { agentName, useAgents } from "./providers";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

/** Compact always-visible column: one card per agent, the ones that need you first. */
export function MiniView({ agentEvents, collectorState, pinned, onTogglePin, onExpand, repositoryName, onGoTo }: { agentEvents: SessionEvent[]; collectorState: string; pinned: boolean; onTogglePin: () => void; onExpand: () => void; repositoryName: (pulse: AgentPulse) => string | null; onGoTo: (pulse: AgentPulse) => void }) {
  const now = useNow(1000);
  const agents = useAgents();
  const pulses = useMemo(() => sortPulses(agents.map((provider) => agentPulse(provider.eventKey, agentEvents, now))), [agents, agentEvents, now]);
  const seen = pulses.filter((pulse) => pulse.status !== "never");
  const unseen = pulses.filter((pulse) => pulse.status === "never");
  const attention = pulses.filter((pulse) => pulse.status === "looping" || pulse.status === "blocked" || pulse.status === "stalled" || pulse.status === "waiting").length;
  const working = pulses.filter((pulse) => pulse.status === "working").length;

  return <div className="mini-view">
    <header className="mini-header">
      <div className="mini-title">
        <CollectorStatus state={collectorState} compact />
        <span><b>{working}</b> {t("au travail", "working")}{attention ? <> · <em>{t(`${attention} à voir`, `${attention} to check`)}</em></> : null}</span>
      </div>
      <div className="mini-actions">
        <button className="icon-button" onClick={onTogglePin} aria-pressed={pinned} title={pinned ? t("La fenêtre reste au premier plan — cliquer pour l’en retirer", "The window stays on top — click to release it") : t("Garder la fenêtre au premier plan", "Keep the window on top")}>{pinned ? <Pin size={15} /> : <PinOff size={15} />}</button>
        <button className="icon-button" onClick={onExpand} title={t("Revenir au tableau de bord complet", "Back to the full dashboard")}><Maximize2 size={15} /></button>
      </div>
    </header>
    <div className="mini-cards">
      {seen.length
        ? seen.map((pulse) => <AgentCard key={pulse.key} pulse={pulse} now={now} repository={repositoryName(pulse)} compact onGoTo={onGoTo} />)
        : <p className="mini-empty">{t("Aucun agent observé pour l’instant. Lance une session avec Claude Code, Codex, Gemini CLI, OpenCode ou Qwen Code : elle apparaîtra ici.", "No agent observed yet. Start a session with Claude Code, Codex, Gemini CLI, OpenCode or Qwen Code: it will show up here.")}</p>}
    </div>
    {unseen.length > 0 && <footer className="mini-footer">{t("Pas encore vus", "Not seen yet")} : {unseen.map((pulse) => agentName(pulse.key)).join(", ")}</footer>}
  </div>;
}
