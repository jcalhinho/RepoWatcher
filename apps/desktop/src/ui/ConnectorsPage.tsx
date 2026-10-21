import { useEffect, useState, type CSSProperties } from "react";
import { since } from "./AgentCard";
import { connectorSource, loadConnectorSetup, type ConnectorSetup } from "./ConnectorDialog";
import { CustomConnectors } from "./CustomConnectors";
import { SectionHeader } from "./Explain";
import { ProviderMark } from "./ProviderBadges";
import { t } from "./i18n";
import { activeProviders, type Provider } from "./providers";
import type { SessionEvent } from "./types";

function how(key: string) {
  switch (key) {
    case "claude_code": return t("Hooks Claude Code (actions en direct) + journal de session (tokens).", "Claude Code hooks (live actions) + session log (tokens).");
    case "codex": return t("Journaux de session Codex, lus au fil de l’eau.", "Codex session logs, read as they are written.");
    case "gemini_cli": return t("Enregistrements de conversation Gemini CLI.", "Gemini CLI conversation records.");
    case "qwen_code": return t("Journaux de conversation Qwen Code.", "Qwen Code conversation logs.");
    case "opencode": return t("Base de données OpenCode, en lecture seule.", "OpenCode database, read-only.");
    default: return "";
  }
}

type Health = { tone: "ok" | "warn" | "off"; label: string; advice: string };

function health(provider: Provider, setup: ConnectorSetup | undefined, lastAt: number | null, hookEvents: boolean, now: number): Health {
  if (provider.eventKey === "claude_code") {
    if (hookEvents) return { tone: "ok", label: t(`Branché · dernier événement ${since(lastAt, now)}`, `Connected · last event ${since(lastAt, now)}`), advice: t("Les hooks fonctionnent.", "Hooks are working.") };
    if (lastAt !== null) return { tone: "warn", label: t("Tokens reçus, actions absentes", "Tokens received, no actions"), advice: t("Le journal est lu mais les hooks ne sont pas installés : clique sur « Configurer ».", "The log is read but hooks are not installed: click “Set up”.") };
    return { tone: "warn", label: t("Hooks à installer", "Hooks to install"), advice: t("Ajoute le bloc de hooks à tes réglages Claude Code (bouton « Configurer »).", "Add the hooks block to your Claude Code settings (“Set up” button).") };
  }
  if (lastAt !== null) return { tone: "ok", label: t(`Actif · dernier événement ${since(lastAt, now)}`, `Active · last event ${since(lastAt, now)}`), advice: t("Tout fonctionne.", "Everything works.") };
  const source = setup ? connectorSource(setup) : null;
  if (!source) return { tone: "off", label: t("Vérification…", "Checking…"), advice: "" };
  return source.found
    ? { tone: "ok", label: t("Prêt · en attente d’une session", "Ready · waiting for a session"), advice: t("Lance une session : elle apparaîtra en direct.", "Start a session: it will show up live.") }
    : { tone: "off", label: t("Non détecté sur cet ordinateur", "Not found on this computer"), advice: t("L’agent n’est pas installé ou n’a jamais été lancé.", "The agent is not installed or was never run.") };
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
      title={t("Connecteurs", "Connectors")}
      description={t("Un connecteur, c’est la façon dont l’app observe un agent. Quatre agents sont lus automatiquement, Claude Code demande une petite configuration, et tu peux brancher n’importe quel autre agent via l’API locale.", "A connector is how the app observes an agent. Four agents are read automatically, Claude Code needs a small setup, and you can plug in any other agent through the local API.")}
      details={t("Les connecteurs lisent ce que les agents écrivent déjà sur ton ordinateur (journaux, base locale) ou ce qu’ils envoient eux-mêmes (hooks Claude Code). Ils ne pilotent jamais les agents et ne modifient aucun de leurs réglages.", "Connectors read what agents already write on your computer (logs, local database) or what they send themselves (Claude Code hooks). They never drive agents and never change their settings.")}
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
            <span>{how(provider.eventKey)}</span>
          </div>
          <div className="connector-row-state"><span className="state-dot" aria-hidden="true" /><span><b>{state.label}</b>{state.advice && <small>{state.advice}</small>}</span></div>
          <button className={`button ${provider.eventKey === "claude_code" && state.tone !== "ok" ? "primary" : ""}`} disabled={!setup} onClick={() => setup && onConfigure(setup)}>{provider.eventKey === "claude_code" ? t("Configurer", "Set up") : t("Détails", "Details")}</button>
        </article>;
      })}
    </div>
    <CustomConnectors events={events} now={now} />
  </section>;
}
