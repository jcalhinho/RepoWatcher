import { useEffect, useMemo, useState } from "react";
import { MiniView } from "./MiniView";
import { useWorkspace } from "./useWorkspace";
import { useAnalyticsEvents } from "./useAnalyticsEvents";
import type { AnalyticsRange } from "./analytics";
import { filterByRepository, pathKey, type RepositoryFilter, type WorkspaceRepository } from "./workspace";
import { RepositoryFilterBar, WorkspacePanel, WorkspaceSwitcher, useRepositoryActivity } from "./WorkspaceViews";
import { enterMiniWindow, leaveMiniWindow, setMiniPinned } from "./miniWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Activity, Bot, ChevronDown, CircleHelp,
  FolderGit2, GitBranch, Plus,
  Minimize2, Settings2, Sparkles, TerminalSquare
} from "lucide-react";
import { SessionAnalytics } from "./SessionAnalytics";
import { ConnectorSetupDialog, loadConnectorSetup, type ConnectorSetup } from "./ConnectorDialog";
import { EventFeed } from "./EventFeed";
import { ProviderMark } from "./ProviderBadges";
import { providerById, type ConnectorKind } from "./providers";
import { RepositoryMap } from "./RepositoryMap";
import { Resizable } from "./Resizable";
import { SessionExplorer } from "./SessionExplorer";
import { SprintTrack } from "./SprintTrack";
import { compareEventsNewestFirst, formatCount, sessionKey, type RepositorySnapshot, type SessionEvent } from "./types";
import { useDialogFocus } from "./useDialogFocus";
import { WorkspaceDialog, WorkspaceModal, type WorkspaceDialogKind } from "./WorkspaceDialog";

export function App() {
  const [view, setView] = useState<"overview" | "sessions" | "repo-map">("overview");
  const [workspaceDialog, setWorkspaceDialog] = useState<WorkspaceDialogKind | null>(null);
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [liveEventIds, setLiveEventIds] = useState<Record<string, string>>({});
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const [mapRepository, setMapRepository] = useState<WorkspaceRepository | null>(null);
  const [collectorState, setCollectorState] = useState("starting");
  const [connectorSetup, setConnectorSetup] = useState<ConnectorSetup | null>(null);

  // Escape closes the topmost layer: connector setup, then workspace dialog, then history/repository view.
  useDialogFocus(() => {
    if (connectorSetup) setConnectorSetup(null);
    else if (workspaceDialog) setWorkspaceDialog(null);
    else setView("overview");
  }, [view, workspaceDialog, connectorSetup]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const refreshStatus = () => invoke<string>("collector_status").then(setCollectorState).catch(() => setCollectorState("preview"));
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 1500);
    let unlistenError: (() => void) | undefined;
    listen<string>("collector-error", (event) => setCollectorState(`error: ${event.payload}`)).then((stop) => { unlistenError = stop; });
    invoke<SessionEvent[]>("load_session_events", { limit: 500, beforeOccurredAt: null, beforeEventId: null }).then((stored) => {
      setHistoryHasMore(stored.length === 500);
      setEvents((current) => {
      const byId = new Map([...stored, ...current].map((item) => [item.event_id, item]));
      return [...byId.values()].sort(compareEventsNewestFirst).slice(0, 500);
      });
    }).catch(() => undefined);
    listen<SessionEvent>("session-event", (event) => {
      setLiveEventIds((current) => ({ ...current, [event.payload.provider]: event.payload.event_id }));
      setEvents((current) => [event.payload, ...current.filter((item) => item.event_id !== event.payload.event_id)].sort(compareEventsNewestFirst));
    }).then((stop) => { unlisten = stop; });
    return () => { window.clearInterval(timer); unlisten?.(); unlistenError?.(); };
  }, []);
  const [analyticsRange, setAnalyticsRangeState] = useState<AnalyticsRange>(() => {
    try {
      const stored = window.localStorage.getItem("repowatcher.analytics-range");
      return stored === "15m" || stored === "1h" || stored === "24h" || stored === "all" ? stored : "24h";
    } catch {
      return "24h";
    }
  });
  function setAnalyticsRange(range: AnalyticsRange) {
    setAnalyticsRangeState(range);
    try { window.localStorage.setItem("repowatcher.analytics-range", range); } catch { /* optional preference */ }
  }
  const [miniMode, setMiniMode] = useState(() => readFlag("repowatcher.mini-mode", false));
  const [miniPinned, setMiniPinnedState] = useState(() => readFlag("repowatcher.mini-pinned", true));
  const narrowWindow = useNarrowWindow();
  // Charts, repository counts and the mini view read every stored event of the window, not only the 500 kept in memory.
  const analytics = useAnalyticsEvents(miniMode || narrowWindow ? "24h" : analyticsRange, events);
  const workspace = useWorkspace(analytics.events);
  const [repositoryFilter, setRepositoryFilterState] = useState<RepositoryFilter>(() => { try { return window.localStorage.getItem("repowatcher.repository-filter") ?? "all"; } catch { return "all"; } });
  // A filter on a repository that left the workspace falls back to every repository.
  const activeFilter: RepositoryFilter = repositoryFilter === "all" || repositoryFilter === "outside" || workspace.repositories.some((repository) => pathKey(repository.path) === pathKey(repositoryFilter)) ? repositoryFilter : "all";
  const scopedEvents = useMemo(() => filterByRepository(events, activeFilter, workspace.repositoryOf), [events, activeFilter, workspace.repositoryOf]);
  const { activity: repositoryActivity, outside: outsideEvents } = useRepositoryActivity(analytics.events, workspace);
  function setRepositoryFilter(filter: RepositoryFilter) {
    setRepositoryFilterState(filter);
    try { window.localStorage.setItem("repowatcher.repository-filter", filter); } catch { /* optional preference */ }
  }
  const selectedRepository = activeFilter !== "all" && activeFilter !== "outside" ? workspace.repositories.find((repository) => pathKey(repository.path) === pathKey(activeFilter)) ?? null : null;
  function openRepositoryMap(repository: WorkspaceRepository | null) {
    setMapRepository(repository ?? selectedRepository ?? workspace.repositories[0] ?? null);
    showView("repo-map");
  }
  const stats = useMemo(() => {
    const perProvider = new Map<string, number>();
    for (const event of events) perProvider.set(event.provider, (perProvider.get(event.provider) || 0) + 1);
    return {
      sessions: new Set(events.map(sessionKey)).size,
      inputTokens: events.reduce((sum, event) => sum + (event.input_tokens?.value || 0), 0),
      outputTokens: events.reduce((sum, event) => sum + (event.output_tokens?.value || 0), 0),
      hasTokenUsage: events.some((event) => event.input_tokens || event.output_tokens),
      toolEvents: events.filter((event) => event.kind.startsWith("tool_")).length,
      files: new Set(events.map((event) => event.file_path).filter(Boolean)).size,
      perProvider
    };
  }, [events]);

  const scopedAnalytics = useMemo(() => filterByRepository(analytics.events, activeFilter, workspace.repositoryOf), [analytics.events, activeFilter, workspace.repositoryOf]);
  useEffect(() => {
    // Re-apply the corner placement when the app starts in mini mode.
    if (miniMode) void enterMiniWindow(miniPinned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goMini() {
    setMiniMode(true);
    writeFlag("repowatcher.mini-mode", true);
    void enterMiniWindow(miniPinned);
  }

  function leaveMini() {
    setMiniMode(false);
    writeFlag("repowatcher.mini-mode", false);
    void leaveMiniWindow();
  }

  function toggleMiniPin() {
    const next = !miniPinned;
    setMiniPinnedState(next);
    writeFlag("repowatcher.mini-pinned", next);
    void setMiniPinned(next);
  }

  async function connect(kind: ConnectorKind) {
    setConnectorSetup(await loadConnectorSetup(kind));
  }

  function openConnectorSetup(providerId: string) {
    setWorkspaceDialog(null);
    const kind = providerById(providerId).connector?.kind;
    if (kind) void connect(kind);
  }

  function showView(next: "sessions" | "repo-map") {
    setView(next);
    setWorkspaceDialog(null);
  }

  async function clearHistory() {
    if (!window.confirm("Effacer les événements et les prompts/commandes capturés de cette base locale ? Cette action ne peut pas être annulée.")) return;
    await invoke("clear_session_history");
    setEvents([]);
    setHistoryHasMore(false);
  }

  async function loadOlderHistory() {
    const oldest = events.at(-1);
    if (!oldest || historyLoading || !historyHasMore) return;
    setHistoryLoading(true);
    try {
      const older = await invoke<SessionEvent[]>("load_session_events", {
        limit: 500,
        beforeOccurredAt: oldest.occurred_at,
        beforeEventId: oldest.event_id
      });
      setEvents((current) => {
        const byId = new Map([...current, ...older].map((item) => [item.event_id, item]));
        return [...byId.values()].sort(compareEventsNewestFirst);
      });
      setHistoryHasMore(older.length === 500);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function exportHistory() {
    try {
      const path = await save({
        title: "Exporter l’historique RepoWatcher",
        defaultPath: "repowatcher-session-history.json",
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
      if (!path) return;
      const count = await invoke<number>("export_session_history", { path });
      setHistoryNotice(`${count.toLocaleString("fr-FR")} événements exportés en JSON.`);
    } catch {
      setHistoryNotice("Export indisponible dans l’aperçu web ; ouvre l’application de bureau.");
    }
  }


  if (miniMode || narrowWindow) {
    return <MiniView events={analytics.events} collectorState={collectorState} pinned={miniPinned} onTogglePin={toggleMiniPin} onExpand={leaveMini} repositoryName={(project) => workspace.repositoryOf(project)?.name ?? null} />;
  }

  return (
    <div className="app-shell">
      <main className="main-area">
        <header className="topbar">
          <div className="brand-lockup"><div className="brand-mark"><Activity size={18} strokeWidth={2.4} /></div><div><div className="brand-name">repowatcher</div><div className="brand-product">AGENT OBSERVER</div></div></div>
          <WorkspaceSwitcher model={workspace} />
          <nav className="workspace-nav" aria-label="Outils de l’espace de travail"><button onClick={() => showView("sessions")}><Activity size={15} /> Sessions <small>{stats.sessions}</small></button><button onClick={() => openRepositoryMap(null)}><GitBranch size={15} /> Carte du dépôt</button><button onClick={() => setWorkspaceDialog("connectors")}><Plus size={15} /> Connecteurs</button><button onClick={() => setWorkspaceDialog("preferences")} aria-label="Préférences"><Settings2 size={16} /></button><button onClick={() => setWorkspaceDialog("help")} aria-label="Aide"><CircleHelp size={16} /></button><button className="mini-toggle" onClick={goMini} title="Réduire en colonne dans un coin de l’écran"><Minimize2 size={15} /> Mode mini</button></nav>
          <div className="topbar-actions"><div className="local-status"><span className={`status-led ${collectorState === "listening" ? "active" : collectorState.startsWith("error") ? "failed" : ""}`} /> Collecteur <span className={`status-pill ${collectorState.startsWith("error") ? "failed" : ""}`}>{collectorState === "listening" ? (events.length ? "ÉVÉNEMENTS REÇUS" : "EN ÉCOUTE LOCALE") : collectorState.startsWith("error") ? "PORT LOCAL INDISPONIBLE" : collectorState === "preview" ? "APERÇU WEB" : "DÉMARRAGE"}</span></div></div>
        </header>

        <div className="page-content">
          <section>
          <RepositoryFilterBar model={workspace} filter={activeFilter} onFilter={setRepositoryFilter} activity={repositoryActivity} outside={outsideEvents} total={analytics.events.length} />
          <SprintTrack events={scopedEvents} liveEventIds={liveEventIds} />

          <SessionAnalytics events={scopedAnalytics} range={analyticsRange} onRange={setAnalyticsRange} dataset={analytics} repositoryOf={workspace.repositories.length && activeFilter === "all" ? workspace.repositoryOf : undefined} />

          <Resizable id="activity-connectors" defaultHeight={320} min={160} max={1400} label="l’activité récente et les connecteurs">
          <section className="content-grid">
            <div className="panel session-panel">
              <div className="panel-heading"><div><div className="panel-title-row"><h2>Activité récente</h2><span className="live-indicator"><span /> {events.length ? "FLUX AGENTS CONNECTÉS" : "EN ATTENTE DU PREMIER ÉVÉNEMENT"}</span></div><p>Événements réels reçus localement ; texte sensible non conservé par défaut.</p></div></div>
              {scopedEvents.length ? <EventFeed events={scopedEvents} /> : <div className="empty-sessions"><div className="empty-illustration"><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="empty-core"><Bot size={23} /></div><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><span className="orbit-dot dot-three" /></div><h3>Le collecteur local est prêt</h3><p>Configure Claude Code pour les outils en direct, ou Codex pour un événement à chaque fin de tour.<br />Les prompts et commandes sont désactivés par défaut.</p><button className="outline-button" onClick={() => connect("claude")}><TerminalSquare size={15} /> Configurer Claude Code</button></div>}
            </div>

            <div className="panel connectors-panel">
              <div className="panel-heading compact"><div><div className="panel-title-row"><h2>Connecteurs</h2><span className="count-badge">6 pris en charge</span></div><p>État d’observation par source locale</p></div><button className="tiny-icon" onClick={() => setWorkspaceDialog("connectors")} aria-label="Gérer les connecteurs"><Plus size={16} /></button></div>
              <div className="overview-connectors">{OVERVIEW_CONNECTORS.map((provider) => {
                const count = stats.perProvider.get(provider.eventKey) || 0;
                return <div className="overview-connector" key={provider.id}><ProviderMark provider={provider} small /><span className="connector-name">{provider.name}<small className="connector-scope">{count ? `${count} événements reçus` : "En attente d’événement"}</small></span><button className="connector-action" onClick={() => openConnectorSetup(provider.id)}>Configurer</button></div>;
              })}</div>
            </div>
          </section>
          </Resizable>

          <Resizable id="workspace-repositories" defaultHeight={340} min={150} max={1400} label="les dépôts du workspace">
            <WorkspacePanel model={workspace} activity={repositoryActivity} onFilter={setRepositoryFilter} onOpenMap={openRepositoryMap} />
          </Resizable>

          <section className="bottom-grid">
            <div className="panel insight-panel"><div className="insight-heading"><div className="insight-icon"><Sparkles size={16} /></div><div><h2>Conclusion observée</h2><p>Résumé déterministe, sans interprétation LLM</p></div><span className="soon-tag">{events.length ? "SESSION EN COURS / HISTORIQUE" : "EN ATTENTE"}</span></div><div className="insight-empty"><span className="insight-line" /><p>{events.length ? `${stats.toolEvents} événements d’outil et ${stats.files} chemins remontés. Les changements Git affichés ne sont pas attribués à l’agent sans preuve de causalité. Les tokens affichés proviennent des champs réellement exposés par les connecteurs et ne sont pas assimilés à un coût facturable.` : "Aucune conclusion avant la première session réelle. Les événements, l’état Git, les tests et leurs limites seront résumés séparément."}</p></div></div>
          </section>

          </section>
          {view === "sessions" && <WorkspaceModal titleId="history-title" title="Historique des sessions" className="history-dialog" onClose={() => setView("overview")}><SessionExplorer events={events} onConnect={connect} onClear={clearHistory} onLoadOlder={loadOlderHistory} hasMore={historyHasMore} loadingOlder={historyLoading} onExport={exportHistory} notice={historyNotice} repositoryFor={(sessionEvents) => { const repository = sessionEvents.map(workspace.repositoryOf).find(Boolean); return repository ? { root: repository.path, project_hash: repository.project_hash, name: repository.name } : null; }} /></WorkspaceModal>}
          {view === "repo-map" && <WorkspaceModal titleId="repo-title" title={mapRepository ? `Carte du dépôt · ${mapRepository.name}` : "Carte du dépôt"} onClose={() => setView("overview")}><p className="dialog-subtitle">{mapRepository?.path || "Choisis un workspace (un dossier ou un .code-workspace) pour comparer l’état Git de ses dépôts avec les événements des agents."}</p>{mapRepository && workspace.states[mapRepository.path]?.snapshot ? <RepositoryMap snapshot={workspace.states[mapRepository.path]!.snapshot!} events={filterByRepository(events, mapRepository.path, workspace.repositoryOf)} /> : <div className="panel secondary-empty">{mapRepository ? "Lecture de l’état Git…" : "La vue Git lit la branche, les modifications non commitées et les derniers commits de chaque dépôt."}</div>}{workspace.repositories.length > 1 && <div className="map-repository-picker">{workspace.repositories.map((repository) => <button key={repository.path} className={mapRepository?.path === repository.path ? "selected" : ""} onClick={() => setMapRepository(repository)}>{repository.name}</button>)}</div>}</WorkspaceModal>}
          <footer className="page-footer"><span><span className={`footer-led ${collectorState === "listening" ? "active" : collectorState === "preview" ? "preview" : ""}`} /> {collectorState === "listening" ? "Collecteur local actif" : collectorState === "preview" ? "Aperçu web — collecte inactive" : "Collecteur en démarrage"}</span><span>Agent Observer <b>·</b> Connecteurs Claude Code + Codex + Gemini CLI + OpenCode + Cursor + Qwen Code</span><span>Événements chargés : {events.length}</span></footer>
        </div>
      </main>
      {workspaceDialog && <WorkspaceDialog kind={workspaceDialog} search={search} onSearch={setSearch} onConfigure={openConnectorSetup} onShow={setWorkspaceDialog} onOpenHistory={() => { setWorkspaceDialog(null); setView("sessions"); }} onClose={() => setWorkspaceDialog(null)} />}
      {connectorSetup && <ConnectorSetupDialog key={connectorSetup.kind} connector={connectorSetup} onClose={() => setConnectorSetup(null)} />}
    </div>
  );
}

/** Overview panel order: provider table order, connectors only. */
const OVERVIEW_CONNECTORS = ["claude_code", "codex", "cursor", "opencode", "gemini", "qwen"].map(providerById);


function readFlag(key: string, fallback: boolean) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try { window.localStorage.setItem(key, value ? "1" : "0"); } catch { /* optional preference */ }
}

/** The dashboard needs width; a window narrowed by hand switches to the mini layout. */
function useNarrowWindow() {
  const query = "(max-width: 700px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}
