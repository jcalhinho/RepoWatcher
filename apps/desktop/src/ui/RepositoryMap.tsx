import type { RepositorySnapshot, SessionEvent } from "./types";

/** `git status --porcelain` codes in plain words. */
function gitState(code: string) {
  if (code === "??") return "nouveau, pas encore suivi";
  if (code.includes("U")) return "en conflit";
  if (code.includes("A")) return "ajouté";
  if (code.includes("D")) return "supprimé";
  if (code.includes("R")) return "renommé";
  if (code.includes("M")) return "modifié";
  return code || "modifié";
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
    <p className="repo-detail-meta">Branche <b className="mono">{snapshot.branch ?? "HEAD détachée"}</b>
      {snapshot.ahead !== null && snapshot.behind !== null && <> · {snapshot.ahead} commit{snapshot.ahead > 1 ? "s" : ""} à envoyer, {snapshot.behind} à récupérer</>}
      {" · "}{snapshot.changed_files.length} fichier{snapshot.changed_files.length > 1 ? "s" : ""} non commité{snapshot.changed_files.length > 1 ? "s" : ""}</p>
    {sorted.length ? <div className="table-scroll"><table className="file-table">
      <thead><tr><th scope="col">Fichier</th><th scope="col">Selon Git</th><th scope="col">Activité des agents</th></tr></thead>
      <tbody>{sorted.map(([path, row]) => <tr key={path}>
        <th scope="row" className="mono">{path}</th>
        <td className={row.git ? "text-warn" : "text-muted"}>{row.git ?? "inchangé"}</td>
        <td className={row.agentEvents ? "" : "text-muted"}>{row.agentEvents ? `${row.agentEvents} événement${row.agentEvents > 1 ? "s" : ""}` : "aucune"}</td>
      </tr>)}</tbody>
    </table></div> : <p className="text-muted">Aucun fichier modifié ni touché par un agent pour l’instant.</p>}
    {snapshot.recent_commits.length > 0 && <>
      <h4>Derniers commits</h4>
      <ul className="commit-list">{snapshot.recent_commits.map((commit) => <li key={commit.short_id}><code>{commit.short_id}</code><span>{commit.subject}</span><time>{commit.relative_time}</time></li>)}</ul>
    </>}
  </div>;
}
