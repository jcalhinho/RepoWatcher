type ActivityEvent = {
  kind: string;
  tool_name?: string | null;
  file_path?: string | null;
  command?: string | null;
  content?: string | null;
  project_path?: string | null;
  outcome?: string | null;
  model?: { value: string } | null;
  input_tokens?: { value: number } | null;
  output_tokens?: { value: number } | null;
  duration_ms?: { value: number } | null;
};

/** What an agent is doing, in plain French: a headline and an optional detail line. */
export type Narration = { text: string; detail: string | null; tone: "work" | "success" | "failure" | "info" };

function displayPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").split("/").slice(-3).join("/");
}

function baseName(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? value;
}

function compact(value: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function seconds(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
}

function snippet(text: string, max = 70) {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/** Only the program name of a captured command: enough to tell `npm test` from `cargo build` without echoing arguments. */
function program(command: string) {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return baseName(first.replace(/^["']|["']$/g, "")) || null;
}

type ToolVerb = { doing: string; done: string; fallbackTarget: string };

function toolVerb(tool: string): ToolVerb | null {
  const name = tool.toLowerCase();
  if (/todo/.test(name)) return { doing: "Met à jour sa liste de tâches", done: "Liste de tâches mise à jour", fallbackTarget: "" };
  if (/ask_user|question/.test(name)) return { doing: "Te pose une question", done: "Question posée", fallbackTarget: "" };
  if (/^(agent|task)$|subagent|spawn/.test(name)) return { doing: "Délègue à un sous-agent", done: "Sous-agent terminé", fallbackTarget: "" };
  if (/web_?fetch|web_?search|browser|url/.test(name)) return { doing: "Consulte le web", done: "Page web consultée", fallbackTarget: "" };
  if (/grep|search/.test(name)) return { doing: "Cherche dans le code", done: "Recherche terminée", fallbackTarget: "le projet" };
  if (/glob|list|ls|find/.test(name)) return { doing: "Parcourt les fichiers", done: "Fichiers listés", fallbackTarget: "le projet" };
  if (/read|view|cat|open/.test(name)) return { doing: "Lit", done: "A lu", fallbackTarget: "un fichier" };
  if (/write|create/.test(name)) return { doing: "Écrit", done: "A écrit", fallbackTarget: "un fichier" };
  if (/edit|patch|replace/.test(name)) return { doing: "Modifie", done: "A modifié", fallbackTarget: "un fichier" };
  if (/bash|shell|command|powershell|terminal|exec|monitor/.test(name)) return { doing: "Lance une commande", done: "Commande terminée", fallbackTarget: "" };
  return null;
}

function toolHeadline(event: ActivityEvent, done: boolean) {
  const tool = event.tool_name || "un outil";
  const verb = toolVerb(tool);
  const file = event.file_path ? displayPath(event.file_path) : "";
  const command = event.command ? program(event.command) : null;
  if (!verb) return `${done ? "A utilisé" : "Utilise"} ${tool}${file ? ` sur ${file}` : ""}`;
  if (/commande/i.test(verb.doing)) return command ? `${done ? "Commande" : "Lance"} « ${command} … »${done ? " terminée" : ""}` : done ? verb.done : verb.doing;
  const phrase = done ? verb.done : verb.doing;
  // File verbs read as a sentence ("Modifie src/App.tsx"); others append the path when one was reported.
  if (verb.fallbackTarget === "un fichier") return `${phrase} ${file || verb.fallbackTarget}`;
  return file ? `${phrase} · ${file}` : phrase;
}

/** Describes one event for the race bubbles and action logs; null for events that say nothing about the agent's work. */
export function narrateEvent(event: ActivityEvent): Narration | null {
  const duration = event.duration_ms ? seconds(event.duration_ms.value) : null;
  switch (event.kind) {
    case "session_started":
      return { text: event.project_path ? `Démarre une session dans ${baseName(event.project_path)}` : "Démarre une session", detail: null, tone: "info" };
    case "session_ended":
      return { text: "Termine sa session", detail: duration, tone: "success" };
    case "user_message":
      return { text: "Reçoit un nouveau prompt", detail: event.content ? `« ${snippet(event.content)} »` : "texte du prompt non capturé", tone: "info" };
    case "assistant_message":
      return { text: "Rédige une réponse", detail: null, tone: "work" };
    case "tool_started":
      return { text: toolHeadline(event, false), detail: event.tool_name ? `outil ${event.tool_name}` : null, tone: "work" };
    case "tool_finished":
      return { text: `✓ ${toolHeadline(event, true)}`, detail: [event.tool_name, duration].filter(Boolean).join(" · ") || null, tone: "success" };
    case "tool_failed": {
      const file = event.file_path ? ` sur ${displayPath(event.file_path)}` : "";
      const reason = event.outcome && event.outcome !== "failed" ? event.outcome : null;
      return { text: `✗ Échec de ${event.tool_name || "l’outil"}${file}`, detail: reason ? `statut : ${reason}` : "l’agent va devoir réessayer", tone: "failure" };
    }
    case "file_read":
      return { text: event.file_path ? `Lit ${displayPath(event.file_path)}` : "Lit un fichier", detail: null, tone: "work" };
    case "file_changed":
      return { text: event.file_path ? `A modifié ${displayPath(event.file_path)}` : "A modifié un fichier", detail: null, tone: "success" };
    case "model_usage": {
      const input = event.input_tokens?.value;
      const output = event.output_tokens?.value;
      const tokens = [input !== undefined ? `${compact(input)} tokens lus` : null, output !== undefined ? `${compact(output)} écrits` : null].filter(Boolean).join(" · ");
      return { text: "Réfléchit avec le modèle", detail: [event.model?.value, tokens, duration].filter(Boolean).join(" · ") || null, tone: "work" };
    }
    case "checkpoint": {
      const failed = /error|fail|cancel/.test(event.outcome || "");
      if (failed) return { text: "Tour interrompu", detail: event.outcome?.replace(/^turn-/, "statut : ") ?? null, tone: "failure" };
      return { text: "Tour terminé", detail: duration ? `en ${duration}` : null, tone: "success" };
    }
    default:
      return null;
  }
}

/** Single-line copy kept for compact places (2D runner speech). */
export function describeAgentAction(event: ActivityEvent): string | null {
  return narrateEvent(event)?.text ?? null;
}
