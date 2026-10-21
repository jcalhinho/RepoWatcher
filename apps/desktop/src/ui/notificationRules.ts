import type { AgentPulse, PulseStatus } from "./agentPulse";

/** What a notification is about; "loop" and "error" are alerts, shown and sounded differently. */
export type NoticeKind = "waiting" | "permission" | "stalled" | "error" | "loop";

export type Notice = {
  /** One notice per agent session and situation: the same situation never notifies twice. */
  key: string;
  kind: NoticeKind;
  alert: boolean;
  title: string;
  body: string;
  target: { provider: string; sessionId: string; projectPath: string | null };
};

export const NOTICE_KINDS: Array<{ kind: NoticeKind; label: string; hint: string; alert: boolean }> = [
  { kind: "loop", label: "Un agent tourne en rond", hint: "Il répète les mêmes actions sans avancer.", alert: true },
  { kind: "error", label: "Erreurs", hint: "Plusieurs actions échouent d’affilée, ou un tour se termine en erreur.", alert: true },
  { kind: "permission", label: "Validation demandée", hint: "Claude Code attend ton accord pour continuer.", alert: false },
  { kind: "waiting", label: "Un agent t’attend", hint: "Il a fini son tour et attend ton prochain message.", alert: false },
  { kind: "stalled", label: "Un agent est silencieux", hint: "Tour en cours mais plus rien depuis 2 minutes.", alert: false }
];

/** Agents seen recently enough to be worth a notification. */
const FRESH_MS = 10 * 60_000;

function situation(pulse: AgentPulse): { kind: NoticeKind; detail: string } | null {
  const permission = pulse.current && /validation|permission/i.test(pulse.current.text) && pulse.status === "waiting";
  if (pulse.status === "looping") return { kind: "loop", detail: pulse.loop?.evidence ?? "actions répétées sans progrès" };
  if (pulse.status === "blocked") return { kind: "error", detail: `${pulse.failureStreak} actions en échec d’affilée${pulse.current ? ` — ${pulse.current.text.replace(/^✗\s*/, "")}` : ""}` };
  if (pulse.current?.tone === "failure" && /interrompu/i.test(pulse.current.text)) return { kind: "error", detail: `tour interrompu${pulse.current.detail ? ` (${pulse.current.detail})` : ""}` };
  if (permission) return { kind: "permission", detail: pulse.current!.detail ?? "il attend ton accord" };
  if (pulse.status === "waiting") return { kind: "waiting", detail: pulse.current?.text ?? "tour terminé" };
  if (pulse.status === "stalled") return { kind: "stalled", detail: pulse.current ? `dernière action : ${pulse.current.text}` : "plus aucune activité" };
  return null;
}

const TITLES: Record<NoticeKind, (name: string) => string> = {
  loop: (name) => `⚠ ${name} tourne en rond`,
  error: (name) => `⚠ ${name} rencontre des erreurs`,
  permission: (name) => `${name} attend ta validation`,
  waiting: (name) => `${name} t’attend`,
  stalled: (name) => `${name} est silencieux`
};

/**
 * Notices for agents that just entered a situation. `current` remembers, per agent, the situation
 * already notified (session + kind): staying in it notifies nothing, leaving it clears it, so the
 * same agent notifies again when it gets stuck or finishes again later. `current` is not mutated.
 */
export function notices(pulses: AgentPulse[], current: ReadonlyMap<string, string>, names: ReadonlyMap<string, string>, now: number): { send: Notice[]; next: Map<string, string> } {
  const next = new Map(current);
  const send: Notice[] = [];
  for (const pulse of pulses) {
    const found = pulse.session && pulse.lastEventAt !== null && now - pulse.lastEventAt <= FRESH_MS ? situation(pulse) : null;
    if (!found || !pulse.session) {
      next.delete(pulse.key);
      continue;
    }
    const key = `${pulse.session.id}:${found.kind}`;
    if (next.get(pulse.key) === key) continue;
    next.set(pulse.key, key);
    const name = names.get(pulse.key) ?? pulse.key;
    send.push({
      key: `${pulse.key}:${key}`,
      kind: found.kind,
      alert: found.kind === "loop" || found.kind === "error",
      title: TITLES[found.kind](name),
      body: found.detail,
      target: { provider: pulse.key, sessionId: pulse.session.id, projectPath: pulse.project?.project_path ?? null }
    });
  }
  return { send, next };
}

export const isAlertStatus = (status: PulseStatus) => status === "looping" || status === "blocked";
