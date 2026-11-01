import { useCallback, useState } from "react";
import { currentLang, t } from "./i18n";
import { readPreference } from "./preferences";
import { invoke } from "@tauri-apps/api/core";

type FocusOutcome = { ok: boolean; message: string; fallback_folder: string | null };
export type FocusToast = FocusOutcome & { id: number; agent: string };

/** "Go to the agent": asks the native side to bring its terminal or editor forward, and reports what happened. */
export function useFocusAgent() {
  const [toast, setToast] = useState<FocusToast | null>(null);

  const goTo = useCallback(async (target: { provider: string; sessionId: string; projectPath: string | null; agentName: string }) => {
    let outcome: FocusOutcome;
    try {
      outcome = await invoke<FocusOutcome>("focus_agent", { provider: target.provider, sessionId: target.sessionId, projectPath: target.projectPath, lang: currentLang(), launchHost: readPreference<string>("launch-host", "terminal", (value): value is string => typeof value === "string") });
    } catch {
      outcome = { ok: false, message: t("Disponible seulement dans l’application de bureau.", "Only available in the desktop app."), fallback_folder: null };
    }
    const id = Date.now();
    setToast({ ...outcome, id, agent: target.agentName });
    window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), outcome.ok ? 4000 : 9000);
  }, []);

  const revealFolder = useCallback(async (path: string) => {
    try {
      await invoke("reveal_folder", { path, lang: currentLang(), launchHost: readPreference<string>("launch-host", "terminal", (value): value is string => typeof value === "string") });
      setToast(null);
    } catch (error) {
      setToast((current) => current && { ...current, message: String(error), fallback_folder: null });
    }
  }, []);

  return { toast, goTo, revealFolder, dismiss: () => setToast(null) };
}
