import { memo, useEffect, useRef, useState } from "react";
import { locale, t } from "./i18n";
import { narrateEvent } from "./activity-copy";
import { providerFor } from "./providers";
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

/** One event in plain language: when, which agent, what it did, with the raw record on demand. */
export const EventRow = memo(function EventRow({ event, showDate = false }: { event: SessionEvent; showDate?: boolean }) {
  const provider = providerFor(event.provider);
  const narration = narrateEvent(event);
  const at = new Date(event.occurred_at);
  return <div className={`event-row tone-${narration?.tone ?? "info"}`}>
    <time dateTime={event.occurred_at} title={at.toLocaleString(locale())}>{showDate ? at.toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : at.toLocaleTimeString(locale())}</time>
    <span className="event-agent"><i style={{ background: provider?.color }} />{provider?.name ?? event.provider}</span>
    <span className="event-text">{narration ? <>{narration.text}{narration.detail && <small>{narration.detail}</small>}</> : event.kind.replaceAll("_", " ")}</span>
    <details className="event-raw"><summary>{t("données brutes", "raw data")}</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
  </div>;
});
