import { useMemo, useState, type CSSProperties } from "react";
import { since } from "./AgentCard";
import { EventRow } from "./EventFeed";
import { EmptyState, SectionHeader } from "./Explain";
import { ProviderMark } from "./ProviderBadges";
import { providers } from "./providers";
import { SessionSummaryPanel } from "./SessionSummaryPanel";
import { sessionKey, type SessionEvent } from "./types";
import type { WorkspaceRepository } from "./workspace";

const providerByKey = new Map(providers.map((provider) => [provider.eventKey, provider]));

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
      description="Une session, c’est une conversation avec un agent, du début à la fin. Choisis-en une pour voir son résumé et tout ce qu’il a fait."
      details="La liste contient les sessions des événements chargés (les plus récents). « Charger plus ancien » remonte dans l’historique enregistré sur cet ordinateur."
      actions={hasMore && <button className="button" onClick={onLoadOlder} disabled={loadingOlder}>{loadingOlder ? "Chargement…" : "Charger plus ancien"}</button>}
    />
    {sessions.length ? <div className="sessions-layout">
      <nav className="session-list" aria-label="Sessions observées">
        {sessions.map(([key, items]) => {
          const provider = providerByKey.get(items[0].provider);
          const place = repositoryOf(items[0])?.name ?? items[0].project_path?.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "dossier inconnu";
          return <button key={key} className="session-item" aria-current={key === current?.[0]} onClick={() => setSelected(key)} style={{ "--agent-color": provider?.color } as CSSProperties}>
            {provider && <ProviderMark provider={provider} small />}
            <span><b>{provider?.name ?? items[0].provider} · {place}</b><small>{since(Date.parse(items[0].occurred_at), now)} · {items.length} événements</small></span>
          </button>;
        })}
      </nav>
      <div className="session-detail">
        <SessionSummaryPanel key={current?.[0]} events={timeline} loadedEvents={events} hasMore={hasMore} repository={repository ? { root: repository.path, project_hash: repository.project_hash } : null} />
        <SectionHeader level={3} title="Chronologie" description={`${timeline.length} événements, du plus récent au plus ancien. « données brutes » montre l’enregistrement exact reçu.`} />
        <div className="event-list">{timeline.map((event) => <EventRow key={event.event_id} event={event} showDate />)}</div>
      </div>
    </div> : <EmptyState title="Aucune session pour l’instant">Lance une session avec l’un de tes agents : elle apparaîtra ici en direct. Si rien n’arrive, vérifie l’onglet Connecteurs.</EmptyState>}
  </section>;
}
