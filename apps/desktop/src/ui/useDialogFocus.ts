import { useEffect, useRef, type DependencyList } from "react";

const DIALOG_SELECTOR = ".dialog-backdrop [role='dialog']";
const FOCUSABLE_SELECTOR = "a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

/**
 * Focus management for the topmost open dialog: focuses it when it opens, traps Tab inside it,
 * calls `onEscape` on Escape and gives focus back to the opener once every dialog is closed.
 * `deps` must change whenever a dialog opens or closes.
 */
export function useDialogFocus(onEscape: () => void, deps: DependencyList) {
  const activeDialog = useRef<HTMLElement | null>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialogs = [...document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)];
    const dialog = dialogs.at(-1);
    if (!dialog) {
      if (activeDialog.current) {
        if (dialogOpener.current?.isConnected) dialogOpener.current.focus();
        activeDialog.current = null;
        dialogOpener.current = null;
      }
      return;
    }
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (!activeDialog.current) dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const changedDialog = activeDialog.current !== dialog;
    activeDialog.current = dialog;
    if (changedDialog) dialog.focus();
    else if (!dialog.contains(document.activeElement)) (focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
    };
  }, deps);
}
