import { useEffect, useState, type CSSProperties } from "react";
import { since } from "./AgentCard";
import { connectorSource, loadConnectorSetup, type ConnectorSetup } from "./ConnectorDialog";
import { CustomConnectors } from "./CustomConnectors";
import { SectionHeader } from "./Explain";
import { ProviderMark } from "./ProviderBadges";
import { activeProviders, type Provider } from "./providers";
import type { SessionEvent } from "./types";

const HOW: Record<string, string> = {
  claude_code: "Hooks Claude Code (actions en direct) + journal de session (tokens).",
  codex: "Journaux de session Codex, lus au fil de l’eau.",
  gemini_cli: "Enregistrements de conversation Gemini CLI.",
  qwen_code: "Journaux de conversation Qwen Code.",
  opencode: "Base de données OpenCode, en lecture seule."
};

type Health = { tone: "ok" | "warn" | "off"; label: string; advice: string };

function health(provider: Provider, setup: ConnectorSetup | undefined, lastAt: number | null, hookEvents: boolean, now: number): Health {
  if (provider.eventKey === "claude_code") {
    if (hookEvents) return { tone: "ok", label: `Branché · dernier événement ${since(lastAt, now)}`, advice: "Les hooks fonctionnent." };
    if (lastAt !== null) return { tone: "warn", label: "Tokens reçus, actions absentes", advice: "Le journal est lu mais les hooks ne sont pas installés : clique sur « Configurer »." };
    return { tone: "warn", label: "Hooks à installer", advice: "Ajoute le bloc de hooks à tes réglages Claude Code (bouton « Configurer »)." };
  }
  if (lastAt !== null) return { tone: "ok", label: `Actif · dernier événement ${since(lastAt, now)}`, advice: "Tout fonctionne." };
  const source = setup ? connectorSource(setup) : null;
  if (!source) return { tone: "off", label: "Vérification…", advice: "" };
  return source.found
    ? { tone: "ok", label: "Prêt · en attente d’une session", advice: "Lance une session : elle apparaîtra en direct." }
    : { tone: "off", label: "Non détecté sur cet ordinateur", advice: "L’agent n’est pas installé ou n’a jamais été lancé." };
}

/** Each agent: how it is observed, whether it works, and what to do when it does not. */
export function ConnectorsPage({ events, now, onConfigure }: { events: SessionEvent[]; now: number; onConfigure: (setup: ConnectorSetup) => void }) {
  const [setups, setSetups] = useState<Record<string, ConnectorSetup>>({});
  useEffect(() => {
    for (const provider of activeProviders) {
      const kind = provider.connector?.kind;
      if (!kind) continue;
      loadConnectorSetup(kind).then((setup) => setSetups((current) => ({ ...current, [provider.eventKey]: setup }))).catch(() => undefined);
    }
  }, []);

  return <section className="page">
    <SectionHeader
      title="Connecteurs"
      description="Un connecteur, c’est la façon dont l’app observe un agent. Quatre agents sont lus automatiquement, Claude Code demande une petite configuration, et tu peux brancher n’importe quel autre agent via l’API locale."
      details="Les connecteurs lisent ce que les agents écrivent déjà sur ton ordinateur (journaux, base locale) ou ce qu’ils envoient eux-mêmes (hooks Claude Code). Ils ne pilotent jamais les agents et ne modifient aucun de leurs réglages."
    />
    <div className="connector-list">
      {activeProviders.map((provider) => {
        const own = events.filter((event) => event.provider === provider.eventKey);
        const lastAt = own.length ? Math.max(...own.map((event) => Date.parse(event.occurred_at))) : null;
        const hookEvents = own.some((event) => event.kind !== "model_usage" && event.kind !== "session_started");
        const setup = setups[provider.eventKey];
        const state = health(provider, setup, lastAt, hookEvents, now);
        return <article className={`connector-row tone-${state.tone}`} key={provider.id} style={{ "--agent-color": provider.color } as CSSProperties}>
          <ProviderMark provider={provider} />
          <div className="connector-row-main">
            <b>{provider.name}</b>
            <span>{HOW[provider.eventKey]}</span>
          </div>
          <div className="connector-row-state"><span className="state-dot" aria-hidden="true" /><span><b>{state.label}</b>{state.advice && <small>{state.advice}</small>}</span></div>
          <button className={`button ${provider.eventKey === "claude_code" && state.tone !== "ok" ? "primary" : ""}`} disabled={!setup} onClick={() => setup && onConfigure(setup)}>{provider.eventKey === "claude_code" ? "Configurer" : "Détails"}</button>
        </article>;
      })}
    </div>
    <CustomConnectors events={events} now={now} />
  </section>;
}
