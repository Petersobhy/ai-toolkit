#!/usr/bin/env bash
# no-credential-echo.sh — PostToolUse hook
# Scans Bash output for credential patterns (bearer tokens, subscription UUIDs,
# API keys) and blocks the output if found.
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

# --- Parse tool call output from stdin ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")

if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

OUTPUT=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_response',''))" 2>/dev/null || echo "")

FOUND=""

# Bearer token (eyJ... JWT or long base64 string after "Bearer ")
if echo "$OUTPUT" | grep -qE 'Bearer [A-Za-z0-9+/=_-]{20,}'; then
  FOUND="bearer token"
fi

# Azure subscription UUID (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
# Only flag if it appears in a context suggesting it was explicitly printed
if echo "$OUTPUT" | grep -qiE '(subscription.?id|AZURE_SUBSCRIPTION_ID)[^a-z0-9]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'; then
  FOUND="subscription UUID"
fi

# SonarCloud token (sqp_ or squ_ prefix)
if echo "$OUTPUT" | grep -qE '(sqp|squ)_[A-Za-z0-9]{20,}'; then
  FOUND="SonarCloud API token"
fi

# Endorlabs API credentials (long alphanumeric strings after key/secret labels)
if echo "$OUTPUT" | grep -qiE '(API_CREDENTIALS_KEY|API_CREDENTIALS_SECRET|api.key|api.secret)\s*[=:]\s*[A-Za-z0-9+/=_-]{20,}'; then
  FOUND="Endorlabs API credential"
fi

if [ -n "$FOUND" ]; then
  echo "BLOCKED by no-credential-echo hook: output contains a ${FOUND}. Credential values must never appear in output — show set/not-set status only (e.g. 'AZURE_SUBSCRIPTION_ID: set ✓')." >&2
  exit 2
fi

exit 0
