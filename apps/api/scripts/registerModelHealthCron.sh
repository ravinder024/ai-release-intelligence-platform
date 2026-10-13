#!/usr/bin/env bash
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ]; then
  echo "node was not found in PATH" >&2
  exit 1
fi

QA_SCRIPT="$REPO_ROOT/apps/api/dist/scripts/qaModels.js"
if [ ! -f "$QA_SCRIPT" ]; then
  echo "Build the API first: npm run build -w @prompt-playground/api" >&2
  exit 1
fi

TAG="# ARIP-OpenRouter-Free-Model-Health"
CRON_LINE="0 */6 * * * cd '$REPO_ROOT' && '$NODE_BIN' '$QA_SCRIPT' >> '$REPO_ROOT/apps/api/model-health-cron.log' 2>&1"
CURRENT="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$CURRENT" | sed '\|^# ARIP-OpenRouter-Free-Model-Health$|d;\|apps/api/dist/scripts/qaModels.js|d')"

{
  [ -z "$FILTERED" ] || printf '%s\n' "$FILTERED"
  printf '%s\n%s\n' "$TAG" "$CRON_LINE"
} | crontab -

echo "Installed OpenRouter free-model health check every 6 hours."
echo "Report: $REPO_ROOT/apps/api/model-health.json"
echo "Log: $REPO_ROOT/apps/api/model-health-cron.log"
