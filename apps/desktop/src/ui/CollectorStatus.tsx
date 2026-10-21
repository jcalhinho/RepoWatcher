import { InfoTip } from "./Explain";

type CollectorView = { tone: "ok" | "warn" | "bad"; label: string; explanation: string };

function describeCollector(state: string): CollectorView {
  if (state === "listening") return { tone: "ok", label: "Collecte active", explanation: "L’app reçoit les événements de tes agents sur cet ordinateur (adresse locale 127.0.0.1:43821) et lit leurs journaux. Rien n’est envoyé sur Internet." };
  if (state.startsWith("error")) return { tone: "bad", label: "Collecte impossible", explanation: `Le port local 43821 est déjà utilisé, probablement par une autre copie de l’app : les hooks Claude Code n’arrivent pas ici. Ferme l’autre copie puis relance. (${state.replace(/^error:\s*/, "")})` };
  if (state === "preview") return { tone: "warn", label: "Aperçu sans collecte", explanation: "Cette page tourne hors de l’application de bureau : aucun événement réel ne peut être reçu." };
  return { tone: "warn", label: "Démarrage…", explanation: "Le collecteur local démarre." };
}

/** Collector state as a coloured dot, a plain-language label and its explanation. */
export function CollectorStatus({ state, compact = false }: { state: string; compact?: boolean }) {
  const view = describeCollector(state);
  return <span className={`collector-status tone-${view.tone}`} title={compact ? view.explanation : undefined}>
    <i aria-hidden="true" />
    {compact ? <span className="sr-only">{view.label}</span> : <>{view.label}<InfoTip label="Qu’est-ce que la collecte ?" align="end">{view.explanation}</InfoTip></>}
  </span>;
}
