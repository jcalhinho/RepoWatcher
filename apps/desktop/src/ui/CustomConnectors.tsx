import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Trash2 } from "lucide-react";
import { since } from "./AgentCard";
import { EmptyState, SectionHeader } from "./Explain";
import { t } from "./i18n";
import { setCustomProviders } from "./providers";
import type { SessionEvent } from "./types";

type CustomConnector = { id: string; name: string; color: string; token: string };

const ENDPOINT = "http://127.0.0.1:43821/v1/events";
type Language = "curl" | "python" | "node";

function example(language: Language, token: string) {
  const event = `{"session_id": "my-session-1", "kind": "tool_started", "tool_name": "bash", "project_path": "/path/to/project"}`;
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
      setError(t("Disponible seulement dans l’application de bureau.", "Only available in the desktop app."));
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
    if (!window.confirm(t(`Supprimer le connecteur « ${connector.name} » ? Son jeton ne fonctionnera plus. Les événements déjà reçus restent dans l’historique.`, `Delete the “${connector.name}” connector? Its token will stop working. Events already received stay in the history.`))) return;
    await invoke("delete_custom_connector", { id: connector.id });
    await refresh();
  }

  return <section className="page-section">
    <SectionHeader
      level={3}
      title={t("Connecteurs personnalisés", "Custom connectors")}
      description={t("Pour un agent que l’app ne connaît pas encore : crée un connecteur, puis envoie ses événements à l’adresse locale avec son jeton. Il apparaîtra comme les autres agents (carte, course, analyse, notifications).", "For an agent the app doesn’t know yet: create a connector, then send its events to the local address with its token. It will show up like the other agents (card, race, analytics, notifications).")}
      details={t("Chaque connecteur a son propre jeton, que tu peux révoquer en le supprimant. Le format des événements (champs, types d’événements, exemples) est décrit dans docs/CONNECTORS.md. Les textes de prompts et les commandes suivent les mêmes réglages de confidentialité que les autres agents.", "Each connector has its own token, revoked by deleting it. The event format (fields, event kinds, examples) is described in docs/CONNECTORS.md. Prompt text and commands follow the same privacy settings as the other agents.")}
    />
    <form className="custom-connector-form" onSubmit={create}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Nom de l’agent, ex. « Mon agent maison »", "Agent name, e.g. “My home-made agent”")} maxLength={40} aria-label={t("Nom du connecteur", "Connector name")} />
      <button className="button primary" disabled={!name.trim()}>{t("Ajouter un connecteur", "Add a connector")}</button>
    </form>
    {error && <p className="notice warn">{error}</p>}
    {connectors && !connectors.length && !error && <EmptyState title={t("Aucun connecteur personnalisé", "No custom connector")}>{t("Ajoute-en un si ton agent n’est pas dans la liste ci-dessus.", "Add one if your agent is not in the list above.")}</EmptyState>}
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
      <span className="text-muted small">{lastAt === null ? t("Aucun événement reçu pour l’instant", "No event received yet") : t(`Dernier événement ${since(lastAt, now)}`, `Last event ${since(lastAt, now)}`)}</span>
      <button className="icon-button" onClick={onRemove} title={t("Supprimer ce connecteur", "Delete this connector")}><Trash2 size={14} /></button>
    </header>
    <dl className="facts">
      <div><dt>{t("Adresse", "Address")}</dt><dd><code>POST {ENDPOINT}</code></dd></div>
      <div><dt>{t("Jeton", "Token")}</dt><dd><code>{connector.token.slice(0, 6)}••••••••</code> <button className="button small" onClick={() => void copy("token", connector.token)}><Copy size={12} /> {copied === "token" ? t("Copié", "Copied") : t("Copier", "Copy")}</button></dd></div>
    </dl>
    <div className="segmented" role="group" aria-label={t("Langage de l’exemple", "Example language")}>{(["curl", "python", "node"] as const).map((value) => <button key={value} aria-pressed={language === value} onClick={() => setLanguage(value)}>{value === "curl" ? "curl" : value === "python" ? "Python" : "Node.js"}</button>)}</div>
    <pre className="code-example">{example(language, connector.token)}</pre>
    <button className="button small" onClick={() => void copy("example", example(language, connector.token))}><Copy size={12} /> {copied === "example" ? t("Copié", "Copied") : t("Copier l’exemple", "Copy the example")}</button>
  </article>;
}
