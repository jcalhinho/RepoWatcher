import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { t } from "./i18n";
import { Maximize2, Minimize2 } from "lucide-react";
import { isNumber, readPreference, writePreference } from "./preferences";

/**
 * A section whose height the user drags from its bottom handle (double-click resets, arrow keys
 * nudge) and that can be maximized to fill the window (Escape restores). The height is remembered
 * per `id`. Children should fill the box (height: 100%).
 */
export function Resizable({ id, defaultHeight, min = 140, max = 1400, label, className = "", children }: { id: string; defaultHeight: number; min?: number; max?: number; label: string; className?: string; children: ReactNode }) {
  const [height, setHeight] = useState(() => readPreference(`section-height.${id}`, defaultHeight, isNumber));
  const [maximized, setMaximized] = useState(false);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  useEffect(() => {
    if (!maximized) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setMaximized(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  function commit(next: number) {
    const value = clamp(next);
    setHeight(value);
    writePreference(`section-height.${id}`, Math.round(value));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: height };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setHeight(clamp(drag.current.startHeight + event.clientY - drag.current.startY));
  }

  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    writePreference(`section-height.${id}`, Math.round(height));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 80 : 20;
    if (event.key === "ArrowDown") commit(height + step);
    else if (event.key === "ArrowUp") commit(height - step);
    else if (event.key === "Home") commit(min);
    else if (event.key === "End") commit(max);
    else return;
    event.preventDefault();
  }

  function reset() {
    setHeight(defaultHeight);
    writePreference(`section-height.${id}`, null);
  }

  return <div className={`resizable ${maximized ? "is-maximized" : ""} ${className}`} style={{ "--section-height": `${height}px` } as CSSProperties} aria-label={label}>
    <button className="resizable-maximize" onClick={() => setMaximized((value) => !value)} aria-pressed={maximized} title={maximized ? t("Réduire (Échap)", "Restore (Esc)") : t("Agrandir en plein écran", "Full screen")} aria-label={maximized ? t(`Réduire ${label}`, `Restore ${label}`) : t(`Agrandir ${label}`, `Maximize ${label}`)}>
      {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
    <div className="resizable-body">{children}</div>
    {!maximized && <div
      className="resizable-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t(`Redimensionner ${label}`, `Resize ${label}`)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      title={t("Glisser pour redimensionner · double-clic pour revenir à la taille par défaut", "Drag to resize · double-click to reset")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    ><span /></div>}
  </div>;
}
