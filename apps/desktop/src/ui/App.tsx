import { useEffect, useMemo, useState } from "react";
import { t, useLang } from "./i18n";
import { Activity, CircleHelp, Minimize2 } from "lucide-react";
import type { AgentPulse } from "./agentPulse";
import type { AnalyticsRange } from "./analytics";
import { CollectorStatus } from "./CollectorStatus";
import { ConnectorSetupDialog, type ConnectorSetup } from "./ConnectorDialog";
import { ConnectorsPage } from "./ConnectorsPage";
import { HelpPanel } from "./HelpPanel";
import { MiniView } from "./MiniView";
import { enterMiniWindow, leaveMiniWindow, setMiniPinned } from "./miniWindow";
import { OverviewPage } from "./OverviewPage";
import { isBoolean, isString, oneOf, usePreference } from "./preferences";
import { RepositoriesPage } from "./RepositoriesPage";
import { SessionsPage } from "./SessionsPage";
import { SettingsPage } from "./SettingsPage";
import { sessionKey } from "./types";
import { useAnalyticsEvents } from "./useAnalyticsEvents";
import { useDialogFocus } from "./useDialogFocus";
import { useNow } from "./useNow";
import { useObserver } from "./useObserver";
import { useWorkspace } from "./useWorkspace";
import { useFocusAgent } from "./useFocusAgent";
import { FocusToast } from "./FocusToast";
import { NotificationCenter } from "./NotificationCenter";
import { agentName, setCustomProviders, useAgents, type CustomConnectorInfo } from "./providers";
import { invoke } from "@tauri-apps/api/core";
import { filterByRepository, pathKey, type RepositoryFilter } from "./workspace";
import { RepositoryFilterBar, WorkspaceSwitcher, useRepositoryActivity } from "./WorkspaceViews";

type Tab = "overview" | "sessions" | "repositories" | "connectors" | "settings";
const tabs = (): Array<[Tab, string]> => [["overview", t("Vue d’ensemble", "Overview")], ["sessions", "Sessions"], ["repositories", t("Dépôts", "Repositories")], ["connectors", t("Connecteurs", "Connectors")], ["settings", t("Réglages", "Settings")]];
const isTab = oneOf("overview", "sessions", "repositories", "connectors", "settings");
const isRange = oneOf("15m", "1h", "24h", "all");

export function App() {
  useLang();
  useAgents();
  useEffect(() => { invoke<CustomConnectorInfo[]>("list_custom_connectors").then(setCustomProviders).catch(() => undefined); }, []);
  const observer = useObserver();
  const [tab, setTab] = usePreference<Tab>("tab", "overview", isTab);
  const [range, setRange] = usePreference<AnalyticsRange>("analytics-range", "24h", isRange);
  const [storedFilter, setRepositoryFilter] = usePreference<RepositoryFilter>("repository-filter", "all", isString);
  const [miniMode, setMiniMode] = usePreference("mini-mode", false, isBoolean);
  const [miniPinned, setMiniPinnedPreference] = usePreference("mini-pinned", true, isBoolean);
  const [helpOpen, setHelpOpen] = useState(false);
  const [connectorSetup, setConnectorSetup] = useState<ConnectorSetup | null>(null);
  const narrowWindow = useNarrowWindow();
  const compact = miniMode || narrowWindow;

  // Agent cards always look at the last 24 hours; charts follow the chosen period. Both read the
  // whole local database for their window, merged with live events.
  const agentWindow = useAnalyticsEvents("24h", observer.events);
  const chartWindow = useAnalyticsEvents(range, observer.events);
  const workspace = useWorkspace(agentWindow.events);
  const filter: RepositoryFilter = storedFilter === "all" || storedFilter === "outside" || workspace.repositories.some((repository) => pathKey(repository.path) === pathKey(storedFilter)) ? storedFilter : "all";
  const scope = useMemo(() => ({
    events: filterByRepository(observer.events, filter, workspace.repositoryOf),
    agentEvents: filterByRepository(agentWindow.events, filter, workspace.repositoryOf),
    chartEvents: filterByRepository(chartWindow.events, filter, workspace.repositoryOf)
  }), [observer.events, agentWindow.events, chartWindow.events, filter, workspace.repositoryOf]);
  const { activity: repositoryActivity, outside } = useRepositoryActivity(chartWindow.events, workspace);
  const sessionCount = useMemo(() => new Set(observer.events.map(sessionKey)).size, [observer.events]);
  const setup = useMemo(() => ({
    anyAgent: agentWindow.events.length > 0 || observer.events.length > 0,
    claudeHooks: observer.events.some((event) => event.provider === "claude_code" && event.kind !== "model_usage" && event.kind !== "session_started"),
    workspace: Boolean(workspace.workspace)
  }), [agentWindow.events.length, observer.events, workspace.workspace]);
  const focus = useFocusAgent();
  const goToAgent = (pulse: AgentPulse) => {
    if (!pulse.session) return;
    void focus.goTo({ provider: pulse.key, sessionId: pulse.session.id, projectPath: pulse.project?.project_path ?? null, agentName: agentName(pulse.key) });
  };
  const watcher = <NotificationCenter events={agentWindow.events} onGoTo={(target) => void focus.goTo(target)} />;
  const toast = <FocusToast toast={focus.toast} onReveal={(path) => void focus.revealFolder(path)} onDismiss={focus.dismiss} />;
  const repositoryName = (pulse: AgentPulse) => (pulse.project ? workspace.repositoryOf(pulse.project)?.name ?? null : null);

  useDialogFocus(() => {
    if (connectorSetup) setConnectorSetup(null);
    else setHelpOpen(false);
  }, [connectorSetup, helpOpen]);

  useEffect(() => {
    // The corner placement is re-applied when the app starts in mini mode.
    if (miniMode) void enterMiniWindow(miniPinned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goMini() {
    setMiniMode(true);
    void enterMiniWindow(miniPinned);
  }

  function leaveMini() {
    setMiniMode(false);
    void leaveMiniWindow();
  }

  function filterOn(next: RepositoryFilter) {
    setRepositoryFilter(next);
    setTab("overview");
  }

  if (compact) {
    return <><MiniView agentEvents={agentWindow.events} collectorState={observer.collectorState} pinned={miniPinned} onTogglePin={() => { setMiniPinnedPreference(!miniPinned); void setMiniPinned(!miniPinned); }} onExpand={leaveMini} repositoryName={repositoryName} onGoTo={goToAgent} />{watcher}{toast}</>;
  }

  return <div className="app">
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><Activity size={17} strokeWidth={2.4} /></span><span><b>Agent Observer</b><small>{t("par RepoWatcher", "by RepoWatcher")}</small></span></div>
      <WorkspaceSwitcher model={workspace} />
      <div className="header-actions">
        <CollectorStatus state={observer.collectorState} />
        <button className="button" onClick={goMini} title={t("Réduire l’app à une colonne dans un coin de l’écran", "Shrink the app to a column in a corner of the screen")}><Minimize2 size={15} /> {t("Mode mini", "Mini mode")}</button>
        <button className="button" onClick={() => setHelpOpen(true)}><CircleHelp size={15} /> {t("Aide", "Help")}</button>
      </div>
    </header>

    <nav className="tabs" aria-label="Sections">
      {tabs().map(([id, label]) => <button key={id} className="tab" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
        {label}
        {id === "sessions" && sessionCount > 0 && <small>{sessionCount}</small>}
        {id === "repositories" && workspace.repositories.length > 0 && <small>{workspace.repositories.length}</small>}
        {id === "connectors" && !setup.claudeHooks && <i className="tab-dot" title={t("Une action est conseillée", "An action is recommended")} />}
      </button>)}
    </nav>

    <main className="app-main">
      {watcher}
      {tab === "overview" && <>
        <RepositoryFilterBar model={workspace} filter={filter} onFilter={setRepositoryFilter} activity={repositoryActivity} outside={outside} total={chartWindow.events.length} />
        <OverviewPage
          agentEvents={scope.agentEvents}
          events={scope.events}
          analyticsEvents={scope.chartEvents}
          analytics={chartWindow}
          range={range}
          onRange={setRange}
          liveEventIds={observer.liveEventIds}
          repositoryOf={workspace.repositories.length && filter === "all" ? workspace.repositoryOf : undefined}
          repositoryName={repositoryName}
          onGoTo={goToAgent}
          setup={setup}
          onOpen={setTab}
        />
      </>}
      {tab === "sessions" && <SessionsTab observer={observer} repositoryOf={workspace.repositoryOf} />}
      {tab === "repositories" && <RepositoriesPage model={workspace} activity={repositoryActivity} events={chartWindow.events} onFilter={filterOn} />}
      {tab === "connectors" && <ConnectorsTab events={agentWindow.events} onConfigure={setConnectorSetup} />}
      {tab === "settings" && <SettingsPage onExport={observer.exportHistory} onClear={observer.clearHistory} onMini={goMini} />}
    </main>

    {toast}
    {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    {connectorSetup && <ConnectorSetupDialog key={connectorSetup.kind} connector={connectorSetup} onClose={() => setConnectorSetup(null)} />}
  </div>;
}

/** Pages that show relative times tick slowly on their own. */
function SessionsTab({ observer, repositoryOf }: { observer: ReturnType<typeof useObserver>; repositoryOf: Parameters<typeof SessionsPage>[0]["repositoryOf"] }) {
  const now = useNow(30_000);
  return <SessionsPage events={observer.events} hasMore={observer.hasMore} loadingOlder={observer.loadingOlder} onLoadOlder={observer.loadOlder} repositoryOf={repositoryOf} now={now} />;
}

function ConnectorsTab({ events, onConfigure }: Omit<Parameters<typeof ConnectorsPage>[0], "now">) {
  const now = useNow(10_000);
  return <ConnectorsPage events={events} now={now} onConfigure={onConfigure} />;
}

/** The dashboard needs width: a window narrowed by hand switches to the mini layout. */
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
