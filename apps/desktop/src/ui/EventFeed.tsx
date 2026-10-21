import { memo, useEffect, useRef, useState } from "react";
import type { SessionEvent } from "./types";

const PAGE_SIZE = 50;

/**
 * "Activité récente" feed. Rows are rendered incrementally: the next page mounts when the
 * invisible sentinel nears the viewport, so up to 500 loaded events never render at once.
 */
export const EventFeed = memo(function EventFeed({ events }: { events: SessionEvent[] }) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = events.length > limit;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined") return;
    // Re-created after each page so a sentinel still in view keeps loading.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((current) => current + PAGE_SIZE);
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, limit]);
  return <div className="event-feed">{events.slice(0, limit).map((event) => <EventRow key={event.event_id} event={event} />)}{hasMore && <div ref={sentinel} aria-hidden="true" />}</div>;
});

const EventRow = memo(function EventRow({ event }: { event: SessionEvent }) {
  return <div className="event-row"><time>{new Date(event.occurred_at).toLocaleTimeString()}</time><span className="event-kind">{event.provider} · {event.kind.replaceAll("_", " ")}</span><span className="event-detail">{event.command || event.content || event.tool_name || event.file_path || event.project_path || event.session_id}</span><EventPayload event={event} /></div>;
});

export function EventPayload({ event }: { event: SessionEvent }) {
  return <details className="event-payload"><summary>Journal complet</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>;
}
