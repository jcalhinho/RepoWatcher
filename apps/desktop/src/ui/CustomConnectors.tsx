import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Trash2 } from "lucide-react";
import { since } from "./AgentCard";
import { EmptyState, SectionHeader } from "./Explain";
import { setCustomProviders } from "./providers";
import type { SessionEvent } from "./types";

type CustomConnector = { id: string; name: string; color: string; token: string };

const ENDPOINT = "http://127.0.0.1:43821/v1/events";
type Language = "curl" | "python" | "node";

function example(language: Language, token: string) {
  const event = `{"session_id": "ma-session-1", "kind": "tool_started", "tool_name": "bash", "project_path": "/chemin/du/projet"}`;
  switch (language) {
    case "curl":
      return `curl -X POST ${ENDPOINT} \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '${event}'`;
    case "python":
      return `import json, urllib.request\n\nevent = ${event}\nrequest = urllib.request.Request(\n    "${ENDPOINT}",\n    data=json.dumps(event).encode(),\n    headers={"Authorization": "Bearer ${token}", "Content-Type": "application/json"},\n)\nurllib.request.urlopen(request, timeout=2)`;
    case "node":
      return `await fetch("${ENDPOINT}", {\n  method: "POST",\n  headers: { Authorization: "Bearer ${token}", "Content-Type": "application/json" },\n  body: JSON.stringify(${event}),\n});`;
  }
}

/** Declare an agent the app does not know yet: it gets its own token and appears like the others. */
export function CustomConnectors({ events, now }: { events: SessionEvent[]; now: number }) {
  const [connectors, setConnectors] = useState<CustomConnector[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const list = await invoke<CustomConnector[]>("list_custom_connectors");
      setConnectors(list);
      setCustomProviders(list);
    } catch {
      setConnectors([]);
      setError("Disponible seulement dans l’application de bureau.");
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await invoke("create_custom_connector", { name });
      setName("");
      await refresh();
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function remove(connector: CustomConnector) {
    if (!window.confirm(`Supprimer le connecteur « ${connector.name} » ? Son jeton ne fonctionnera plus. Les événements déjà reçus restent dans l’historique.`)) return;
    await invoke("delete_custom_connector", { id: connector.id });
    await refresh();
  }

  return <section className="page-section">
    <SectionHeader
      level={3}
      title="Connecteurs personnalisés"
      description="Pour un agent que l’app ne connaît pas encore : crée un connecteur, puis envoie ses événements à l’adresse locale avec son jeton. Il apparaîtra comme les autres agents (carte, course, analyse, notifications)."
      details="Chaque connecteur a son propre jeton, que tu peux révoquer en le supprimant. Le format des événements (champs, types d’événements, exemples) est décrit dans docs/CONNECTORS.md. Les textes de prompts et les commandes suivent les mêmes réglages de confidentialité que les autres agents."
    />
    <form className="custom-connector-form" onSubmit={create}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nom de l’agent, ex. « Mon agent maison »" maxLength={40} aria-label="Nom du connecteur" />
      <button className="button primary" disabled={!name.trim()}>Ajouter un connecteur</button>
    </form>
    {error && <p className="notice warn">{error}</p>}
    {connectors && !connectors.length && !error && <EmptyState title="Aucun connecteur personnalisé">Ajoute-en un si ton agent n’est pas dans la liste ci-dessus.</EmptyState>}
    <div className="custom-connector-list">{connectors?.map((connector) => {
      const own = events.filter((event) => event.provider === `custom:${connector.id}`);
      const lastAt = own.length ? Math.max(...own.map((event) => Date.parse(event.occurred_at))) : null;
      return <CustomConnectorCard key={connector.id} connector={connector} lastAt={lastAt} now={now} onRemove={() => void remove(connector)} />;
    })}</div>
  </section>;
}

function CustomConnectorCard({ connector, lastAt, now, onRemove }: { connector: CustomConnector; lastAt: number | null; now: number; onRemove: () => void }) {
  const [language, setLanguage] = useState<Language>("curl");
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  };
  return <article className="custom-connector" style={{ "--agent-color": connector.color } as CSSProperties}>
    <header>
      <b>{connector.name}</b>
      <span className="text-muted small">{lastAt === null ? "Aucun événement reçu pour l’instant" : `Dernier événement ${since(lastAt, now)}`}</span>
      <button className="icon-button" onClick={onRemove} title="Supprimer ce connecteur"><Trash2 size={14} /></button>
    </header>
    <dl className="facts">
      <div><dt>Adresse</dt><dd><code>POST {ENDPOINT}</code></dd></div>
      <div><dt>Jeton</dt><dd><code>{connector.token.slice(0, 6)}••••••••</code> <button className="button small" onClick={() => void copy("token", connector.token)}><Copy size={12} /> {copied === "token" ? "Copié" : "Copier"}</button></dd></div>
    </dl>
    <div className="segmented" role="group" aria-label="Langage de l’exemple">{(["curl", "python", "node"] as const).map((value) => <button key={value} aria-pressed={language === value} onClick={() => setLanguage(value)}>{value === "curl" ? "curl" : value === "python" ? "Python" : "Node.js"}</button>)}</div>
    <pre className="code-example">{example(language, connector.token)}</pre>
    <button className="button small" onClick={() => void copy("example", example(language, connector.token))}><Copy size={12} /> {copied === "example" ? "Copié" : "Copier l’exemple"}</button>
  </article>;
}
