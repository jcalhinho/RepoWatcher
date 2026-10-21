import type { RepositorySnapshot, SessionEvent } from "./types";
import { t } from "./i18n";

/** `git status --porcelain` codes in plain words. */
function gitState(code: string) {
  if (code === "??") return "nouveau, pas encore suivi";
  if (code.includes("U")) return "en conflit";
  if (code.includes("A")) return t("ajouté", "added");
  if (code.includes("D")) return t("supprimé", "deleted");
  if (code.includes("R")) return t("renommé", "renamed");
  if (code.includes("M")) return t("modifié", "modified");
  return code || t("modifié", "modified");
}

/**
 * Files Git reports as changed next to files the agents touched (events are already scoped to this
 * repository), then the latest commits. Both are shown side by side: no change is attributed.
 */
export function RepositoryMap({ snapshot, events }: { snapshot: RepositorySnapshot; events: SessionEvent[] }) {
  const root = snapshot.root.replaceAll("\\", "/").replace(/\/$/, "");
  const touched = new Map<string, number>();
  for (const event of events) {
    if (!event.file_path) continue;
    let path = event.file_path.replaceAll("\\", "/");
    if (path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) path = path.slice(root.length + 1);
    touched.set(path, (touched.get(path) ?? 0) + 1);
  }
  const rows = new Map<string, { git: string | null; agentEvents: number }>();
  for (const file of snapshot.changed_files) {
    const path = file.path.replaceAll("\\", "/");
    rows.set(path, { git: gitState(file.status), agentEvents: touched.get(path) ?? 0 });
  }
  touched.forEach((count, path) => { if (!rows.has(path)) rows.set(path, { git: null, agentEvents: count }); });
  const sorted = [...rows.entries()].sort((a, b) => Number(b[1].git !== null) - Number(a[1].git !== null) || b[1].agentEvents - a[1].agentEvents || a[0].localeCompare(b[0]));

  return <div className="repo-detail">
    <p className="repo-detail-meta">{t("Branche", "Branch")} <b className="mono">{snapshot.branch ?? t("HEAD détachée", "detached HEAD")}</b>
      {snapshot.ahead !== null && snapshot.behind !== null && <> · {t(`${snapshot.ahead} commit${snapshot.ahead > 1 ? "s" : ""} à envoyer, ${snapshot.behind} à récupérer`, `${snapshot.ahead} commit${snapshot.ahead === 1 ? "" : "s"} to push, ${snapshot.behind} to pull`)}</>}
      {" · "}{t(`${snapshot.changed_files.length} fichier${snapshot.changed_files.length > 1 ? "s" : ""} non commité${snapshot.changed_files.length > 1 ? "s" : ""}`, `${snapshot.changed_files.length} uncommitted file${snapshot.changed_files.length === 1 ? "" : "s"}`)}</p>
    {sorted.length ? <div className="table-scroll"><table className="file-table">
      <thead><tr><th scope="col">{t("Fichier", "File")}</th><th scope="col">{t("Selon Git", "According to Git")}</th><th scope="col">{t("Activité des agents", "Agent activity")}</th></tr></thead>
      <tbody>{sorted.map(([path, row]) => <tr key={path}>
        <th scope="row" className="mono">{path}</th>
        <td className={row.git ? "text-warn" : "text-muted"}>{row.git ?? t("inchangé", "unchanged")}</td>
        <td className={row.agentEvents ? "" : "text-muted"}>{row.agentEvents ? t(`${row.agentEvents} événement${row.agentEvents > 1 ? "s" : ""}`, `${row.agentEvents} event${row.agentEvents === 1 ? "" : "s"}`) : t("aucune", "none")}</td>
      </tr>)}</tbody>
    </table></div> : <p className="text-muted">{t("Aucun fichier modifié ni touché par un agent pour l’instant.", "No file changed or touched by an agent yet.")}</p>}
    {snapshot.recent_commits.length > 0 && <>
      <h4>{t("Derniers commits", "Latest commits")}</h4>
      <ul className="commit-list">{snapshot.recent_commits.map((commit) => <li key={commit.short_id}><code>{commit.short_id}</code><span>{commit.subject}</span><time>{commit.relative_time}</time></li>)}</ul>
    </>}
  </div>;
}
