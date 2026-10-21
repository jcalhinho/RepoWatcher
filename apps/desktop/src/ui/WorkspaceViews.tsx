import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, FileCode2, FolderGit2, FolderOpen, Map as MapIcon, X } from "lucide-react";
import { ProviderMark } from "./ProviderBadges";
import { providers } from "./providers";
import type { SessionEvent } from "./types";
import { pathKey, type RepositoryFilter, type WorkspaceRepository } from "./workspace";
import type { WorkspaceModel } from "./useWorkspace";

const ACTIVE_MS = 2 * 60_000;
const providerByKey = new Map(providers.map((provider) => [provider.eventKey, provider]));

function since(at: number | null) {
  if (at === null) return "—";
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
}

/** Per-repository activity derived from the loaded events. */
export type RepositoryActivity = { events: number; lastAt: number | null; activeAgents: string[]; agents: string[]; files: number };

export function useRepositoryActivity(events: SessionEvent[], model: WorkspaceModel) {
  return useMemo(() => {
    const now = Date.now();
    const byRepository = new Map<string, RepositoryActivity & { fileSet: Set<string>; agentSet: Set<string>; activeSet: Set<string> }>();
    let outside = 0;
    for (const event of events) {
      const repository = model.repositoryOf(event);
      if (!repository) {
        outside += 1;
        continue;
      }
      const key = pathKey(repository.path);
      const entry = byRepository.get(key) ?? { events: 0, lastAt: null, activeAgents: [], agents: [], files: 0, fileSet: new Set(), agentSet: new Set(), activeSet: new Set() };
      const at = Date.parse(event.occurred_at);
      entry.events += 1;
      entry.lastAt = Math.max(entry.lastAt ?? 0, at);
      entry.agentSet.add(event.provider);
      if (now - at < ACTIVE_MS) entry.activeSet.add(event.provider);
      if (event.file_path) entry.fileSet.add(event.file_path);
      byRepository.set(key, entry);
    }
    const activity = new Map<string, RepositoryActivity>();
    byRepository.forEach((entry, key) => activity.set(key, { events: entry.events, lastAt: entry.lastAt, activeAgents: [...entry.activeSet], agents: [...entry.agentSet], files: entry.fileSet.size }));
    return { activity, outside };
  }, [events, model.repositoryOf]);
}

export function WorkspaceSwitcher({ model }: { model: WorkspaceModel }) {
  const [menu, setMenu] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  async function chooseFolder() {
    setMenu(false);
    const selected = await open({ directory: true, multiple: false, title: "Choisir le dossier du workspace (ou un dépôt)" });
    if (typeof selected === "string") model.setSource(selected);
  }

  async function chooseFile() {
    setMenu(false);
    const selected = await open({ directory: false, multiple: false, title: "Ouvrir un workspace VS Code", filters: [{ name: "Workspace VS Code", extensions: ["code-workspace"] }] });
    if (typeof selected === "string") model.setSource(selected);
  }

  const count = model.repositories.length;
  const title = model.workspace ? model.workspace.label : model.source ? "Workspace introuvable" : "Aucun workspace";
  const subtitle = model.workspace ? `${count} dépôt${count > 1 ? "s" : ""} · ${model.workspace.source === "code-workspace" ? "fichier .code-workspace" : "dossier"}` : model.error ?? "Choisir un dossier ou un .code-workspace";
  return <div className="workspace-picker" ref={container}>
    <button className="workspace-switcher top-repository" onClick={() => setMenu((value) => !value)} aria-expanded={menu} aria-haspopup="menu" title={model.source ?? undefined}>
      <span className="workspace-icon"><FolderGit2 size={16} /></span>
      <span className="workspace-copy"><b>{title}</b><small>{subtitle}</small></span>
      <ChevronDown size={14} className="muted" />
    </button>
    {menu && <div className="workspace-menu" role="menu">
      <button role="menuitem" onClick={chooseFolder}><FolderOpen size={15} /><span><b>Choisir un dossier</b><small>Tous les dépôts Git qu’il contient (4 niveaux)</small></span></button>
      <button role="menuitem" onClick={chooseFile}><FileCode2 size={15} /><span><b>Ouvrir un .code-workspace</b><small>Les dossiers listés par VS Code</small></span></button>
      {model.source && <button role="menuitem" onClick={() => { setMenu(false); model.setSource(null); }}><X size={15} /><span><b>Fermer le workspace</b><small>{model.source}</small></span></button>}
    </div>}
  </div>;
}

/** One row of chips above the dashboard: every repository, one repository, or events outside the workspace. */
export function RepositoryFilterBar({ model, filter, onFilter, activity, outside, total }: { model: WorkspaceModel; filter: RepositoryFilter; onFilter: (filter: RepositoryFilter) => void; activity: Map<string, RepositoryActivity>; outside: number; total: number }) {
  if (!model.repositories.length) return null;
  const ordered = [...model.repositories].sort((a, b) => (activity.get(pathKey(b.path))?.lastAt ?? 0) - (activity.get(pathKey(a.path))?.lastAt ?? 0) || a.name.localeCompare(b.name));
  const chip = (key: RepositoryFilter, label: string, count: number, repository?: WorkspaceRepository) => {
    const info = repository ? activity.get(pathKey(repository.path)) : undefined;
    const selected = filter === key || (repository && filter !== "all" && filter !== "outside" && pathKey(filter) === pathKey(repository.path));
    return <button key={key} className={`repo-chip ${selected ? "selected" : ""} ${info?.activeAgents.length ? "active" : ""}`} aria-pressed={Boolean(selected)} onClick={() => onFilter(key)} title={repository?.path}>
      {info?.activeAgents.length ? <i className="repo-chip-live" /> : null}{label}<small>{count}</small>
    </button>;
  };
  return <nav className="repo-filter" aria-label="Filtrer par dépôt">
    {chip("all", "Tous les dépôts", total)}
    {ordered.map((repository) => chip(repository.path, repository.name, activity.get(pathKey(repository.path))?.events ?? 0, repository))}
    {outside > 0 && chip("outside", "Hors workspace", outside)}
  </nav>;
}

export function WorkspacePanel({ model, activity, onFilter, onOpenMap }: { model: WorkspaceModel; activity: Map<string, RepositoryActivity>; onFilter: (filter: RepositoryFilter) => void; onOpenMap: (repository: WorkspaceRepository) => void }) {
  const rows = useMemo(() => [...model.repositories].map((repository) => ({ repository, info: activity.get(pathKey(repository.path)), state: model.states[repository.path] }))
    .sort((a, b) => (b.info?.activeAgents.length ?? 0) - (a.info?.activeAgents.length ?? 0) || (b.info?.lastAt ?? 0) - (a.info?.lastAt ?? 0) || (b.state?.snapshot?.changed_files.length ?? 0) - (a.state?.snapshot?.changed_files.length ?? 0) || a.repository.name.localeCompare(b.repository.name)), [model.repositories, model.states, activity]);
  const dirty = rows.filter((row) => row.state?.snapshot?.changed_files.length).length;
  return <section className="panel workspace-panel" aria-labelledby="workspace-panel-title">
    <div className="panel-heading compact"><div><div className="panel-title-row"><h2 id="workspace-panel-title">Dépôts du workspace</h2>{model.workspace && <span className="count-badge">{model.repositories.length} dépôts · {dirty} avec changements</span>}</div><p>{model.workspace ? model.workspace.path : "Choisis un dossier ou un fichier .code-workspace en haut à gauche pour suivre tous ses dépôts."}</p></div></div>
    {model.workspace?.missing_folders.length ? <div className="workspace-warning">Dossiers du workspace introuvables : {model.workspace.missing_folders.join(" · ")}</div> : null}
    {rows.length ? <div className="workspace-table" role="table" aria-label="État Git et activité des agents par dépôt">
      <div className="workspace-row head" role="row"><span role="columnheader">Dépôt</span><span role="columnheader">Branche</span><span role="columnheader" title="Commits en avance / en retard sur la branche distante">↑ / ↓</span><span role="columnheader">Non commités</span><span role="columnheader">Agents</span><span role="columnheader">Fichiers vus</span><span role="columnheader">Dernière activité</span><span role="columnheader" /></div>
      {rows.map(({ repository, info, state }) => {
        const snapshot = state?.snapshot;
        const changed = snapshot?.changed_files.length ?? null;
        return <div className={`workspace-row ${info?.activeAgents.length ? "active" : ""}`} role="row" key={repository.path}>
          <span role="cell" className="workspace-repo" title={repository.path}><b>{repository.name}</b><small>{repository.path}</small></span>
          <span role="cell" className="workspace-branch">{state?.error ? <em title={state.error}>Git indisponible</em> : snapshot ? snapshot.branch ?? "HEAD détachée" : "…"}</span>
          <span role="cell" className="workspace-sync">{snapshot && snapshot.ahead !== null && snapshot.behind !== null ? <><b className={snapshot.ahead ? "ahead" : ""}>↑{snapshot.ahead}</b> <b className={snapshot.behind ? "behind" : ""}>↓{snapshot.behind}</b></> : <small>sans amont</small>}</span>
          <span role="cell" className={`workspace-changes ${changed ? "dirty" : ""}`}>{changed === null ? "—" : changed}</span>
          <span role="cell" className="workspace-agents">{info?.agents.length ? info.agents.map((key) => { const provider = providerByKey.get(key); return provider ? <span key={key} className={info.activeAgents.includes(key) ? "live" : ""} style={{ "--agent-color": provider.color } as CSSProperties} title={`${provider.name}${info.activeAgents.includes(key) ? " · actif" : ""}`}><ProviderMark provider={provider} small /></span> : null; }) : <small>aucun</small>}</span>
          <span role="cell">{info?.files ?? 0}</span>
          <span role="cell" className="workspace-last">{since(info?.lastAt ?? null)}</span>
          <span role="cell" className="workspace-actions"><button onClick={() => onFilter(repository.path)} title="Filtrer le tableau de bord sur ce dépôt">Filtrer</button><button onClick={() => onOpenMap(repository)} title="Carte Git du dépôt"><MapIcon size={13} /></button></span>
        </div>;
      })}
    </div> : model.workspace ? <div className="repo-empty"><span>Aucun dépôt Git trouvé dans ce workspace.</span></div> : null}
    <small className="workspace-footnote">L’état Git et l’activité des agents sont affichés côte à côte ; un changement n’est jamais attribué à un agent sans preuve. Dépôts actifs rafraîchis toutes les 5 s, les autres chaque minute.</small>
  </section>;
}
