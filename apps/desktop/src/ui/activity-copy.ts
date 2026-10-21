import { locale, t } from "./i18n";

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
  cache_read_tokens?: { value: number } | null;
  cache_write_tokens?: { value: number } | null;
  duration_ms?: { value: number } | null;
};

/** What an agent is doing, in plain French: a headline and an optional detail line. */
/** What an agent is doing, in plain words: a headline, an optional detail line, and a language-independent marker for rules. */
export type Narration = { text: string; detail: string | null; tone: "work" | "success" | "failure" | "info"; marker?: "needs-approval" | "needs-input" | "turn-failed" };

function displayPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").split("/").slice(-3).join("/");
}

function baseName(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? value;
}

function compact(value: number) {
  return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function seconds(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} s`;
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

type ToolVerb = { doing: string; done: string; target: "file" | "project" | null; command?: boolean };

function toolVerb(tool: string): ToolVerb | null {
  const name = tool.toLowerCase();
  if (/todo/.test(name)) return { doing: t("Met à jour sa liste de tâches", "Updates its to-do list"), done: t("Liste de tâches mise à jour", "To-do list updated"), target: null };
  if (/ask_user|question/.test(name)) return { doing: t("Te pose une question", "Asks you a question"), done: t("Question posée", "Question asked"), target: null };
  if (/^(agent|task)$|subagent|spawn/.test(name)) return { doing: t("Délègue à un sous-agent", "Delegates to a sub-agent"), done: t("Sous-agent terminé", "Sub-agent finished"), target: null };
  if (/web_?fetch|web_?search|browser|url/.test(name)) return { doing: t("Consulte le web", "Browses the web"), done: t("Page web consultée", "Web page read"), target: null };
  if (/grep|search/.test(name)) return { doing: t("Cherche dans le code", "Searches the code"), done: t("Recherche terminée", "Search done"), target: "project" };
  if (/glob|list|ls|find/.test(name)) return { doing: t("Parcourt les fichiers", "Lists files"), done: t("Fichiers listés", "Files listed"), target: "project" };
  if (/read|view|cat|open/.test(name)) return { doing: t("Lit", "Reads"), done: t("A lu", "Read"), target: "file" };
  if (/write|create/.test(name)) return { doing: t("Écrit", "Writes"), done: t("A écrit", "Wrote"), target: "file" };
  if (/edit|patch|replace/.test(name)) return { doing: t("Modifie", "Edits"), done: t("A modifié", "Edited"), target: "file" };
  if (/bash|shell|command|powershell|terminal|exec|monitor/.test(name)) return { doing: t("Lance une commande", "Runs a command"), done: t("Commande terminée", "Command finished"), target: null, command: true };
  return null;
}

function toolHeadline(event: ActivityEvent, done: boolean) {
  const tool = event.tool_name || t("un outil", "a tool");
  const verb = toolVerb(tool);
  const file = event.file_path ? displayPath(event.file_path) : "";
  const command = event.command ? program(event.command) : null;
  if (!verb) return `${done ? t("A utilisé", "Used") : t("Utilise", "Uses")} ${tool}${file ? ` ${t("sur", "on")} ${file}` : ""}`;
  if (verb.command) return command ? (done ? t(`Commande « ${command} … » terminée`, `Command “${command} …” finished`) : t(`Lance « ${command} … »`, `Runs “${command} …”`)) : done ? verb.done : verb.doing;
  const phrase = done ? verb.done : verb.doing;
  // File verbs read as a sentence ("Edits src/App.tsx"); others append the path when one was reported.
  if (verb.target === "file") return `${phrase} ${file || t("un fichier", "a file")}`;
  return file ? `${phrase} · ${file}` : phrase;
}

/** Describes one event for the race bubbles and action logs; null for events that say nothing about the agent's work. */
export function narrateEvent(event: ActivityEvent): Narration | null {
  const duration = event.duration_ms ? seconds(event.duration_ms.value) : null;
  switch (event.kind) {
    case "session_started":
      return { text: event.project_path ? t(`Démarre une session dans ${baseName(event.project_path)}`, `Starts a session in ${baseName(event.project_path)}`) : t("Démarre une session", "Starts a session"), detail: null, tone: "info" };
    case "session_ended":
      return { text: t("Termine sa session", "Ends its session"), detail: duration, tone: "success" };
    case "user_message":
      return { text: t("Reçoit un nouveau prompt", "Gets a new prompt"), detail: event.content ? t(`« ${snippet(event.content)} »`, `“${snippet(event.content)}”`) : t("texte du prompt non capturé", "prompt text not captured"), tone: "info" };
    case "assistant_message":
      return { text: t("Rédige une réponse", "Writes an answer"), detail: null, tone: "work" };
    case "tool_started":
      return { text: toolHeadline(event, false), detail: event.tool_name ? t(`outil ${event.tool_name}`, `tool ${event.tool_name}`) : null, tone: "work" };
    case "tool_finished":
      return { text: `✓ ${toolHeadline(event, true)}`, detail: [event.tool_name, duration].filter(Boolean).join(" · ") || null, tone: "success" };
    case "tool_failed": {
      const tool = event.tool_name || t("l’outil", "the tool");
      const file = event.file_path ? ` ${t("sur", "on")} ${displayPath(event.file_path)}` : "";
      const reason = event.outcome && event.outcome !== "failed" ? event.outcome : null;
      return { text: `✗ ${t(`Échec de ${tool}`, `${tool} failed`)}${file}`, detail: reason ? t(`statut : ${reason}`, `status: ${reason}`) : t("l’agent va devoir réessayer", "the agent will have to retry"), tone: "failure" };
    }
    case "file_read":
      return { text: event.file_path ? `${t("Lit", "Reads")} ${displayPath(event.file_path)}` : t("Lit un fichier", "Reads a file"), detail: null, tone: "work" };
    case "file_changed":
      return { text: event.file_path ? `${t("A modifié", "Edited")} ${displayPath(event.file_path)}` : t("A modifié un fichier", "Edited a file"), detail: null, tone: "success" };
    case "model_usage": {
      const cached = (event.cache_read_tokens?.value ?? 0) + (event.cache_write_tokens?.value ?? 0);
      const input = event.input_tokens || cached ? (event.input_tokens?.value ?? 0) + cached : undefined;
      const output = event.output_tokens?.value;
      const tokens = [input !== undefined ? t(`${compact(input)} tokens lus`, `${compact(input)} tokens read`) : null, output !== undefined ? t(`${compact(output)} écrits`, `${compact(output)} written`) : null].filter(Boolean).join(" · ");
      return { text: t("Réfléchit avec le modèle", "Thinks with the model"), detail: [event.model?.value, tokens, duration].filter(Boolean).join(" · ") || null, tone: "work" };
    }
    case "checkpoint": {
      if ((event.outcome ?? "").startsWith("attention:")) {
        const message = event.outcome!.slice("attention:".length);
        return /permission|approve|autoris/i.test(message)
          ? { text: t("Attend ta validation", "Waiting for your approval"), detail: message || null, tone: "info", marker: "needs-approval" }
          : { text: t("Attend ton message", "Waiting for your message"), detail: message || null, tone: "info", marker: "needs-input" };
      }
      const failed = /error|fail|cancel/.test(event.outcome || "");
      if (failed) return { text: t("Tour interrompu", "Turn interrupted"), detail: event.outcome?.replace(/^turn-/, t("statut : ", "status: ")) ?? null, tone: "failure", marker: "turn-failed" };
      return { text: t("Tour terminé", "Turn finished"), detail: duration ? t(`en ${duration}`, `in ${duration}`) : null, tone: "success" };
    }
    default:
      return null;
  }
}
