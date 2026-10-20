import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { deriveRaceState, isTurnComplete } from "./race";
import { describeAgentAction } from "./activity-copy";
import type { RaceLane } from "./SprintTrack3D";

const SprintTrack3D = lazy(() => import("./SprintTrack3D"));
import {
  Activity, ArrowDownToLine, Bot, ChevronDown, CircleHelp,
  FolderGit2, GitBranch, Gauge, LayoutDashboard, Plus,
  Search, Settings2, ShieldCheck, Sparkles, TerminalSquare
} from "lucide-react";

type Provider = {
  id: string;
  name: string;
  initials: string;
  color: string;
  surface: string;
};

type SessionEvent = {
  event_id: string;
  session_id: string;
  occurred_at: string;
  provider: string;
  kind: string;
  project_path: string | null;
  project_hash?: string | null;
  tool_name: string | null;
  command?: string | null;
  file_path: string | null;
  content?: string | null;
  input_tokens?: { value: number; origin: string } | null;
  output_tokens?: { value: number; origin: string } | null;
  model?: { value: string; origin: string } | null;
  duration_ms?: { value: number; origin: string } | null;
  outcome?: string | null;
};

type ClaudeSetup = { endpoint: string; token: string; settings_fragment: string; capture_prompts: boolean; capture_commands: boolean };
type CodexSetup = { sessions_dir: string; available: boolean; capture_prompts: boolean; capture_commands: boolean };
type GeminiSetup = { sessions_dir: string; available: boolean; capture_prompts: boolean; capture_commands: boolean };
type OpenCodeSetup = { data_dir: string; database_paths: string[]; available: boolean; capture_prompts: boolean; capture_commands: boolean };
type CursorSetup = { endpoint: string; settings_fragment: string; capture_prompts: boolean; capture_commands: boolean };
type RepositorySnapshot = {
  root: string;
  project_hash: string;
  branch: string | null;
  changed_files: Array<{ path: string; status: string }>;
  recent_commits: Array<{ short_id: string; subject: string; relative_time: string }>;
};

const providers: Provider[] = [
  { id: "claude_code", name: "Claude Code", initials: "C", color: "#e59b6b", surface: "#3a2921" },
  { id: "codex", name: "Codex", initials: "⌘", color: "#76d6ae", surface: "#1d342d" },
  { id: "cursor", name: "Cursor", initials: "◈", color: "#8cc9ff", surface: "#1f3040" },
  { id: "opencode", name: "OpenCode", initials: "O", color: "#8dc8c1", surface: "#203633" },
  { id: "copilot", name: "GitHub Copilot", initials: "⌘", color: "#c1b5ff", surface: "#302a43" },
  { id: "gemini", name: "Gemini CLI", initials: "✳", color: "#9db9ff", surface: "#252f49" },
  { id: "cline", name: "Cline", initials: "C", color: "#efb477", surface: "#3c3023" },
  { id: "roo", name: "Roo Code", initials: "R", color: "#80c99c", surface: "#24382c" },
  { id: "continue", name: "Continue", initials: "↳", color: "#c0c7d4", surface: "#30343c" },
  { id: "aider", name: "Aider", initials: "A", color: "#f18e8e", surface: "#402727" }
];

export function App() {
  const [repoPath, setRepoPath] = useState<string | null>(() => window.localStorage.getItem("repowatcher.selected-repository"));
  const [view, setView] = useState<"overview" | "sessions" | "repo-map">("overview");
  const [workspaceDialog, setWorkspaceDialog] = useState<"connectors" | "preferences" | "help" | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [liveEventIds, setLiveEventIds] = useState<Record<string, string>>({});
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyNotice, setHistoryNotice] = useState("");
  const [repoSnapshot, setRepoSnapshot] = useState<RepositorySnapshot | null>(null);
  const [collectorState, setCollectorState] = useState("starting");
  const [claudeSetup, setClaudeSetup] = useState<ClaudeSetup | null>(null);
  const [codexSetup, setCodexSetup] = useState<CodexSetup | null>(null);
  const [geminiSetup, setGeminiSetup] = useState<GeminiSetup | null>(null);
  const [opencodeSetup, setOpenCodeSetup] = useState<OpenCodeSetup | null>(null);
  const [cursorSetup, setCursorSetup] = useState<CursorSetup | null>(null);
  const [capturePrompts, setCapturePrompts] = useState(false);
  const [captureCommands, setCaptureCommands] = useState(false);
  const [policyError, setPolicyError] = useState("");
  const [copyState, setCopyState] = useState("Copier le fragment JSON");
  const activeDialog = useRef<HTMLElement | null>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialogs = [...document.querySelectorAll<HTMLElement>(".workspace-modal [role='dialog'], .setup-backdrop [role='dialog']")];
    const dialog = dialogs.at(-1);
    if (!dialog) {
      if (activeDialog.current) {
        if (dialogOpener.current?.isConnected) dialogOpener.current.focus();
        activeDialog.current = null;
        dialogOpener.current = null;
      }
      return;
    }
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])")];
    if (!activeDialog.current) dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const changedDialog = activeDialog.current !== dialog;
    activeDialog.current = dialog;
    if (changedDialog) dialog.focus();
    else if (!dialog.contains(document.activeElement)) (focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (claudeSetup) setClaudeSetup(null);
        else if (cursorSetup) setCursorSetup(null);
        else if (codexSetup) setCodexSetup(null);
        else if (geminiSetup) setGeminiSetup(null);
        else if (opencodeSetup) setOpenCodeSetup(null);
        else if (workspaceDialog) setWorkspaceDialog(null);
        else setView("overview");
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
    };
  }, [view, workspaceDialog, claudeSetup, cursorSetup, codexSetup, geminiSetup, opencodeSetup]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const refreshStatus = () => invoke<string>("collector_status").then(setCollectorState).catch(() => setCollectorState("preview"));
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 1500);
    const chartTimer = window.setInterval(() => setClock(Date.now()), 1000);
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
    return () => { window.clearInterval(timer); window.clearInterval(chartTimer); unlisten?.(); unlistenError?.(); };
  }, []);
  useEffect(() => {
    if (repoPath) window.localStorage.setItem("repowatcher.selected-repository", repoPath);
    else window.localStorage.removeItem("repowatcher.selected-repository");
    if (!repoPath) {
      setRepoSnapshot(null);
      return;
    }
    let active = true;
    const refreshRepository = () => invoke<RepositorySnapshot>("repository_snapshot", { path: repoPath }).then((snapshot) => {
      if (active) setRepoSnapshot(snapshot);
    }).catch(() => {
      if (active) setRepoSnapshot(null);
    });
    refreshRepository();
    const timer = window.setInterval(refreshRepository, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [repoPath]);
  const filteredProviders = useMemo(
    () => providers.filter((provider) => provider.name.toLowerCase().includes(search.toLowerCase())),
    [search]
  );
  const inputTokens = events.reduce((sum, event) => sum + (event.input_tokens?.value || 0), 0);
  const outputTokens = events.reduce((sum, event) => sum + (event.output_tokens?.value || 0), 0);
  const hasTokenUsage = events.some((event) => event.input_tokens || event.output_tokens);

  async function selectRepository() {
    const selected = await open({ directory: true, multiple: false, title: "Choisir un dépôt Git" });
    if (typeof selected === "string") {
      setRepoPath(selected);
    }
  }

  async function connectClaude() {
    const setup = await invoke<ClaudeSetup>("claude_setup");
    setCapturePrompts(setup.capture_prompts);
    setCaptureCommands(setup.capture_commands);
    setClaudeSetup(setup);
  }

  async function connectCodex() {
    const setup = await invoke<CodexSetup>("codex_setup");
    setCapturePrompts(setup.capture_prompts);
    setCaptureCommands(setup.capture_commands);
    setCodexSetup(setup);
  }

  async function connectGemini() {
    const setup = await invoke<GeminiSetup>("gemini_setup");
    setCapturePrompts(setup.capture_prompts);
    setCaptureCommands(setup.capture_commands);
    setGeminiSetup(setup);
  }

  async function connectOpenCode() {
    const setup = await invoke<OpenCodeSetup>("opencode_setup");
    setCapturePrompts(setup.capture_prompts);
    setCaptureCommands(setup.capture_commands);
    setOpenCodeSetup(setup);
  }

  async function connectCursor() {
    const setup = await invoke<CursorSetup>("cursor_setup");
    setCapturePrompts(setup.capture_prompts);
    setCaptureCommands(setup.capture_commands);
    setCursorSetup(setup);
  }

  function openConnectorSetup(providerId: string) {
    setWorkspaceDialog(null);
    const connect = providerId === "claude_code" ? connectClaude : providerId === "codex" ? connectCodex : providerId === "gemini" ? connectGemini : providerId === "opencode" ? connectOpenCode : providerId === "cursor" ? connectCursor : undefined;
    if (connect) void connect();
  }

  async function saveCapturePolicy(prompts: boolean, commands: boolean) {
    setPolicyError("");
    setCapturePrompts(prompts);
    setCaptureCommands(commands);
    try {
      await invoke("update_capture_policy", { capturePrompts: prompts, captureCommands: commands });
    } catch {
      setPolicyError("Impossible d’enregistrer les préférences depuis l’aperçu web.");
    }
  }

  async function copyClaudeConfig() {
    if (!claudeSetup) return;
    await navigator.clipboard.writeText(claudeSetup.settings_fragment);
    setCopyState("Copié");
    window.setTimeout(() => setCopyState("Copier le fragment JSON"), 1800);
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

  return (
    <div className="app-shell">
      <main className="main-area">
        <header className="topbar">
          <div className="brand-lockup"><div className="brand-mark"><Activity size={18} strokeWidth={2.4} /></div><div><div className="brand-name">repowatcher</div><div className="brand-product">AGENT OBSERVER</div></div></div>
          <button className="workspace-switcher top-repository" onClick={selectRepository}><span className="workspace-icon"><FolderGit2 size={16} /></span><span className="workspace-copy"><b>{repoPath ? repoPath.split(/[\\/]/).filter(Boolean).at(-1) : "Aucun dépôt"}</b><small>{repoPath ? "Dépôt local sélectionné" : "Choisir un dépôt local"}</small></span><ChevronDown size={14} className="muted" /></button>
          <nav className="workspace-nav" aria-label="Outils de l’espace de travail"><button onClick={() => { setView("sessions"); setWorkspaceDialog(null); }}><Activity size={15} /> Sessions <small>{new Set(events.map(sessionKey)).size}</small></button><button onClick={() => { setView("repo-map"); setWorkspaceDialog(null); }}><GitBranch size={15} /> Carte du dépôt</button><button onClick={() => setWorkspaceDialog("connectors")}><Plus size={15} /> Connecteurs</button><button onClick={() => setWorkspaceDialog("preferences")} aria-label="Préférences"><Settings2 size={16} /></button><button onClick={() => setWorkspaceDialog("help")} aria-label="Aide"><CircleHelp size={16} /></button></nav>
          <div className="topbar-actions"><div className="local-status"><span className={`status-led ${collectorState === "listening" ? "active" : collectorState.startsWith("error") ? "failed" : ""}`} /> Collecteur <span className={`status-pill ${collectorState.startsWith("error") ? "failed" : ""}`}>{collectorState === "listening" ? (events.length ? "ÉVÉNEMENTS REÇUS" : "EN ÉCOUTE LOCALE") : collectorState.startsWith("error") ? "PORT LOCAL INDISPONIBLE" : collectorState === "preview" ? "APERÇU WEB" : "DÉMARRAGE"}</span></div></div>
        </header>

        <div className="page-content">
          <section>
          <SprintTrack events={events} now={clock} liveEventIds={liveEventIds} />

          <section className="metrics-grid" aria-label="Indicateurs des sessions">
            <Metric icon={<Activity size={16} />} label="Sessions observées" value={String(new Set(events.map(sessionKey)).size)} note="Claude Code + Codex + Gemini CLI + OpenCode + Cursor, données locales" tone="blue" />
            <Metric icon={<Gauge size={16} />} label="Tokens relevés" value={hasTokenUsage ? `${formatCount(inputTokens)} / ${formatCount(outputTokens)}` : "— / —"} note="Input / output des événements chargés" tone="purple" />
            <Metric icon={<TerminalSquare size={16} />} label="Actions outil" value={String(events.filter((event) => event.kind.startsWith("tool_")).length)} note="Événements reçus" tone="amber" />
            <Metric icon={<FolderGit2 size={16} />} label="Fichiers observés" value={String(new Set(events.map((event) => event.file_path).filter(Boolean)).size)} note={repoPath ? "Dans les sessions observées" : "Chemins fournis par les agents"} tone="green" />
          </section>

          <section className="content-grid">
            <div className="panel session-panel">
              <div className="panel-heading"><div><div className="panel-title-row"><h2>Activité récente</h2><span className="live-indicator"><span /> {events.length ? "FLUX AGENTS CONNECTÉS" : "EN ATTENTE DU PREMIER ÉVÉNEMENT"}</span></div><p>Événements réels reçus localement ; texte sensible non conservé par défaut.</p></div></div>
              {events.length > 0 && <ActivityChart events={events} now={clock} />}
              {events.length ? <div className="event-feed">{events.map((event) => <div className="event-row" key={event.event_id}><time>{new Date(event.occurred_at).toLocaleTimeString()}</time><span className="event-kind">{event.provider} · {event.kind.replaceAll("_", " ")}</span><span className="event-detail">{event.command || event.content || event.tool_name || event.file_path || event.project_path || event.session_id}</span><EventPayload event={event} /></div>)}</div> : <div className="empty-sessions"><div className="empty-illustration"><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="empty-core"><Bot size={23} /></div><span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><span className="orbit-dot dot-three" /></div><h3>Le collecteur local est prêt</h3><p>Configure Claude Code pour les outils en direct, ou Codex pour un événement à chaque fin de tour.<br />Les prompts et commandes sont désactivés par défaut.</p><button className="outline-button" onClick={connectClaude}><TerminalSquare size={15} /> Configurer Claude Code</button></div>}
            </div>

            <div className="panel connectors-panel">
              <div className="panel-heading compact"><div><div className="panel-title-row"><h2>Connecteurs</h2><span className="count-badge">5 pris en charge</span></div><p>État d’observation par source locale</p></div><button className="tiny-icon" onClick={() => setWorkspaceDialog("connectors")} aria-label="Gérer les connecteurs"><Plus size={16} /></button></div>
              <div className="overview-connectors">{providers.filter((provider) => ["claude_code", "codex", "gemini", "opencode", "cursor"].includes(provider.id)).map((provider) => {
                const eventProvider = provider.id === "gemini" ? "gemini_cli" : provider.id;
                const count = events.filter((event) => event.provider === eventProvider).length;
                return <div className="overview-connector" key={provider.id}><ProviderMark provider={provider} small /><span className="connector-name">{provider.name}<small className="connector-scope">{count ? `${count} événements reçus` : "En attente d’événement"}</small></span><button className="connector-action" onClick={() => openConnectorSetup(provider.id)}>Configurer</button></div>;
              })}</div>
            </div>
          </section>

          <section className="bottom-grid">
            <div className="panel repo-panel"><div className="panel-heading compact"><div><h2>Carte du dépôt</h2><p>{repoPath || "Choisis un dépôt pour afficher son état Git et les fichiers observés."}</p></div><button className="outline-button" onClick={() => { setView("repo-map"); setWorkspaceDialog(null); }}>Détails Git</button></div>{repoSnapshot ? <div className="repo-summary"><b>{repoSnapshot.branch || "HEAD détachée"}</b><span>{repoSnapshot.changed_files.length} changements non commités</span><span>{repoSnapshot.recent_commits.length} commits récents</span></div> : <div className="repo-empty"><div className="repo-grid-icon"><FolderGit2 size={21} /></div><span>{repoPath ? "État Git indisponible — vérifie que Git est installé et ce dossier est un dépôt." : "Choisis un dépôt local pour lire son état Git."}</span></div>}</div>
            <div className="panel insight-panel"><div className="insight-heading"><div className="insight-icon"><Sparkles size={16} /></div><div><h2>Conclusion observée</h2><p>Résumé déterministe, sans interprétation LLM</p></div><span className="soon-tag">{events.length ? "SESSION EN COURS / HISTORIQUE" : "EN ATTENTE"}</span></div><div className="insight-empty"><span className="insight-line" /><p>{events.length ? `${events.filter((event) => event.kind.startsWith("tool_")).length} événements d’outil et ${new Set(events.map((event) => event.file_path).filter(Boolean)).size} chemins remontés. Les changements Git affichés ne sont pas attribués à l’agent sans preuve de causalité. Les tokens affichés proviennent des champs réellement exposés par les connecteurs et ne sont pas assimilés à un coût facturable.` : "Aucune conclusion avant la première session réelle. Les événements, l’état Git, les tests et leurs limites seront résumés séparément."}</p></div></div>
          </section>

          </section>
          {view === "sessions" && <div className="workspace-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setView("overview"); }}><section className="workspace-dialog history-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="history-title"><button className="setup-close" onClick={() => setView("overview")} aria-label="Fermer">×</button><h2 id="history-title">Historique des sessions</h2><SessionExplorer events={events} onConnect={connectClaude} onConnectCodex={connectCodex} onConnectGemini={connectGemini} onConnectOpenCode={connectOpenCode} onClear={clearHistory} onLoadOlder={loadOlderHistory} hasMore={historyHasMore} loadingOlder={historyLoading} onExport={exportHistory} notice={historyNotice} /></section></div>}
          {view === "repo-map" && <div className="workspace-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setView("overview"); }}><section className="workspace-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="repo-title"><button className="setup-close" onClick={() => setView("overview")} aria-label="Fermer">×</button><h2 id="repo-title">Carte du dépôt</h2><p className="dialog-subtitle">{repoPath || "Sélectionne un dépôt Git local pour comparer son état avec les événements des agents."}</p>{repoSnapshot ? <RepositoryMap snapshot={repoSnapshot} events={events} /> : <div className="panel secondary-empty">La vue Git lit la branche, les modifications non commitées et les derniers commits.</div>}<button className="primary-button" onClick={selectRepository}><Plus size={16} /> {repoPath ? "Changer de dépôt" : "Sélectionner un dépôt"}</button></section></div>}
          <footer className="page-footer"><span><span className={`footer-led ${collectorState === "listening" ? "active" : collectorState === "preview" ? "preview" : ""}`} /> {collectorState === "listening" ? "Collecteur local actif" : collectorState === "preview" ? "Aperçu web — collecte inactive" : "Collecteur en démarrage"}</span><span>Agent Observer <b>·</b> Connecteurs Claude Code + Codex + Gemini CLI + OpenCode + Cursor</span><span>Événements chargés : {events.length}</span></footer>
        </div>
      </main>
      {workspaceDialog && <div className="workspace-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWorkspaceDialog(null); }}><section className="workspace-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="workspace-dialog-title"><button className="setup-close" onClick={() => setWorkspaceDialog(null)} aria-label="Fermer">×</button>{workspaceDialog === "connectors" ? <><h2 id="workspace-dialog-title">Connecteurs</h2><p className="dialog-subtitle">Configure les sources locales et leurs préférences de confidentialité.</p><div className="connector-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrer les connecteurs" aria-label="Filtrer les connecteurs" /></div><div className="connector-list dialog-connectors">{filteredProviders.map((provider) => <ProviderCard key={provider.id} provider={provider} active={["claude_code", "codex", "gemini", "opencode", "cursor"].includes(provider.id)} onClick={() => openConnectorSetup(provider.id)} label={provider.id === "codex" || provider.id === "gemini" ? "Journaux locaux" : provider.id === "opencode" ? "SQLite local" : provider.id === "cursor" ? "Hooks officiels" : undefined} />)}</div><div className="connectors-footer">Claude Code, Codex, Gemini CLI, OpenCode et Cursor sont pris en charge localement. Les réglages de confidentialité se règlent dans chaque configuration.</div></> : workspaceDialog === "preferences" ? <><h2 id="workspace-dialog-title">Préférences et confidentialité</h2><p>Les événements sont conservés localement. Les prompts et commandes restent désactivés par défaut. Choisis un connecteur pour consulter ou modifier ses options de capture.</p><div className="privacy-card"><div className="privacy-icon"><ShieldCheck size={15} /></div><div><b>Données locales</b><span>Rien n’est envoyé au cloud</span></div><span className="privacy-dot" /></div><button className="primary-button" onClick={() => setWorkspaceDialog("connectors")}>Ouvrir les connecteurs</button></> : <><h2 id="workspace-dialog-title">Aide</h2><p>Agent Observer affiche l’activité exposée localement, l’état Git du dépôt choisi et les métriques observées. Les changements Git ne sont pas attribués à un agent sans preuve.</p><p>Les bulles résument les événements connus et ne montrent jamais les journaux bruts. Ouvre l’historique pour parcourir les détails d’une session.</p><button className="primary-button" onClick={() => { setWorkspaceDialog(null); setView("sessions"); }}>Ouvrir l’historique</button></>}</section></div>}
      {claudeSetup && <div className="setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setClaudeSetup(null); }}><section className="setup-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="claude-setup-title"><button className="setup-close" onClick={() => setClaudeSetup(null)} aria-label="Fermer">×</button><div className="eyebrow">CONNECTEUR LOCAL</div><h2 id="claude-setup-title">Brancher Claude Code</h2><p>Ajoute ce fragment dans les réglages utilisateur Claude Code (`~/.claude/settings.json`, ou `%USERPROFILE%\.claude\settings.json` sous Windows). Fusionne-le avec l’existant : ne remplace pas tout le fichier. Aucun réglage n’est modifié automatiquement.</p><ol><li>Ouvre les réglages utilisateur Claude Code.</li><li>Ajoute les entrées <code>hooks</code> dans l’objet existant.</li><li>Redémarre une session Claude Code pour recevoir les événements.</li></ol><div className="privacy-options"><label><input type="checkbox" checked={captureCommands} onChange={(event) => saveCapturePolicy(capturePrompts, event.target.checked)} /><span><b>Enregistrer les commandes Bash/PowerShell</b><small>Peuvent contenir des chemins, jetons ou mots de passe collés dans le shell.</small></span></label><label><input type="checkbox" checked={capturePrompts} onChange={(event) => saveCapturePolicy(event.target.checked, captureCommands)} /><span><b>Enregistrer le texte de mes prompts</b><small>Peut inclure du code privé ou des données confidentielles.</small></span></label>{policyError && <p className="policy-error">{policyError}</p>}<small>Si activé, le contenu reste dans la base SQLite locale de cette installation. Les sorties d’outils et transcriptions ne sont jamais conservées.</small></div><textarea readOnly value={claudeSetup.settings_fragment} aria-label="Configuration Claude Code" /><div className="setup-note">Toujours captés : identifiant de session, outil, chemin du dépôt/fichier et type d’événement. Entrée locale authentifiée : <code>{claudeSetup.endpoint}</code></div><div className="setup-actions"><button className="outline-button" onClick={() => setClaudeSetup(null)}>Fermer</button><button className="primary-button" onClick={copyClaudeConfig}>{copyState}</button></div></section></div>}
      {cursorSetup && <div className="setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCursorSetup(null); }}><section className="setup-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="cursor-setup-title"><button className="setup-close" onClick={() => setCursorSetup(null)} aria-label="Fermer">×</button><div className="eyebrow">CONNECTEUR LOCAL · HOOKS CURSOR</div><h2 id="cursor-setup-title">Brancher Cursor</h2><p>Fusionne ce fragment dans <code>~/.cursor/hooks.json</code> (Windows : <code>%USERPROFILE%\.cursor\hooks.json</code>). Ne remplace pas un fichier existant : ajoute les événements dans son bloc <code>hooks</code>. Aucun réglage Cursor n’est modifié automatiquement.</p><ol><li>Laisse Agent Observer ouvert pendant une session Cursor.</li><li>Ajoute le fragment aux réglages de hooks utilisateur.</li><li>Cursor recharge les hooks ; démarre une conversation pour vérifier le flux.</li></ol><div className="privacy-options"><label><input type="checkbox" checked={captureCommands} onChange={(event) => saveCapturePolicy(capturePrompts, event.target.checked)} /><span><b>Enregistrer les commandes transmises aux outils</b><small>Désactivé par défaut ; peut contenir des secrets.</small></span></label><small>Prompts, réponses, sorties, transcriptions, identités et pensées ne sont pas conservés. Cursor n’expose pas de compteurs de tokens dans ces hooks.</small>{policyError && <p className="policy-error">{policyError}</p>}</div><textarea readOnly value={cursorSetup.settings_fragment} aria-label="Configuration des hooks Cursor" /><div className="setup-note">Les hooks d’observation n’interviennent pas dans les autorisations de Cursor. Entrée locale authentifiée : <code>{cursorSetup.endpoint}</code></div><div className="setup-actions"><button className="outline-button" onClick={() => setCursorSetup(null)}>Fermer</button><button className="primary-button" onClick={async () => { await navigator.clipboard.writeText(cursorSetup.settings_fragment); setCursorSetup(null); }}>Copier le fragment JSON</button></div></section></div>}
      {codexSetup && <div className="setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCodexSetup(null); }}><section className="setup-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="codex-setup-title"><button className="setup-close" onClick={() => setCodexSetup(null)} aria-label="Fermer">×</button><div className="eyebrow">CONNECTEUR LOCAL · JOURNAUX NATIFS</div><h2 id="codex-setup-title">Codex est observé localement</h2><p>RepoWatcher suit les journaux de session Codex sur cet ordinateur ; aucun réglage Codex n’est modifié. Les nouveaux événements sont lus à mesure qu’ils sont écrits. L’historique antérieur au démarrage de RepoWatcher n’est pas importé.</p><div className="privacy-options"><div><b>Source locale</b><small>{codexSetup.available ? "Dossier Codex détecté" : "Dossier Codex absent pour l’instant"}<br /><code>{codexSetup.sessions_dir}</code></small></div><label><input type="checkbox" checked={captureCommands} onChange={(event) => saveCapturePolicy(capturePrompts, event.target.checked)} /><span><b>Enregistrer les commandes transmises aux outils</b><small>Désactivé par défaut ; une commande peut contenir des secrets.</small></span></label><label><input type="checkbox" checked={capturePrompts} onChange={(event) => saveCapturePolicy(event.target.checked, captureCommands)} /><span><b>Enregistrer le texte de mes prompts</b><small>Désactivé par défaut ; peut contenir du code et des données privées.</small></span></label>{policyError && <p className="policy-error">{policyError}</p>}<small>Les sorties d’outils, réponses assistant et raisonnements ne sont jamais conservés. Seuls les champs opérationnels nécessaires à la timeline sont extraits.</small></div><div className="setup-note">Codex peut fournir les événements d’outils et les compteurs input/output par requête dans ses journaux locaux. Ces compteurs ne sont pas un coût total universel et peuvent évoluer selon la version de Codex.</div><div className="setup-actions"><button className="primary-button" onClick={() => setCodexSetup(null)}>Terminé</button></div></section></div>}
      {geminiSetup && <div className="setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setGeminiSetup(null); }}><section className="setup-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="gemini-setup-title"><button className="setup-close" onClick={() => setGeminiSetup(null)} aria-label="Fermer">×</button><div className="eyebrow">CONNECTEUR LOCAL · JOURNAUX NATIFS</div><h2 id="gemini-setup-title">Gemini CLI est observé localement</h2><p>RepoWatcher suit les enregistrements de sessions Gemini CLI ; aucun réglage Gemini n’est modifié. Les nouveaux messages sont suivis à mesure qu’ils sont écrits. L’historique antérieur au démarrage n’est pas importé.</p><div className="privacy-options"><div><b>Source locale</b><small>{geminiSetup.available ? "Dossier Gemini détecté" : "Dossier Gemini absent pour l’instant"}<br /><code>{geminiSetup.sessions_dir}</code></small></div><label><input type="checkbox" checked={captureCommands} onChange={(event) => saveCapturePolicy(capturePrompts, event.target.checked)} /><span><b>Enregistrer les commandes transmises aux outils</b><small>Désactivé par défaut ; une commande peut contenir des secrets.</small></span></label><label><input type="checkbox" checked={capturePrompts} onChange={(event) => saveCapturePolicy(event.target.checked, captureCommands)} /><span><b>Enregistrer le texte de mes prompts</b><small>Désactivé par défaut ; peut contenir du code et des données privées.</small></span></label>{policyError && <p className="policy-error">{policyError}</p>}<small>Les sorties d’outils, réponses assistant et pensées ne sont jamais conservées. Seuls les champs opérationnels nécessaires à la timeline sont extraits.</small></div><div className="setup-note">Gemini CLI stocke séparément des fichiers par projet. Le SHA-256 du chemin du projet sert à rapprocher ces événements du dépôt sélectionné sans révéler ni transmettre ce chemin à Gemini.</div><div className="setup-actions"><button className="primary-button" onClick={() => setGeminiSetup(null)}>Terminé</button></div></section></div>}
      {opencodeSetup && <div className="setup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenCodeSetup(null); }}><section className="setup-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="opencode-setup-title"><button className="setup-close" onClick={() => setOpenCodeSetup(null)} aria-label="Fermer">×</button><div className="eyebrow">CONNECTEUR LOCAL · SQLITE EN LECTURE SEULE</div><h2 id="opencode-setup-title">OpenCode est observé localement</h2><p>RepoWatcher lit la base de sessions OpenCode en lecture seule. Aucun serveur n’est lancé et aucun réglage OpenCode n’est modifié. Seules les lignes ajoutées ou mises à jour après le lancement sont observées ; l’historique antérieur n’est pas importé.</p><div className="privacy-options"><div><b>Base détectée</b><small>{opencodeSetup.available ? "Base(s) SQLite trouvée(s)" : "Aucune base détectée pour l’instant"}<br /><code>{opencodeSetup.database_paths.join(" · ") || opencodeSetup.data_dir}</code></small></div><label><input type="checkbox" checked={captureCommands} onChange={(event) => saveCapturePolicy(capturePrompts, event.target.checked)} /><span><b>Enregistrer les commandes transmises aux outils</b><small>Désactivé par défaut ; une commande peut contenir des secrets.</small></span></label><label><input type="checkbox" checked={capturePrompts} onChange={(event) => saveCapturePolicy(event.target.checked, captureCommands)} /><span><b>Enregistrer le texte de mes prompts</b><small>Désactivé par défaut ; peut contenir du code et des données privées.</small></span></label>{policyError && <p className="policy-error">{policyError}</p>}<small>Les textes assistant, raisonnements, sorties et résultats d’outils sont ignorés. Les compteurs input/output ne sont conservés que s’ils figurent dans les enregistrements OpenCode.</small></div><div className="setup-note">OpenCode utilise SQLite avec journal WAL. Les sessions précédant le démarrage de RepoWatcher ne sont pas importées.</div><div className="setup-actions"><button className="primary-button" onClick={() => setOpenCodeSetup(null)}>Terminé</button></div></section></div>}
    </div>
  );
}

function NavButton({ icon, label, active = false, badge, onClick }: { icon: React.ReactNode; label: string; active?: boolean; badge?: string; onClick?: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} disabled={!onClick && !active} aria-current={active ? "page" : undefined}>{icon}<span>{label}</span>{badge && <small>{badge}</small>}</button>;
}

function ProviderMark({ provider, small = false }: { provider: Provider; small?: boolean }) {
  return <span className={`provider-mark ${small ? "small" : ""}`} style={{ "--provider-color": provider.color, "--provider-surface": provider.surface } as React.CSSProperties}>{provider.initials}</span>;
}

const raceProviderIds = ["claude_code", "codex", "opencode", "gemini", "cursor"];

function SprintTrack({ events, now, liveEventIds }: { events: SessionEvent[]; now: number; liveEventIds: Record<string, string> }) {
  const lanes = raceProviderIds
    .map((id) => providers.find((provider) => provider.id === id))
    .filter((provider): provider is Provider => Boolean(provider));
  const states = lanes.map((provider) => {
    // Event payloads carry the backend provider key, which differs from the UI id for Gemini.
    const raceKey = provider.id === "gemini" ? "gemini_cli" : provider.id;
    const state = deriveRaceState(raceKey, events, now);
    const isLiveEvent = Boolean(state.latest && liveEventIds[raceKey] === state.latest.event_id && now - Date.parse(state.latest.occurred_at) < 8_000);
    const activity = isLiveEvent && state.latest ? describeAgentAction(state.latest) : null;
    const cue: RaceLane["cue"] = state.latest?.kind === "tool_failed" ? "fall" : state.latest?.kind === "session_ended" || (state.latest?.kind === "checkpoint" && isTurnComplete(raceKey, state.latest)) ? "finish" : "leap";
    const statusText = state.status === "running" ? "EN COURSE" : state.status === "recent" ? "SIGNAL RÉCENT" : state.status === "finished" ? "À L’ARRIVÉE" : state.status === "idle" ? "AU REPOS" : "À L’ÉCOUTE";
    return { provider, state, isLiveEvent, cue, statusText, activity };
  });
  const running = states.filter(({ state }) => state.status === "running" || state.status === "recent").length;
  const [mode, setMode] = useState<"3d" | "2d">(() => (readStoredTrackMode() ?? (supportsWebGL() ? "3d" : "2d")));
  const reducedMotion = usePrefersReducedMotion();
  const lanes3d: RaceLane[] = states.map(({ provider, state, isLiveEvent, cue, activity }) => ({ id: provider.id, name: provider.name, color: provider.color, status: state.status, progress: state.progress, cue, cueKey: isLiveEvent && state.latest ? state.latest.event_id : null, activity }));
  function chooseMode(next: "3d" | "2d") {
    setMode(next);
    try { window.localStorage.setItem("repowatcher.sprint-track-mode", next); } catch { /* preference is optional */ }
  }

  return <section className={`sprint-panel mode-${mode}`} aria-label="Course en direct des agents">
    <div className="sprint-heading">
      <div><div className="sprint-kicker"><span className="sprint-live-dot" /> STADE DE TÉLÉMÉTRIE <span>·</span> 100 M</div><h1>La course des agents</h1><p>Chaque événement les fait bondir. Un échec les fait trébucher. Un tour terminé franchit la ligne.</p></div>
      <div className={`race-counter ${running ? "is-running" : ""}`}><span className="race-counter-lamps"><i /><i /><i /></span><b>{String(running).padStart(2, "0")}</b><small>{running > 1 ? "AGENTS EN MOUVEMENT" : running === 1 ? "AGENT EN MOUVEMENT" : "EN ATTENTE DU DÉPART"}</small></div>
    </div>
    <div className="track-mode" role="group" aria-label="Rendu de la piste"><button className={mode === "3d" ? "selected" : ""} onClick={() => chooseMode("3d")} aria-pressed={mode === "3d"}>3D</button><button className={mode === "2d" ? "selected" : ""} onClick={() => chooseMode("2d")} aria-pressed={mode === "2d"}>2D</button></div>
    {mode === "3d" ? <>
      <div className="sprint-stage"><Suspense fallback={<div className="sprint-stage-loading">Chargement du stade…</div>}><SprintTrack3D lanes={lanes3d} reducedMotion={reducedMotion} /></Suspense></div>
      <div className="sprint-legend">{states.map(({ provider, state, statusText }) => <div className={`sprint-legend-item ${state.status}`} key={provider.id} style={{ "--runner-color": provider.color } as CSSProperties}><ProviderMark provider={provider} small /><span>{provider.name}</span><small>{statusText}</small><b>{state.progress} m</b></div>)}</div>
    </> : <>
    <div className="track-axis" aria-hidden="true"><span>DÉPART</span><i>25 M</i><i>50 M</i><i>75 M</i><b>ARRIVÉE</b></div>
    <div className="sprint-lanes">
      {states.map(({ provider, state, isLiveEvent, cue, statusText, activity }, laneIndex) => {
        const style = { "--runner-color": provider.color, "--lane-delay": `${laneIndex * 70}ms`, "--runner-progress": `${state.progress}%` } as CSSProperties;
        return <div className={`sprint-lane ${state.status}`} key={provider.id} style={style}>
          <div className="lane-identity"><ProviderMark provider={provider} small /><span>{provider.name}</span><small>{statusText}</small></div>
          <div className="lane-track">
            <div className="lane-markers" aria-hidden="true"><i /><i /><i /><i /><i /></div>
            <div className="lane-start" aria-hidden="true" />
            <div className="lane-finish" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
            {state.latest ? <div className={`runner-sprite ${cue} ${isLiveEvent ? "is-new-event" : ""} ${state.status === "running" || state.status === "recent" ? "is-moving" : ""}`} key={state.latest.event_id} title={`${provider.name} · ${state.latest.kind.replaceAll("_", " ")}`}>
              {activity && <span className="runner-speech" role="status">{activity}</span>}
              <svg className="runner-figure" viewBox="0 0 58 52" role="img" aria-label={`${provider.name}, ${state.latest.kind.replaceAll("_", " ")}`}>
                <g className="runner-trails"><path d="M3 17h13M0 24h12M6 31h10" /></g>
                <g className="runner-body"><circle className="runner-head" cx="37" cy="8" r="5" /><path className="runner-torso" d="M34 15l-7 13 9 5 7-14" /><path className="runner-arm arm-back" d="M31 18l-11 5-5-6" /><path className="runner-arm arm-front" d="M38 18l9 3 5-6" /><path className="runner-leg leg-back" d="M29 31l-10 8-8 1" /><path className="runner-leg leg-front" d="M35 32l7 8 9 2" /></g>
                <path className="runner-ground" d="M2 47h52" />
              </svg>
              <span className="runner-event-flash" />
            </div> : <div className="lane-empty-runner" aria-hidden="true"><span /></div>}
            <span className="lane-distance" aria-hidden="true">{state.progress} m</span>
          </div>
        </div>;
      })}
    </div>
    </>}
    <div className="sprint-footnote"><span><i className="footnote-leap" /> saut = nouvel événement</span><span><i className="footnote-fall" /> chute = échec observé</span><span>Distance visuelle = signaux reçus, pas un % d’avancement du modèle.</span></div>
  </section>;
}

function readStoredTrackMode(): "3d" | "2d" | null {
  try {
    const stored = window.localStorage.getItem("repowatcher.sprint-track-mode");
    return stored === "3d" || stored === "2d" ? stored : null;
  } catch {
    return null;
  }
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function ProviderRow({ provider }: { provider: Provider }) {
  return <div className="provider-row"><ProviderMark provider={provider} small /><span>{provider.name}</span><span className="provider-unconfigured" title="Connecteur non configuré" /></div>;
}

function ProviderCard({ provider, active = false, onClick, label }: { provider: Provider; active?: boolean; onClick?: () => void; label?: string }) {
  return <div className={`connector-card ${active ? "configured" : ""}`}><ProviderMark provider={provider} /><span className="connector-name">{provider.name}{label && <small className="connector-scope">{label}</small>}</span>{onClick ? <button className="connector-action" onClick={onClick}>Configurer</button> : <span className="connector-state">Prévu</span>}{active && <span className="provider-ready" aria-label="Connecteur disponible" />}</div>;
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note"><span className={`note-dot ${tone}`} />{note}</div><div className={`metric-glow ${tone}`} /></div>;
}

function ActivityChart({ events, now }: { events: SessionEvent[]; now: number }) {
  const activity = Array.from({ length: 30 }, () => 0);
  const input = Array.from({ length: 30 }, () => 0);
  const output = Array.from({ length: 30 }, () => 0);
  for (const event of events) {
    const age = now - new Date(event.occurred_at).getTime();
    if (age >= 0 && age < 60 * 60 * 1000) {
      const index = 29 - Math.floor(age / (2 * 60 * 1000));
      activity[index]++;
      input[index] += event.input_tokens?.value || 0;
      output[index] += event.output_tokens?.value || 0;
    }
  }
  const points = (values: number[], scale = Math.max(1, ...values)) => {
    const max = scale;
    return values.map((value, index) => `${index * 20},${74 - value / max * 58}`).join(" ");
  };
  const tokenScale = Math.max(1, ...input, ...output);
  return <div className="activity-chart" aria-label="Événements et tokens par tranche de deux minutes, dernière heure"><div className="chart-caption"><span>Événements / 2 min</span><span>60 dernières minutes</span></div><svg viewBox="0 0 580 88" preserveAspectRatio="none" role="img" aria-label="Événements observés"><line x1="0" y1="74" x2="580" y2="74" /><line x1="0" y1="45" x2="580" y2="45" /><line x1="0" y1="16" x2="580" y2="16" /><polyline className="event-line" points={points(activity)} /></svg>{(input.some(Boolean) || output.some(Boolean)) && <><div className="chart-caption token-chart-caption"><span>Tokens provider / 2 min</span><span>maximum par tranche sur 60 min</span></div><svg viewBox="0 0 580 88" preserveAspectRatio="none" role="img" aria-label="Input et output tokens observés, échelle commune"><line x1="0" y1="74" x2="580" y2="74" /><line x1="0" y1="45" x2="580" y2="45" /><line x1="0" y1="16" x2="580" y2="16" /><polyline className="input-line" points={points(input, tokenScale)} /><polyline className="output-line" points={points(output, tokenScale)} /></svg><div className="chart-legend"><span className="input-legend">Input</span><span className="output-legend">Output</span></div></>}</div>;
}

function RepositoryMap({ snapshot, events }: { snapshot: RepositorySnapshot; events: SessionEvent[] }) {
  const observed = new Map<string, number>();
  const root = snapshot.root.replaceAll("\\", "/").replace(/\/$/, "");
  for (const event of events) {
    if (!event.file_path) continue;
    const project = event.project_path?.replaceAll("\\", "/").replace(/\/$/, "");
    const samePath = project?.toLowerCase() === root.toLowerCase();
    const sameGeminiProject = event.provider === "gemini_cli" && event.project_hash === snapshot.project_hash;
    if (!samePath && !sameGeminiProject) continue;
    let key = event.file_path.replaceAll("\\", "/");
    if (key.toLowerCase().startsWith(`${root.toLowerCase()}/`)) key = key.slice(root.length + 1);
    observed.set(key, (observed.get(key) || 0) + 1);
  }
  const rows = new Map<string, { status: string; count: number }>();
  snapshot.changed_files.forEach((file) => rows.set(file.path.replaceAll("\\", "/"), { status: file.status, count: observed.get(file.path.replaceAll("\\", "/")) || 0 }));
  observed.forEach((count, path) => { if (!rows.has(path)) rows.set(path, { status: "observé", count }); });
  return <div className="repo-map"><div className="repo-map-meta"><span>Branche <b>{snapshot.branch || "HEAD détachée"}</b></span><span>{snapshot.changed_files.length} changements non commités · actualisé toutes les 5 s</span></div>{rows.size ? [...rows.entries()].map(([path, info]) => <div className="repo-map-row" key={path}><span className="repo-tree">└─</span><code>{path}</code><span>{info.count ? `${info.count} événements observés` : info.status}</span></div>) : <div className="repo-map-empty">Aucun fichier modifié ou observé pour l’instant.</div>}<div className="repo-commits">{snapshot.recent_commits.map((commit) => <div key={commit.short_id}><code>{commit.short_id}</code> {commit.subject} <span>{commit.relative_time}</span></div>)}</div><small>Git status et événements observés sont présentés séparément ; aucun lien causal n’est supposé.</small></div>;
}

function EventPayload({ event }: { event: SessionEvent }) {
  return <details className="event-payload"><summary>Journal complet</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>;
}

function SessionExplorer({ events, onConnect, onConnectCodex, onConnectGemini, onConnectOpenCode, onClear, onLoadOlder, hasMore, loadingOlder, onExport, notice }: { events: SessionEvent[]; onConnect: () => void; onConnectCodex: () => void; onConnectGemini: () => void; onConnectOpenCode: () => void; onClear: () => void; onLoadOlder: () => void; hasMore: boolean; loadingOlder: boolean; onExport: () => void; notice: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const sessions = useMemo(() => {
    const grouped = new Map<string, SessionEvent[]>();
    for (const event of events) {
      const key = `${event.provider}:${event.session_id}`;
      grouped.set(key, [...(grouped.get(key) || []), event]);
    }
    return [...grouped.entries()].sort((a, b) => b[1][0].occurred_at.localeCompare(a[1][0].occurred_at));
  }, [events]);
  const selectedSession = selected && sessions.some(([id]) => id === selected) ? selected : sessions[0]?.[0];
  const timeline = sessions.find(([id]) => id === selectedSession)?.[1] || [];
  return <section className="secondary-view"><div className="secondary-heading"><div><div className="eyebrow">HISTORIQUE LOCAL</div><h1>Sessions observées</h1><p>{sessions.length} session{sessions.length === 1 ? "" : "s"} enregistrée{sessions.length === 1 ? "" : "s"} dans la base locale · {events.length.toLocaleString("fr-FR")} événements chargés</p>{notice && <small className="session-disclosure">{notice}</small>}</div><div className="session-toolbar"><button className="outline-button" onClick={onConnect}><TerminalSquare size={15} /> Configuration Claude Code</button><button className="outline-button" onClick={onConnectCodex}>Codex local</button><button className="outline-button" onClick={onConnectGemini}>Gemini CLI local</button><button className="outline-button" onClick={onConnectOpenCode}>OpenCode local</button><button className="outline-button" onClick={onExport}><ArrowDownToLine size={15} /> Export JSON complet</button>{hasMore && <button className="outline-button" onClick={onLoadOlder} disabled={loadingOlder}><ArrowDownToLine size={15} /> {loadingOlder ? "Chargement…" : "Événements plus anciens"}</button>}{sessions.length > 0 && <button className="danger-button" onClick={onClear}>Effacer l’historique</button>}</div></div>{sessions.length ? <div className="session-explorer"><div className="session-list">{sessions.map(([id, items]) => <button key={id} className={`session-list-item ${id === selectedSession ? "selected" : ""}`} onClick={() => setSelected(id)}><b>{items[0].session_id}</b><span>{items[0].project_path || "Dépôt non renseigné"}</span><small>{items[0].provider} · {items.length} événements · {new Date(items[0].occurred_at).toLocaleString()}</small></button>)}</div><div className="session-detail"><div className="session-detail-heading"><div><h2>Chronologie</h2><p>Identifiant {timeline[0]?.session_id}</p></div><span className="count-badge">{timeline.length} événements</span></div>{timeline.map((event) => <div className="session-event" key={event.event_id}><time>{new Date(event.occurred_at).toLocaleTimeString()}</time><span className="event-kind">{event.provider} · {event.kind.replaceAll("_", " ")}</span><span>{event.command || event.content || event.tool_name || event.file_path || event.project_path || "—"}{(event.input_tokens || event.output_tokens) && <small className="token-source">{event.model?.value || "Modèle non fourni"} · {formatCount(event.input_tokens?.value || 0)} in / {formatCount(event.output_tokens?.value || 0)} out</small>}</span><EventPayload event={event} /></div>)}<div className="session-disclosure">Les compteurs représentent uniquement les champs fournis par le connecteur. Codex indique les dernières requêtes, Gemini et OpenCode les métriques présentes dans les journaux locaux ; Claude n’expose ici que certains usages de sous-agents.</div></div></div> : <div className="panel secondary-empty"><div className="empty-core"><Bot size={22} /></div><h2>Aucune session enregistrée</h2><p>Les nouvelles sessions seront enregistrées localement. Configure un hook Claude Code, ou active la détection des journaux Codex, Gemini CLI et OpenCode.</p><div className="session-toolbar"><button className="primary-button" onClick={onConnect}>Configurer Claude Code</button><button className="outline-button" onClick={onConnectCodex}>Voir le connecteur Codex</button><button className="outline-button" onClick={onConnectGemini}>Voir Gemini CLI</button><button className="outline-button" onClick={onConnectOpenCode}>Voir OpenCode</button></div></div>}</section>;
}

function formatCount(value: number) { return new Intl.NumberFormat("fr-FR").format(value); }
function sessionKey(event: SessionEvent) { return `${event.provider}:${event.session_id}`; }
function compareEventsNewestFirst(a: SessionEvent, b: SessionEvent) {
  return b.occurred_at.localeCompare(a.occurred_at) || b.event_id.localeCompare(a.event_id);
}
