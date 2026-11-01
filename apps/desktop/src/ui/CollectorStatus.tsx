import { InfoTip } from "./Explain";
import { t } from "./i18n";

type CollectorView = { tone: "ok" | "warn" | "bad"; label: string; explanation: string };

function describeCollector(state: string): CollectorView {
  if (state === "listening") return { tone: "ok", label: t("Collecte active", "Collecting"), explanation: t("L’app reçoit les événements de tes agents sur cet ordinateur (adresse locale 127.0.0.1:43821) et lit leurs journaux. Rien n’est envoyé sur Internet.", "The app receives your agents’ events on this computer (local address 127.0.0.1:43821) and reads their logs. Nothing is sent over the Internet.") };
  if (state.startsWith("error")) return { tone: "bad", label: t("Collecte impossible", "Collection failed"), explanation: t(`Le port local 43821 est déjà utilisé, probablement par une autre copie de l’app : les hooks Claude Code n’arrivent pas ici. Ferme l’autre copie puis relance. (${state.replace(/^error:\s*/, "")})`, `Local port 43821 is already in use, probably by another copy of the app: Claude Code hooks don’t reach this one. Close the other copy and restart. (${state.replace(/^error:\s*/, "")})`) };
  if (state === "preview") return { tone: "warn", label: t("Aperçu sans collecte", "Preview, no collection"), explanation: t("Cette page tourne hors de l’application de bureau : aucun événement réel ne peut être reçu.", "This page runs outside the desktop app: no real event can be received.") };
  return { tone: "warn", label: t("Démarrage…", "Starting…"), explanation: t("Le collecteur local démarre.", "The local collector is starting.") };
}

/** Collector state as a coloured dot, a plain-language label and its explanation. */
export function CollectorStatus({ state, compact = false }: { state: string; compact?: boolean }) {
  const view = describeCollector(state);
  return <span className={`collector-status tone-${view.tone}`} title={compact ? view.explanation : undefined}>
    <i aria-hidden="true" />
    {compact ? <span className="sr-only">{view.label}</span> : <>{view.label}<InfoTip label={t("Qu’est-ce que la collecte ?", "What is collection?")} align="end">{view.explanation}</InfoTip></>}
  </span>;
}
