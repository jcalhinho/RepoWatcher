import { useMemo, useState, type CSSProperties } from "react";
import { t } from "./i18n";
import { since } from "./AgentCard";
import { EventRow } from "./EventFeed";
import { EmptyState, SectionHeader } from "./Explain";
import { ProviderMark } from "./ProviderBadges";
import { providerFor } from "./providers";
import { SessionSummaryPanel } from "./SessionSummaryPanel";
import { sessionKey, type SessionEvent } from "./types";
import type { WorkspaceRepository } from "./workspace";


/** Every observed session, newest first, with its summary and full timeline. */
export function SessionsPage({ events, hasMore, loadingOlder, onLoadOlder, repositoryOf, now }: {
  events: SessionEvent[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  repositoryOf: (event: SessionEvent) => WorkspaceRepository | null;
  now: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const sessions = useMemo(() => {
    const grouped = new Map<string, SessionEvent[]>();
    for (const event of events) grouped.set(sessionKey(event), [...(grouped.get(sessionKey(event)) ?? []), event]);
    return [...grouped.entries()].sort((a, b) => b[1][0].occurred_at.localeCompare(a[1][0].occurred_at));
  }, [events]);
  const current = sessions.find(([key]) => key === selected) ?? sessions[0];
  const timeline = current?.[1] ?? [];
  const repository = timeline.map(repositoryOf).find(Boolean) ?? null;

  return <section className="page">
    <SectionHeader
      title="Sessions"
      description={t("Une session, c’est une conversation avec un agent, du début à la fin. Choisis-en une pour voir son résumé et tout ce qu’il a fait.", "A session is one conversation with an agent, start to finish. Pick one to see its summary and everything it did.")}
      details={t("La liste contient les sessions des événements chargés (les plus récents). « Charger plus ancien » remonte dans l’historique enregistré sur cet ordinateur.", "The list holds the sessions of the loaded events (the most recent). “Load older” goes back through the history recorded on this computer.")}
      actions={hasMore && <button className="button" onClick={onLoadOlder} disabled={loadingOlder}>{loadingOlder ? t("Chargement…", "Loading…") : t("Charger plus ancien", "Load older")}</button>}
    />
    {sessions.length ? <div className="sessions-layout">
      <nav className="session-list" aria-label={t("Sessions observées", "Observed sessions")}>
        {sessions.map(([key, items]) => {
          const provider = providerFor(items[0].provider);
          const place = repositoryOf(items[0])?.name ?? items[0].project_path?.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? t("dossier inconnu", "unknown folder");
          return <button key={key} className="session-item" aria-current={key === current?.[0]} onClick={() => setSelected(key)} style={{ "--agent-color": provider?.color } as CSSProperties}>
            {provider && <ProviderMark provider={provider} small />}
            <span><b>{provider?.name ?? items[0].provider} · {place}</b><small>{since(Date.parse(items[0].occurred_at), now)} · {t(`${items.length} événements`, `${items.length} events`)}</small></span>
          </button>;
        })}
      </nav>
      <div className="session-detail">
        <SessionSummaryPanel key={current?.[0]} events={timeline} loadedEvents={events} hasMore={hasMore} repository={repository ? { root: repository.path, project_hash: repository.project_hash } : null} />
        <SectionHeader level={3} title={t("Chronologie", "Timeline")} description={t(`${timeline.length} événements, du plus récent au plus ancien. « données brutes » montre l’enregistrement exact reçu.`, `${timeline.length} events, newest first. “raw data” shows the exact record received.`)} />
        <div className="event-list">{timeline.map((event) => <EventRow key={event.event_id} event={event} showDate />)}</div>
      </div>
    </div> : <EmptyState title={t("Aucune session pour l’instant", "No session yet")}>{t("Lance une session avec l’un de tes agents : elle apparaîtra ici en direct. Si rien n’arrive, vérifie l’onglet Connecteurs.", "Start a session with one of your agents: it will show up here live. If nothing comes, check the Connectors tab.")}</EmptyState>}
  </section>;
}
