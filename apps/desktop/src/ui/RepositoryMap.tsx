import type { RepositorySnapshot, SessionEvent } from "./types";

export function RepositoryMap({ snapshot, events }: { snapshot: RepositorySnapshot; events: SessionEvent[] }) {
  const observed = new Map<string, number>();
  const root = snapshot.root.replaceAll("\\", "/").replace(/\/$/, "");
  // `events` are already scoped to this repository by the workspace matcher.
  for (const event of events) {
    if (!event.file_path) continue;
    let key = event.file_path.replaceAll("\\", "/");
    if (key.toLowerCase().startsWith(`${root.toLowerCase()}/`)) key = key.slice(root.length + 1);
    observed.set(key, (observed.get(key) || 0) + 1);
  }
  const rows = new Map<string, { status: string; count: number }>();
  snapshot.changed_files.forEach((file) => rows.set(file.path.replaceAll("\\", "/"), { status: file.status, count: observed.get(file.path.replaceAll("\\", "/")) || 0 }));
  observed.forEach((count, path) => { if (!rows.has(path)) rows.set(path, { status: "observé", count }); });
  return <div className="repo-map"><div className="repo-map-meta"><span>Branche <b>{snapshot.branch || "HEAD détachée"}</b>{snapshot.ahead !== null && snapshot.behind !== null && <> · ↑{snapshot.ahead} ↓{snapshot.behind}</>}</span><span>{snapshot.changed_files.length} changements non commités · actualisé en continu</span></div>{rows.size ? [...rows.entries()].map(([path, info]) => <div className="repo-map-row" key={path}><span className="repo-tree">└─</span><code>{path}</code><span>{info.count ? `${info.count} événements observés` : info.status}</span></div>) : <div className="repo-map-empty">Aucun fichier modifié ou observé pour l’instant.</div>}<div className="repo-commits">{snapshot.recent_commits.map((commit) => <div key={commit.short_id}><code>{commit.short_id}</code> {commit.subject} <span>{commit.relative_time}</span></div>)}</div><small>Git status et événements observés sont présentés séparément ; aucun lien causal n’est supposé.</small></div>;
}
