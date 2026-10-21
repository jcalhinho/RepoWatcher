#!/usr/bin/env bash
# Builds the macOS app and installs it in /Applications, replacing the previous
# version, then relaunches it. Usage: npm run desktop:install-mac [-- --no-open]
# Only the .app bundle is built: the .dmg step is not needed for a local install.
set -euo pipefail

APP_NAME="RepoWatcher Agent Observer"
DEST="/Applications/${APP_NAME}.app"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TARGET_DIR="${CARGO_TARGET_DIR:-${ROOT}/target}"
BUILT="${TARGET_DIR}/release/bundle/macos/${APP_NAME}.app"
OPEN=1
[[ "${1:-}" == "--no-open" ]] && OPEN=0

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Ce script ne sert que sur macOS." >&2
  exit 1
fi

cd "${ROOT}"
echo "→ Compilation de ${APP_NAME}…"
npm run tauri --workspace @repo-watcher/agent-observer-desktop -- build --bundles app

if [[ ! -d "${BUILT}" ]]; then
  echo "Application introuvable après la compilation : ${BUILT}" >&2
  exit 1
fi

# Two instances cannot share the collector port: quit the installed one first.
if pgrep -f "${DEST}/Contents/MacOS/" >/dev/null; then
  echo "→ Fermeture de la version en cours…"
  osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "${DEST}/Contents/MacOS/" >/dev/null || break
    sleep 0.5
  done
  if pgrep -f "${DEST}/Contents/MacOS/" >/dev/null; then
    echo "L'application ne s'est pas fermée ; quitte-la puis relance ce script." >&2
    exit 1
  fi
fi

echo "→ Installation dans ${DEST}"
rm -rf "${DEST}"
ditto "${BUILT}" "${DEST}"

if [[ "${OPEN}" == 1 ]]; then
  open "${DEST}"
  echo "✓ ${APP_NAME} installé et relancé."
else
  echo "✓ ${APP_NAME} installé."
fi
