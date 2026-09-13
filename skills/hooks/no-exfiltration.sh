#!/usr/bin/env bash
# no-exfiltration.sh — PreToolUse hook
# Blocks file writes and outbound POSTs during active scanner sessions.
# Fires only when ~/.ai-toolkit/.scanner-session exists and is < 60 minutes old.

set -euo pipefail

SENTINEL="$HOME/.ai-toolkit/.scanner-session"
SESSION_TTL_MINUTES=60

# --- Scope check ---
if [ ! -f "$SENTINEL" ]; then
  exit 0
fi

# Auto-expire stale sentinel
AGE_MINUTES=$(( ($(date +%s) - $(date -r "$SENTINEL" +%s 2>/dev/null || echo 0)) / 60 ))
if [ "$AGE_MINUTES" -ge "$SESSION_TTL_MINUTES" ]; then
  rm -f "$SENTINEL"
  exit 0
fi

# --- Parse tool call from stdin ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")

# --- Block Write tool entirely during scanner sessions ---
if [ "$TOOL_NAME" = "Write" ]; then
  FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
  echo "BLOCKED by no-exfiltration hook: Write tool is not permitted during an active scanner session. Security findings must stay in the conversation. Attempted path: ${FILE_PATH:-unknown}" >&2
  exit 2
fi

# --- Block Bash commands that exfiltrate data ---
if [ "$TOOL_NAME" = "Bash" ]; then
  CMD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

  # Block outbound POST (curl or wget)
  if echo "$CMD" | grep -qiE '(curl|wget).+(-X POST|--method POST|--post-data|--data|--data-raw|-d )'; then
    if echo "$CMD" | grep -qvE '(localhost|127\.0\.0\.1|management\.azure\.com|api\.endorlabs\.com|sonarcloud\.io)'; then
      echo "BLOCKED by no-exfiltration hook: outbound POST to external URL is not permitted during a scanner session. Findings must stay in the conversation." >&2
      exit 2
    fi
  fi

  # Block writes to /tmp with scan-like names
  if echo "$CMD" | grep -qE '(>|tee|write).*/tmp/.*\.(json|csv|txt|md|sarif)'; then
    echo "BLOCKED by no-exfiltration hook: writing scan findings to /tmp is not permitted. Findings must stay in the conversation." >&2
    exit 2
  fi
fi

exit 0
