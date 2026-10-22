import type { AgentPulse, PulseStatus } from "./agentPulse";
import { t } from "./i18n";

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

export function noticeKinds(): Array<{ kind: NoticeKind; label: string; hint: string; alert: boolean }> {
  return [
    { kind: "loop", label: t("Un agent tourne en rond", "An agent goes round in circles"), hint: t("Il répète les mêmes actions sans avancer.", "It repeats the same actions without progress."), alert: true },
    { kind: "error", label: t("Erreurs", "Errors"), hint: t("Plusieurs actions échouent d’affilée, ou un tour se termine en erreur.", "Several actions fail in a row, or a turn ends in error."), alert: true },
    { kind: "permission", label: t("Validation demandée", "Approval requested"), hint: t("Claude Code attend ton accord pour continuer.", "Claude Code needs your approval to continue."), alert: false },
    { kind: "waiting", label: t("Un agent t’attend", "An agent is waiting for you"), hint: t("Il a fini son tour et attend ton prochain message.", "It finished its turn and waits for your next message."), alert: false },
    { kind: "stalled", label: t("Un agent est silencieux", "An agent went silent"), hint: t("Tour en cours mais plus rien depuis 2 minutes.", "A turn is open but nothing happened for 2 minutes."), alert: false }
  ];
}

/** Agents seen recently enough to be worth a notification. */
const FRESH_MS = 10 * 60_000;

function situation(pulse: AgentPulse): { kind: NoticeKind; detail: string } | null {
  const permission = pulse.status === "waiting" && pulse.current?.marker === "needs-approval";
  if (pulse.status === "looping") return { kind: "loop", detail: pulse.loop?.evidence ?? t("actions répétées sans progrès", "repeated actions without progress") };
  if (pulse.status === "blocked") return { kind: "error", detail: `${t(`${pulse.failureStreak} actions en échec d’affilée`, `${pulse.failureStreak} actions failed in a row`)}${pulse.current ? ` — ${pulse.current.text.replace(/^✗\s*/, "")}` : ""}` };
  if (pulse.current?.marker === "turn-failed") return { kind: "error", detail: `${t("tour interrompu", "turn interrupted")}${pulse.current.detail ? ` (${pulse.current.detail})` : ""}` };
  if (permission) return { kind: "permission", detail: pulse.current!.detail ?? t("il attend ton accord", "it needs your approval") };
  if (pulse.status === "waiting") return { kind: "waiting", detail: pulse.current?.text ?? t("tour terminé", "turn finished") };
  if (pulse.status === "stalled") return { kind: "stalled", detail: pulse.current ? t(`dernière action : ${pulse.current.text}`, `last action: ${pulse.current.text}`) : t("plus aucune activité", "no more activity") };
  return null;
}

const TITLES: Record<NoticeKind, (name: string) => string> = {
  loop: (name) => t(`⚠ ${name} tourne en rond`, `⚠ ${name} is going round in circles`),
  error: (name) => t(`⚠ ${name} rencontre des erreurs`, `⚠ ${name} keeps failing`),
  permission: (name) => t(`${name} attend ta validation`, `${name} needs your approval`),
  waiting: (name) => t(`${name} t’attend`, `${name} is waiting for you`),
  stalled: (name) => t(`${name} est silencieux`, `${name} went silent`)
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
