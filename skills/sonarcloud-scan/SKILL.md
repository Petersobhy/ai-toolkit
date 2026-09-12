---
name: sonarcloud-scan
description: "Run SonarCloud security investigations using the SonarCloud REST API. Trigger words: 'sonarcloud', 'sonar scan', 'sonar vulnerabilities', 'sonar security', 'SAST scan', 'code quality scan', 'sonar issues'."
when_to_use: "Use when asked to: scan a repo for SonarCloud vulnerabilities, check SAST findings, review security hotspots, audit code quality issues with a security focus, or get a SonarCloud security report. Accepts optional arguments: severity (critical|high|medium|all, default: high) and repo name."
allowed-tools: Bash
arguments:
  - name: severity
    description: "Minimum severity to surface. Options: critical, high, medium, all. Default: high"
    default: high
  - name: repo
    description: "Repository name to scan (e.g. my-service). Omit to infer from current git directory."
  - name: categories
    description: "Comma-separated issue categories to fetch. Options: vulnerability, bug, code_smell, hotspot. Default: vulnerability"
    default: "vulnerability"
  - name: all
    description: "Fetch all pages of results. Default fetches first page only (fast). Use --all for a comprehensive scan."
argument-hint: "[severity: critical|high|medium|all] [repo-name] [--categories vulnerability,bug,hotspot] [--all]"
metadata:
  version: 1.0.0
  setup-hint: "set SONAR_TOKEN, SONAR_ORG env vars"
---

# SonarCloud Security Scan

> **Execute directly using Bash tool calls. Do not spawn subagents.**

Use the SonarCloud REST API to fetch existing vulnerability findings and security hotspots for a specific repository.

> **This skill is part of the ai-toolkit scanner family.** It follows the same interface as `endorlabs-scan` — same severity arguments, same output format — so findings from multiple sources can be compared or merged.

---

## Prerequisites

### Required environment variables

```bash
echo "SONAR_TOKEN: ${SONAR_TOKEN:?SONAR_TOKEN is not set — export your SonarCloud API token}"
echo "SONAR_ORG: ${SONAR_ORG:?SONAR_ORG is not set — export your SonarCloud organization key}"
```

| Variable | Example | Description |
|---|---|---|
| `SONAR_TOKEN` | `sqp_abc123...` | SonarCloud API token (generate at sonarcloud.io → Account → Security) |
| `SONAR_ORG` | `my-github-org` | SonarCloud organization key (visible in sonarcloud.io URL: `/organizations/<key>`) |

If either is unset, stop and tell the user to set them before retrying.

### Companion script

This skill uses `scan.mjs` for all API calls. It receives `SONAR_TOKEN` only via environment variable — it never reads credential files.

Verify it is installed:

```bash
ls ~/.ai-toolkit/scripts/sonarcloud-scan/scan.mjs
```

If missing, reinstall the skill: `npx @petersobhy/ai-toolkit add sonarcloud-scan`

---

## Severity mapping

| SonarCloud | Skill severity |
|---|---|
| BLOCKER | critical |
| CRITICAL | critical |
| MAJOR | high |
| MINOR | medium |
| INFO | all only |

---

## Steps

### 0. Resolve and validate arguments

- **severity**: from user request or default `high`. Must be one of: `critical`, `high`, `medium`, `all`. Reject any other value before running the script.
- **repo**: from user request, or infer with `git rev-parse --show-toplevel | xargs basename`. Must contain only alphanumeric characters, hyphens, and underscores — reject if it contains shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, `(`, `)`, `<`, `>`, `\`).
- **env vars**: verify `SONAR_TOKEN` and `SONAR_ORG` are set before proceeding.

### 1. Run the scan script

```bash
node ~/.ai-toolkit/scripts/sonarcloud-scan/scan.mjs \
  --severity '<severity>' \
  --repo '<repo>'
```

The script handles project verification, pagination, severity filtering, and outputs structured JSON.

**Exit codes:**
- `0` — success, JSON printed to stdout
- `1` — env var missing or API error
- `2` — project not found in SonarCloud (repo not onboarded)

If exit code `2`: stop and inform the user the repo needs to be onboarded in SonarCloud before results can be fetched.

### 2. Parse the JSON output

The script returns:
```json
{
  "project": "my-org:my-service",
  "severity": "high",
  "vulnerabilities": [
    { "severity": "CRITICAL", "rule": "...", "file": "src/auth.ts", "line": 42, "message": "...", "effort": "5min" }
  ],
  "hotspots": [
    { "probability": "HIGH", "rule": "...", "file": "src/api.ts", "line": 87, "message": "..." }
  ],
  "summary": { "total_vulnerabilities": 3, "total_hotspots": 1 }
}
```

### 3. Triage

Group vulnerabilities by severity: **BLOCKER → CRITICAL → MAJOR**

Clearly separate hotspots from confirmed vulnerabilities — hotspots require manual review and are not confirmed issues.

### 4. Report findings

**Vulnerabilities:**

| File | Line | Rule | Severity | Issue | Effort |
|---|---|---|---|---|---|
| src/auth/login.ts | 42 | typescript:S2068 | CRITICAL | Hardcoded credentials | 5min |

**Security Hotspots (manual review required):**

| File | Line | Rule | Probability | Issue |
|---|---|---|---|---|
| src/api/handler.ts | 87 | typescript:S4787 | HIGH | Encryption algorithm weak |

Follow with:
- Overall risk summary (X confirmed vulnerabilities, Y hotspots to review)
- Top remediation priorities (highest severity first, lowest effort first)
- Suggested next action: fix inline, open a ticket, or escalate to security lead

Do **not** create tickets automatically — suggest the action and let the user decide.

---

## Notes

- This skill surfaces SAST findings and code vulnerabilities. For OSS dependency CVEs, use `endorlabs-scan`. For cloud posture, use `defender-scan`.
- SonarCloud rate limits: the script adds delays between paginated requests automatically.
- Hotspots are potential vulnerabilities pending human review — treat them as leads, not confirmed issues.
