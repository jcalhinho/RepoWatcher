import { useCallback, useEffect, useState } from "react";
import { locale, t } from "./i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { isActiveProvider, normalizeEvent } from "./providers";
import { compareEventsNewestFirst, type SessionEvent } from "./types";

const PAGE = 500;

function merge(current: SessionEvent[], incoming: SessionEvent[]) {
  const byId = new Map([...current, ...incoming.map(normalizeEvent).filter((event) => isActiveProvider(event.provider))].map((event) => [event.event_id, event]));
  return [...byId.values()].sort(compareEventsNewestFirst);
}

/**
 * The live event stream: the latest stored events, events pushed by the collector as they happen,
 * older pages on demand, the collector state, and the history export / erase actions.
 */
export function useObserver() {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [liveEventIds, setLiveEventIds] = useState<Record<string, string>>({});
  const [collectorState, setCollectorState] = useState("starting");
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    let stopEvents: (() => void) | undefined;
    let stopErrors: (() => void) | undefined;
    const refreshStatus = () => invoke<string>("collector_status").then(setCollectorState).catch(() => setCollectorState("preview"));
    void refreshStatus();
    const timer = window.setInterval(refreshStatus, 1500);
    listen<string>("collector-error", (event) => setCollectorState(`error: ${event.payload}`)).then((stop) => { stopErrors = stop; });
    invoke<SessionEvent[]>("load_session_events", { limit: PAGE, beforeOccurredAt: null, beforeEventId: null })
      .then((stored) => {
        setHasMore(stored.length === PAGE);
        setEvents((current) => merge(current, stored).slice(0, PAGE));
      })
      .catch(() => undefined);
    listen<SessionEvent>("session-event", (event) => {
      const payload = normalizeEvent(event.payload);
      if (!isActiveProvider(payload.provider)) return;
      setLiveEventIds((current) => ({ ...current, [payload.provider]: payload.event_id }));
      setEvents((current) => merge(current, [payload]));
    }).then((stop) => { stopEvents = stop; });
    return () => { window.clearInterval(timer); stopEvents?.(); stopErrors?.(); };
  }, []);

  const loadOlder = useCallback(async () => {
    const oldest = events.at(-1);
    if (!oldest || loadingOlder || !hasMore) return;
    setLoadingOlder(true);
    try {
      const older = await invoke<SessionEvent[]>("load_session_events", { limit: PAGE, beforeOccurredAt: oldest.occurred_at, beforeEventId: oldest.event_id });
      setEvents((current) => merge(current, older));
      setHasMore(older.length === PAGE);
    } finally {
      setLoadingOlder(false);
    }
  }, [events, loadingOlder, hasMore]);

  const clearHistory = useCallback(async () => {
    if (!window.confirm(t("Effacer tout l’historique local (événements, prompts et commandes capturés) ? Cette action ne peut pas être annulée.", "Erase all local history (events, captured prompts and commands)? This cannot be undone."))) return false;
    await invoke("clear_session_history");
    setEvents([]);
    setHasMore(false);
    return true;
  }, []);

  /** Returns a message for the user. */
  const exportHistory = useCallback(async () => {
    try {
      const path = await save({ title: t("Exporter l’historique", "Export history"), defaultPath: t("agent-observer-historique.json", "agent-observer-history.json"), filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return null;
      const count = await invoke<number>("export_session_history", { path });
      return t(`${count.toLocaleString(locale())} événements exportés dans ${path}.`, `${count.toLocaleString(locale())} events exported to ${path}.`);
    } catch {
      return t("Export impossible ici : ouvre l’application de bureau.", "Export unavailable here: open the desktop app.");
    }
  }, []);

  return { events, liveEventIds, collectorState, hasMore, loadingOlder, loadOlder, clearHistory, exportHistory };
}
