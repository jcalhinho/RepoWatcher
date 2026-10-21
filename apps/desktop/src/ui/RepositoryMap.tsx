import { providerById } from "./providers";
import type { RepositorySnapshot, SessionEvent } from "./types";

const GEMINI_EVENT_KEY = providerById("gemini").eventKey;

export function RepositoryMap({ snapshot, events }: { snapshot: RepositorySnapshot; events: SessionEvent[] }) {
  const observed = new Map<string, number>();
  const root = snapshot.root.replaceAll("\\", "/").replace(/\/$/, "");
  for (const event of events) {
    if (!event.file_path) continue;
    const project = event.project_path?.replaceAll("\\", "/").replace(/\/$/, "");
    const samePath = project?.toLowerCase() === root.toLowerCase();
    // Gemini CLI only exposes a SHA-256 of the project path.
    const sameGeminiProject = event.provider === GEMINI_EVENT_KEY && event.project_hash === snapshot.project_hash;
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
