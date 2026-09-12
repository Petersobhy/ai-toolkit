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
argument-hint: "[severity: critical|high|medium|all] [repo-name]"
metadata:
  version: 1.0.0
---

# SonarCloud Security Scan

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

### SonarCloud project key format

SonarCloud project keys follow the pattern `{org}:{repo}` (e.g. `my-github-org:my-service`). The skill constructs this automatically from `SONAR_ORG` + the repo argument.

---

## Severity mapping

SonarCloud severity levels map to the skill's severity argument:

| SonarCloud | Skill severity |
|---|---|
| BLOCKER | critical |
| CRITICAL | critical |
| MAJOR | high |
| MINOR | medium |
| INFO | all only |

---

## Steps

### 0. Resolve arguments

- **severity**: from user request or default `high`. Map to SonarCloud severities:
  - `critical` → `BLOCKER,CRITICAL`
  - `high` → `BLOCKER,CRITICAL,MAJOR`
  - `medium` → `BLOCKER,CRITICAL,MAJOR,MINOR`
  - `all` → `BLOCKER,CRITICAL,MAJOR,MINOR,INFO`
- **repo**: from user request, or infer from `git rev-parse --show-toplevel | xargs basename` if inside a git repo.
- **project key**: `$SONAR_ORG:$repo`

### 1. Verify the project exists in SonarCloud

```bash
curl -sf -H "Authorization: Bearer $SONAR_TOKEN" \
  "https://sonarcloud.io/api/components/show?component=$SONAR_ORG:$REPO" \
  | jq '.component.key // empty'
```

- **Returns a key** → project is onboarded, proceed to Step 2
- **Returns empty or 404** → stop and inform the user: the repo needs to be onboarded in SonarCloud before results can be fetched

### 2. Fetch vulnerability findings

```bash
curl -sf -H "Authorization: Bearer $SONAR_TOKEN" \
  "https://sonarcloud.io/api/issues/search\
?componentKeys=$SONAR_ORG:$REPO\
&types=VULNERABILITY\
&statuses=OPEN,CONFIRMED,REOPENED\
&severities=$SONAR_SEVERITIES\
&organization=$SONAR_ORG\
&ps=100" \
  | jq '.issues[]'
```

Key fields per issue: `key`, `rule`, `severity`, `component` (file path), `message`, `line`, `effort` (fix time estimate).

### 3. Fetch security hotspots

Security hotspots are potential vulnerabilities that need manual review — fetch them separately:

```bash
curl -sf -H "Authorization: Bearer $SONAR_TOKEN" \
  "https://sonarcloud.io/api/hotspots/search\
?projectKey=$SONAR_ORG:$REPO\
&status=TO_REVIEW\
&ps=100" \
  | jq '.hotspots[]'
```

Key fields: `key`, `ruleKey`, `vulnerabilityProbability` (HIGH/MEDIUM/LOW), `component`, `message`, `line`.

Only include hotspots where `vulnerabilityProbability` is HIGH or MEDIUM (unless severity=all).

### 4. Triage — filter and summarize

Apply the severity filter from Step 0. Group findings:

**Vulnerabilities** (confirmed issues):
- Group by severity: BLOCKER → CRITICAL → MAJOR
- For each: file path + line number, rule ID, description, effort to fix

**Security hotspots** (need manual review):
- Group by probability: HIGH → MEDIUM
- Clearly label these as "requires manual review" — not confirmed vulnerabilities

Skip findings below the requested severity threshold.

### 5. Report findings

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

- SonarCloud API base URL: `https://sonarcloud.io/api/`
- Authentication: `Authorization: Bearer $SONAR_TOKEN` header
- Pagination: default page size 100; if `total > 100`, fetch additional pages with `&p=2`, `&p=3`, etc.
- Rate limits: SonarCloud enforces per-token rate limits; add `sleep 1` between paginated requests if hitting limits
- This skill surfaces SAST findings. For OSS dependency CVEs, use `endorlabs-scan` instead. For cloud posture, use `defender-scan`.
