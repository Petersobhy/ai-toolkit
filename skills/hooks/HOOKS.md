# Scanner Hooks

Mechanical guardrails that run at Claude Code lifecycle events during active scanner sessions. Unlike the guardrail text in each `SKILL.md`, these hooks enforce boundaries in code — the model cannot override them by reasoning.

---

## How session scoping works

All three hooks are scoped to active scanner sessions only. They do nothing during regular coding or other Claude Code sessions.

**Scope mechanism:** Each SKILL.md bootstrap writes a sentinel file at `~/.ai-toolkit/.scanner-session` when the skill starts. Hooks check for this file and its age. If absent or older than 60 minutes, the hook exits 0 immediately without inspecting the tool call.

---

## Hook 1 — no-exfiltration.sh

**Lifecycle event:** `PreToolUse`

**When it runs:** Before every `Write` or `Bash` tool call during a scanner session.

**What it blocks:**
- Any `Write` tool call (regardless of path) — findings must stay in the conversation, not be written to disk
- `Bash` commands containing `curl -X POST` or `wget --post-data` to external URLs — findings must not be sent to webhooks
- `Bash` commands writing scan-named files to `/tmp/` (e.g. `> /tmp/scan-results.json`)

**What it allows:**
- All `Read`, `Edit`, and other tool calls
- `Bash` read-only commands
- `Bash` API calls to the declared scan endpoints (Azure, Endorlabs, SonarCloud)

**On block:** exits 2 with a message explaining that findings must stay in the conversation.

---

## Hook 2 — read-only-check.sh

**Lifecycle event:** `PreToolUse`

**When it runs:** Before every `Bash` tool call during a scanner session.

**What it blocks:**
- `az security` commands with write verbs: `update`, `patch`, `delete`, `create`, `set`, `dismiss`, `resolve`, `suppress`
- `curl`/`az rest` calls with `PUT`, `POST`, `PATCH`, `DELETE` methods to `management.azure.com/...Microsoft.Security/...`
- `curl` calls with write methods to `api.endorlabs.com`
- `curl` calls to `sonarcloud.io/api/issues/do_transition`, `resolve`, `dismiss`, or any write method to SonarCloud

**What it allows:**
- All read operations: `az security assessment list`, `GET` to any endpoint
- Non-Bash tool calls

**On block:** exits 2 naming the platform and redirecting to the appropriate UI (Azure Portal / Endorlabs console / SonarCloud UI).

---

## Hook 3 — no-credential-echo.sh

**Lifecycle event:** `PostToolUse`

**When it runs:** After every `Bash` tool call during a scanner session, scanning the output.

**What it blocks (patterns detected):**
- Bearer tokens: `Bearer [base64 string 20+ chars]` — catches Azure JWT tokens
- Subscription UUIDs: UUID pattern adjacent to `AZURE_SUBSCRIPTION_ID` label
- SonarCloud tokens: `sqp_...` or `squ_...` prefixes
- Endorlabs credentials: long strings adjacent to `API_CREDENTIALS_KEY` or `API_CREDENTIALS_SECRET` labels

**What it allows:**
- Set/not-set status output: `AZURE_SUBSCRIPTION_ID: set ✓`
- All non-Bash tool output

**On block:** exits 2 with the credential type found and instruction to use set/not-set status only.

---

## Installing hooks

The SKILL.md bootstrap installs hooks automatically on first run. To install manually:

```bash
mkdir -p ~/.claude/hooks
curl -sL https://raw.githubusercontent.com/Petersobhy/ai-toolkit/main/skills/hooks/no-exfiltration.sh \
  -o ~/.claude/hooks/ai-toolkit-no-exfiltration.sh
curl -sL https://raw.githubusercontent.com/Petersobhy/ai-toolkit/main/skills/hooks/read-only-check.sh \
  -o ~/.claude/hooks/ai-toolkit-read-only-check.sh
curl -sL https://raw.githubusercontent.com/Petersobhy/ai-toolkit/main/skills/hooks/no-credential-echo.sh \
  -o ~/.claude/hooks/ai-toolkit-no-credential-echo.sh
chmod +x ~/.claude/hooks/ai-toolkit-*.sh
```

Then wire them in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "bash ~/.claude/hooks/ai-toolkit-no-exfiltration.sh" },
        { "type": "command", "command": "bash ~/.claude/hooks/ai-toolkit-read-only-check.sh" }
      ]}
    ],
    "PostToolUse": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "bash ~/.claude/hooks/ai-toolkit-no-credential-echo.sh" }
      ]}
    ]
  }
}
```

## Running tests

```bash
bash skills/hooks/test-hooks.sh
```

Expected: 19 passed, 0 failed.
