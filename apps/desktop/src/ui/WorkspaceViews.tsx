import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { t } from "./i18n";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, FileCode2, FolderGit2, FolderOpen, X } from "lucide-react";
import { since } from "./AgentCard";
import { InfoTip } from "./Explain";
import { ProviderMark } from "./ProviderBadges";
import { providerFor } from "./providers";
import type { SessionEvent } from "./types";
import { pathKey, type RepositoryFilter, type WorkspaceRepository } from "./workspace";
import type { WorkspaceModel } from "./useWorkspace";

const ACTIVE_MS = 2 * 60_000;


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
    const selected = await open({ directory: true, multiple: false, title: t("Choisir le dossier du workspace (ou un dépôt)", "Pick the workspace folder (or a repository)") });
    if (typeof selected === "string") model.setSource(selected);
  }

  async function chooseFile() {
    setMenu(false);
    const selected = await open({ directory: false, multiple: false, title: t("Ouvrir un workspace VS Code", "Open a VS Code workspace"), filters: [{ name: "VS Code workspace", extensions: ["code-workspace"] }] });
    if (typeof selected === "string") model.setSource(selected);
  }

  const count = model.repositories.length;
  const title = model.workspace ? model.workspace.label : model.source ? t("Workspace introuvable", "Workspace not found") : t("Aucun workspace", "No workspace");
  const subtitle = model.workspace ? t(`${count} dépôt${count > 1 ? "s" : ""} · ${model.workspace.source === "code-workspace" ? "fichier .code-workspace" : "dossier"}`, `${count} repositor${count === 1 ? "y" : "ies"} · ${model.workspace.source === "code-workspace" ? ".code-workspace file" : "folder"}`) : model.error ?? t("Choisir un dossier ou un .code-workspace", "Pick a folder or a .code-workspace");
  return <div className="workspace-picker" ref={container}>
    <button className="workspace-switcher" onClick={() => setMenu((value) => !value)} aria-expanded={menu} aria-haspopup="menu" title={model.source ?? undefined}>
      <span className="workspace-icon"><FolderGit2 size={16} /></span>
      <span className="workspace-copy"><b>{title}</b><small>{subtitle}</small></span>
      <ChevronDown size={14} className="muted" />
    </button>
    {menu && <div className="workspace-menu" role="menu">
      <button role="menuitem" onClick={chooseFolder}><FolderOpen size={15} /><span><b>{t("Choisir un dossier", "Pick a folder")}</b><small>{t("Tous les dépôts Git qu’il contient (4 niveaux)", "Every Git repository inside it (4 levels)")}</small></span></button>
      <button role="menuitem" onClick={chooseFile}><FileCode2 size={15} /><span><b>{t("Ouvrir un .code-workspace", "Open a .code-workspace")}</b><small>{t("Les dossiers listés par VS Code", "The folders listed by VS Code")}</small></span></button>
      {model.source && <button role="menuitem" onClick={() => { setMenu(false); model.setSource(null); }}><X size={15} /><span><b>{t("Fermer le workspace", "Close the workspace")}</b><small>{model.source}</small></span></button>}
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
    return <button key={key} className="chip" aria-pressed={Boolean(selected)} onClick={() => onFilter(key)} title={repository?.path}>
      {info?.activeAgents.length ? <i className="live-dot" title={t("Un agent travaille ici en ce moment", "An agent is working here right now")} /> : null}{label}<small>{count}</small>
    </button>;
  };
  return <nav className="repo-filter" aria-label={t("Filtrer par dépôt", "Filter by repository")}>
    <span className="repo-filter-label">{t("Afficher", "Show")}<InfoTip label={t("À quoi sert ce filtre ?", "What is this filter for?")}>{t("Limite la course, l’analyse et le fil d’activité à un seul dépôt. Le chiffre indique le nombre d’événements de la période ; le point vert, un agent actif en ce moment. « Hors workspace » regroupe l’activité dans des dossiers qui ne font pas partie du workspace.", "Limits the race, analytics and activity feed to one repository. The number is the period’s event count; the green dot, an agent active right now. “Outside workspace” groups activity in folders that are not part of the workspace.")}</InfoTip></span>
    {chip("all", t("Tous les dépôts", "All repositories"), total)}
    {ordered.map((repository) => chip(repository.path, repository.name, activity.get(pathKey(repository.path))?.events ?? 0, repository))}
    {outside > 0 && chip("outside", t("Hors workspace", "Outside workspace"), outside)}
  </nav>;
}

/** Git state and agent activity of every repository in the workspace, side by side. */
export function RepositoryTable({ model, activity, selected, onSelect, onFilter }: { model: WorkspaceModel; activity: Map<string, RepositoryActivity>; selected: string | null; onSelect: (repository: WorkspaceRepository) => void; onFilter: (filter: RepositoryFilter) => void }) {
  const rows = useMemo(() => [...model.repositories].map((repository) => ({ repository, info: activity.get(pathKey(repository.path)), state: model.states[repository.path] }))
    .sort((a, b) => (b.info?.activeAgents.length ?? 0) - (a.info?.activeAgents.length ?? 0) || (b.info?.lastAt ?? 0) - (a.info?.lastAt ?? 0) || (b.state?.snapshot?.changed_files.length ?? 0) - (a.state?.snapshot?.changed_files.length ?? 0) || a.repository.name.localeCompare(b.repository.name)), [model.repositories, model.states, activity]);
  if (!rows.length) return null;
  return <div className="table-scroll"><table className="repo-table">
    <thead><tr>
      <th scope="col">{t("Dépôt", "Repository")}</th>
      <th scope="col">{t("Branche", "Branch")}</th>
      <th scope="col"><abbr title={t("Commits pas encore envoyés (↑) / pas encore récupérés (↓) par rapport à la branche distante", "Commits not yet pushed (↑) / pulled (↓) relative to the remote branch")}>{t("À synchroniser", "To sync")}</abbr></th>
      <th scope="col"><abbr title={t("Fichiers modifiés et pas encore enregistrés dans un commit", "Files changed and not yet committed")}>{t("Non commités", "Uncommitted")}</abbr></th>
      <th scope="col">Agents</th>
      <th scope="col">{t("Dernière activité", "Last activity")}</th>
      <th scope="col"><span className="sr-only">Actions</span></th>
    </tr></thead>
    <tbody>{rows.map(({ repository, info, state }) => {
      const snapshot = state?.snapshot;
      const changed = snapshot?.changed_files.length ?? null;
      const isSelected = selected !== null && pathKey(selected) === pathKey(repository.path);
      return <tr key={repository.path} className={`${info?.activeAgents.length ? "active" : ""} ${isSelected ? "selected" : ""}`} onClick={() => onSelect(repository)}>
        <th scope="row"><b>{repository.name}</b><small title={repository.path}>{repository.path}</small></th>
        <td className="mono">{state?.error ? <span className="text-bad" title={state.error}>{t("Git indisponible", "Git unavailable")}</span> : snapshot ? snapshot.branch ?? t("HEAD détachée", "detached HEAD") : "…"}</td>
        <td className="mono">{snapshot && snapshot.ahead !== null && snapshot.behind !== null ? (snapshot.ahead || snapshot.behind ? <><span className={snapshot.ahead ? "text-accent" : ""}>↑{snapshot.ahead}</span> <span className={snapshot.behind ? "text-warn" : ""}>↓{snapshot.behind}</span></> : <span className="text-muted">{t("à jour", "up to date")}</span>) : <span className="text-muted" title={t("Aucune branche distante associée", "No remote branch")}>—</span>}</td>
        <td className={changed ? "text-warn strong" : "text-muted"}>{changed === null ? "…" : changed || t("aucun", "none")}</td>
        <td><span className="agent-marks">{info?.agents.length ? info.agents.map((key) => { const provider = providerFor(key); return provider ? <span key={key} className={info.activeAgents.includes(key) ? "live" : ""} style={{ "--agent-color": provider.color } as CSSProperties} title={`${provider.name}${info.activeAgents.includes(key) ? t(" · actif en ce moment", " · active right now") : ""}`}><ProviderMark provider={provider} small /></span> : null; }) : <span className="text-muted">{t("aucun", "none")}</span>}</span></td>
        <td className="text-muted">{since(info?.lastAt ?? null, Date.now())}</td>
        <td><button className="button small" onClick={(event) => { event.stopPropagation(); onFilter(repository.path); }} title={t("Afficher seulement l’activité de ce dépôt dans la vue d’ensemble", "Show only this repository’s activity in the overview")}>{t("Filtrer la vue", "Filter the view")}</button></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
