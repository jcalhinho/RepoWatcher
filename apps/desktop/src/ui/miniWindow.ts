import { LogicalPosition, LogicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

const SAVED_FRAME = "repowatcher.full-window-frame";
const MINI_WIDTH = 380;
const MARGIN = 16;
const FULL_MIN = { width: 1120, height: 720 };

/**
 * Shrinks the window to a narrow column in the top-right corner of its screen, optionally kept
 * above other windows. The full-size frame is remembered so `leaveMiniWindow` can restore it.
 * No-ops outside Tauri (web preview).
 */
export async function enterMiniWindow(pinned: boolean) {
  try {
    const appWindow = getCurrentWindow();
    const scale = await appWindow.scaleFactor();
    const [size, position] = await Promise.all([appWindow.outerSize(), appWindow.outerPosition()]);
    if (size.toLogical(scale).width > MINI_WIDTH + 100) {
      saveFrame({ ...size.toLogical(scale), ...position.toLogical(scale) });
    }
    await appWindow.setMinSize(new LogicalSize(300, 360));
    const monitor = await currentMonitor();
    if (monitor) {
      const area = { x: monitor.workArea.position.x / monitor.scaleFactor, y: monitor.workArea.position.y / monitor.scaleFactor, width: monitor.workArea.size.width / monitor.scaleFactor, height: monitor.workArea.size.height / monitor.scaleFactor };
      const height = Math.min(980, area.height - MARGIN * 2);
      await appWindow.setSize(new LogicalSize(MINI_WIDTH, height));
      await appWindow.setPosition(new LogicalPosition(area.x + area.width - MINI_WIDTH - MARGIN, area.y + MARGIN));
    } else {
      await appWindow.setSize(new LogicalSize(MINI_WIDTH, 820));
    }
    await appWindow.setAlwaysOnTop(pinned);
  } catch {
    /* web preview or missing permission: the mini layout still applies */
  }
}

export async function setMiniPinned(pinned: boolean) {
  try {
    await getCurrentWindow().setAlwaysOnTop(pinned);
  } catch { /* web preview */ }
}

export async function leaveMiniWindow() {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.setAlwaysOnTop(false);
    await appWindow.setMinSize(new LogicalSize(FULL_MIN.width, FULL_MIN.height));
    const frame = readFrame();
    await appWindow.setSize(new LogicalSize(Math.max(FULL_MIN.width, frame?.width ?? 1440), Math.max(FULL_MIN.height, frame?.height ?? 920)));
    if (frame) await appWindow.setPosition(new LogicalPosition(frame.x, frame.y));
    else await appWindow.center();
  } catch { /* web preview */ }
}

type Frame = { width: number; height: number; x: number; y: number };

function saveFrame(frame: Frame) {
  try {
    localStorage.setItem(SAVED_FRAME, JSON.stringify(frame));
  } catch { /* optional */ }
}

function readFrame(): Frame | null {
  try {
    const frame = JSON.parse(localStorage.getItem(SAVED_FRAME) ?? "null");
    return frame && [frame.width, frame.height, frame.x, frame.y].every(Number.isFinite) ? frame : null;
  } catch {
    return null;
  }
}
