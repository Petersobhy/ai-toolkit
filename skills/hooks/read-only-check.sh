#!/usr/bin/env bash
# read-only-check.sh — PreToolUse hook
# Blocks write operations against Azure Security Center, Endorlabs, and SonarCloud
# during active scanner sessions.
# Fires only when ~/.ai-toolkit/.scanner-session exists and is < 60 minutes old.

set -euo pipefail

SENTINEL="$HOME/.ai-toolkit/.scanner-session"
SESSION_TTL_MINUTES=60

# --- Scope check ---
if [ ! -f "$SENTINEL" ]; then
  exit 0
fi

AGE_MINUTES=$(( ($(date +%s) - $(date -r "$SENTINEL" +%s 2>/dev/null || echo 0)) / 60 ))
if [ "$AGE_MINUTES" -ge "$SESSION_TTL_MINUTES" ]; then
  rm -f "$SENTINEL"
  exit 0
fi

# --- Parse tool call from stdin ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")

if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

CMD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

# --- Azure Security Center write operations ---
# Block: az security commands that mutate state
if echo "$CMD" | grep -qE 'az security.*(update|patch|delete|create|set|dismiss|resolve|suppress)'; then
  echo "BLOCKED by read-only-check hook: write operation against Azure Security Center is not permitted during a scanner session. This skill is read-only — changes must be made in the Azure Portal." >&2
  exit 2
fi

# Block: curl/az REST calls with write methods to management.azure.com security endpoints
if echo "$CMD" | grep -qE 'management\.azure\.com.*Security' && echo "$CMD" | grep -qiE '(-X (PUT|POST|PATCH|DELETE)|--method (PUT|POST|PATCH|DELETE))'; then
  echo "BLOCKED by read-only-check hook: write API call to Azure Security Center is not permitted during a scanner session." >&2
  exit 2
fi

# --- Endorlabs write operations ---
# Block: curl POST/PUT/PATCH/DELETE to api.endorlabs.com
if echo "$CMD" | grep -qE 'api\.endorlabs\.com' && echo "$CMD" | grep -qiE '(-X (POST|PUT|PATCH|DELETE)|--method (POST|PUT|PATCH|DELETE))'; then
  echo "BLOCKED by read-only-check hook: write operation against Endorlabs API is not permitted during a scanner session. This skill is read-only — changes must be made in the Endorlabs console." >&2
  exit 2
fi

# --- SonarCloud write operations ---
# Block: curl POST/PUT/PATCH to sonarcloud.io with issue-mutation paths
if echo "$CMD" | grep -qE 'sonarcloud\.io/api/(issues|hotspots).*(resolve|dismiss|do_transition|set_severity|set_type|assign)'; then
  echo "BLOCKED by read-only-check hook: write operation against SonarCloud is not permitted during a scanner session. This skill is read-only — changes must be made in the SonarCloud UI." >&2
  exit 2
fi

if echo "$CMD" | grep -qE 'sonarcloud\.io' && echo "$CMD" | grep -qiE '(-X (POST|PUT|PATCH|DELETE)|--method (POST|PUT|PATCH|DELETE))'; then
  echo "BLOCKED by read-only-check hook: write API call to SonarCloud is not permitted during a scanner session." >&2
  exit 2
fi

exit 0
