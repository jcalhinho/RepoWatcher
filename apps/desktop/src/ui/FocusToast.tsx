import { X } from "lucide-react";
import { t } from "./i18n";
import type { FocusToast as Toast } from "./useFocusAgent";

/** Result of "go to the agent", with the folder as a way out when the agent is gone. */
export function FocusToast({ toast, onReveal, onDismiss }: { toast: Toast | null; onReveal: (path: string) => void; onDismiss: () => void }) {
  if (!toast) return null;
  return <div className={`toast ${toast.ok ? "ok" : "warn"}`} role="status">
    <span><b>{toast.agent}</b>{toast.message}</span>
    {toast.fallback_folder && <button className="button small" onClick={() => onReveal(toast.fallback_folder!)}>{t("Ouvrir le dossier", "Open the folder")}</button>}
    <button className="icon-button" onClick={onDismiss} aria-label={t("Fermer", "Close")}><X size={14} /></button>
  </div>;
}
