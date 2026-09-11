#!/bin/bash
# Prepare an Ortona session: make sure the screenshot harness can run.
#
# The game itself needs nothing installed. This is only for tools/check.mjs and
# tools/shoot.mjs, which drive headless Chromium through Playwright.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Chromium ships with the remote image. Never let npm try to fetch its own copy.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"
  [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && \
    echo "export PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH" >> "$CLAUDE_ENV_FILE"
fi

npm install --no-audit --no-fund --loglevel=error

# The harness needs a real Chromium binary; say so plainly now rather than
# letting a screenshot run fail forty seconds in.
CHROME="${ORTONA_CHROME:-/opt/pw-browsers/chromium}"
if [ -x "$CHROME" ]; then
  echo "ortona: chromium ready at $CHROME"
else
  echo "ortona: WARNING - no chromium at $CHROME." >&2
  echo "ortona: tools/shoot.mjs and tools/check.mjs will not run." >&2
  echo "ortona: set ORTONA_CHROME to a Chromium binary, or run 'npx playwright install chromium'." >&2
fi

echo "ortona: ready. 'node tools/check.mjs' to verify, 'node tools/shoot.mjs --list' to see scenes."
