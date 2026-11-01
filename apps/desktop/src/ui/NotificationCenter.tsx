import { useEffect, useMemo, useRef } from "react";
import { t } from "./i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, onAction, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { agentPulse, type AgentPulse } from "./agentPulse";
import { isAlertStatus, notices, type Notice, type NoticeKind } from "./notificationRules";
import { readPreference } from "./preferences";
import { agentName, useAgents } from "./providers";
import type { SessionEvent } from "./types";
import { useNow } from "./useNow";

export type FocusTarget = Notice["target"] & { agentName: string };

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

export function notificationsEnabled(kind: NoticeKind) {
  const master = readPreference("notify.enabled", true, (value): value is boolean => typeof value === "boolean");
  // Silences are the least urgent: off by default.
  const own = readPreference(`notify.${kind}`, kind !== "stalled", (value): value is boolean => typeof value === "boolean");
  return master && own;
}

async function canNotify() {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/**
 * Watches every agent (whatever the tab or the mini mode) and turns changes of situation into
 * system notifications, a dock / taskbar badge and in-app alert banners. A click on a
 * notification goes to the agent concerned.
 */
export function NotificationCenter({ events, onGoTo }: { events: SessionEvent[]; onGoTo: (target: FocusTarget) => void }) {
  const now = useNow(3000);
  const agents = useAgents();
  const pulses = useMemo(() => agents.map((provider) => agentPulse(provider.eventKey, events, now)), [agents, events, now]);
  const names = useMemo(() => new Map(agents.map((provider) => [provider.eventKey, provider.name])), [agents]);
  const notified = useRef(new Map<string, string>());
  const sentById = useRef(new Map<number, Notice>());
  const lastSent = useRef<Notice | null>(null);
  const started = useRef(false);
  const goTo = useRef(onGoTo);
  goTo.current = onGoTo;

  useEffect(() => {
    const result = notices(pulses, notified.current, names, now);
    notified.current = result.next;
    // Situations already present when the app opens are shown in the app, not re-announced.
    if (!started.current) {
      started.current = true;
      return;
    }
    const toSend = result.send.filter((notice) => notificationsEnabled(notice.kind));
    if (!toSend.length) return;
    void canNotify().then((allowed) => {
      if (!allowed) return;
      for (const notice of toSend) {
        const id = Math.floor(Math.random() * 2_000_000_000);
        sentById.current.set(id, notice);
        lastSent.current = notice;
        sendNotification({ id, title: notice.title, body: notice.body, group: notice.target.provider, sound: notice.alert ? (isMac ? "Basso" : "Default") : undefined });
      }
    });
  }, [pulses, now]);

  // Dock / taskbar badge: how many agents need you.
  const attention = pulses.filter((pulse) => ["looping", "blocked", "stalled", "waiting"].includes(pulse.status) && pulse.lastEventAt !== null && now - pulse.lastEventAt < 30 * 60_000).length;
  useEffect(() => {
    getCurrentWindow().setBadgeCount(attention || undefined).catch(() => undefined);
  }, [attention]);

  useEffect(() => {
    let stop: { unregister: () => Promise<void> } | undefined;
    onAction((event) => {
      const notice = (event.notification && sentById.current.get(event.notification.id)) || lastSent.current;
      if (!notice) return;
      void getCurrentWindow().setFocus().catch(() => undefined);
      goTo.current({ ...notice.target, agentName: agentName(notice.target.provider) });
    }).then((listener) => { stop = listener; }).catch(() => undefined);
    return () => { void stop?.unregister(); };
  }, []);

  const alerts = pulses.filter((pulse) => isAlertStatus(pulse.status) && pulse.session);
  if (!alerts.length) return null;
  return <div className="alert-banners" role="alert">
    {alerts.map((pulse) => <AlertBanner key={pulse.key} pulse={pulse} onGoTo={() => goTo.current({ provider: pulse.key, sessionId: pulse.session!.id, projectPath: pulse.project?.project_path ?? null, agentName: agentName(pulse.key) })} />)}
  </div>;
}

function AlertBanner({ pulse, onGoTo }: { pulse: AgentPulse; onGoTo: () => void }) {
  const name = agentName(pulse.key);
  const text = pulse.status === "looping" ? t(`${name} tourne en rond : ${pulse.loop?.evidence ?? "actions répétées sans progrès"}.`, `${name} is going in circles: ${pulse.loop?.evidence ?? "repeated actions without progress"}.`) : t(`${name} enchaîne les erreurs : ${pulse.failureStreak} actions en échec d’affilée.`, `${name} keeps failing: ${pulse.failureStreak} failed actions in a row.`);
  return <div className={`alert-banner ${pulse.status}`}>
    <AlertTriangle size={16} />
    <span>{text}</span>
    <button className="button small" onClick={onGoTo}><ArrowUpRight size={13} /> {t("Aller à l’agent", "Go to agent")}</button>
  </div>;
}
