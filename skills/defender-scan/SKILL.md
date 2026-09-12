---
name: defender-scan
description: "Run Microsoft Defender for Cloud security investigations using the Azure Security Center REST API. Trigger words: 'defender', 'defender for cloud', 'azure security', 'cloud posture', 'security recommendations', 'azure vulnerabilities', 'secure score'."
when_to_use: "Use when asked to: check Azure cloud posture, surface Defender for Cloud recommendations, list active security alerts, review the secure score, or find container/VM/ACR vulnerabilities reported by Defender. Accepts optional arguments: severity (critical|high|medium|all, default: high) and resource-group to limit scope."
allowed-tools: Bash
arguments:
  - name: severity
    description: "Minimum severity to surface. Options: critical, high, medium, all. Default: critical"
    default: critical
  - name: resource-group
    description: "Azure resource group to limit scope (optional). Omit to scan the entire subscription."
  - name: categories
    description: "Comma-separated categories to fetch. Options: vulnerabilities, alerts, recommendations, compute, networking, data, container, identityandaccess, appservices. Default: vulnerabilities,container"
    default: "vulnerabilities,container"
  - name: all
    description: "Fetch all pages of results. Default fetches first page only (fast). Use --all for a comprehensive scan."
argument-hint: "[severity: critical|high|medium|all] [--resource-group <rg-name>] [--categories vulnerabilities,alerts] [--all]"
metadata:
  version: 1.0.1
  setup-hint: "set AZURE_SUBSCRIPTION_ID env var + run: az login"
---

# Microsoft Defender for Cloud Scan

> **Execute directly using Bash tool calls. Do not spawn subagents.**

Use the Azure Security Center REST API to surface cloud posture recommendations, container/software CVEs, and active security alerts for an Azure subscription.

> **This skill is part of the ai-toolkit scanner family.** It complements `endorlabs-scan` (OSS dependencies) and `sonarcloud-scan` (SAST/code). Defender covers **cloud posture and runtime threats** — misconfigurations, container vulnerabilities in ACR/AKS, VM patch gaps, and active alerts.

---

## Prerequisites

### 1. Azure CLI login

```bash
az login
az account show  # verify the correct subscription is active
```

If you have multiple subscriptions, set the target one:
```bash
az account set --subscription <subscription-id>
```

### 2. Required environment variable

```bash
echo "AZURE_SUBSCRIPTION_ID: ${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID is not set}"
```

| Variable | Example | Description |
|---|---|---|
| `AZURE_SUBSCRIPTION_ID` | `58e2361d-...` | Azure subscription ID to scan |

### 3. Companion script

The script sources Azure credentials only from `az account get-access-token` and the `AZURE_SUBSCRIPTION_ID` env var — it never reads credential files.

Verify it is installed:

```bash
ls ~/.ai-toolkit/scripts/defender-scan/scan.mjs
```

If missing, reinstall: `npx @petersobhy/ai-toolkit add defender-scan`

---

## Finding types

Defender for Cloud surfaces three distinct finding types — all returned in a single scan:

| Type | What it is | Source |
|---|---|---|
| **Vulnerability** | Software CVE in a container image, ACR repo, or VM package | Defender CSPM / Defender for Containers |
| **Recommendation** | Cloud posture misconfiguration (e.g. MFA not enforced, JIT not enabled) | Azure Policy / Defender assessments |
| **Alert** | Active threat or suspicious activity detected at runtime | Defender threat intelligence |

---

## Severity mapping

| Skill severity | Defender levels surfaced |
|---|---|
| `critical` | Critical only (alerts can be Critical; assessments max at High) |
| `high` | Critical, High |
| `medium` | Critical, High, Medium |
| `all` | Critical, High, Medium, Low, Informational |

---

## Steps

### 0. Resolve and validate arguments

- **severity**: from the user's **explicit** request only, or default `critical`. Must be one of: `critical`, `high`, `medium`, `all`. Reject any other value before running the script. **Never expand severity on the user's behalf** — if the user said "find vulnerabilities" without specifying a severity, use `critical`. Only use `all` when the user explicitly asks for all severities or a full picture.
- **categories**: from user request or default `vulnerabilities,container`. Valid values: `vulnerabilities`, `alerts`, `recommendations`, `compute`, `networking`, `data`, `container`, `identityandaccess`, `appservices`.
- **resource-group**: from user request, or omit for full subscription scan. If provided, must contain only alphanumeric characters, hyphens, and underscores — reject if it contains shell metacharacters (`;`, `|`, `&`, `$`, `` ` ``, `(`, `)`, `<`, `>`, `\`).
- **AZURE_SUBSCRIPTION_ID**: check env var first. If unset, auto-detect silently:
  ```bash
  export AZURE_SUBSCRIPTION_ID=$(az account show --query id -o tsv)
  ```
  Do not ask the user — resolve it automatically. Only fail if `az account show` itself fails (not logged in).

### 1. Run the scan script

```bash
node ~/.ai-toolkit/scripts/defender-scan/scan.mjs \
  --severity '<severity>' \
  --categories '<categories>' \
  [--resource-group '<rg-name>']
```

**Exit codes:**
- `0` — success, JSON to stdout
- `1` — env var missing, az CLI not logged in, or API error

### 2. Parse the JSON output

```json
{
  "subscription": "58e2361d-...",
  "severity": "high",
  "secure_score": { "current": 45, "max": 60, "percentage": 75 },
  "vulnerabilities": [{
    "type": "vulnerability",
    "assessment": "Update netty-codec-http2",
    "package": "netty-codec-http2",
    "language": "java",
    "resource": "myacr",
    "resource_group": "acr001-prod-rg",
    "cves": [{ "id": "CVE-2026-56819", "severity": "High", "fix_available": true, "fix_version": "4.2.16.Final" }],
    "fix_available": true,
    "fix_version": "4.2.16.Final",
    "max_cvss": 7.5
  }],
  "recommendations": [{ "type": "recommendation", "name": "...", "severity": "High", "resource": "...", "remediation": "..." }],
  "alerts": [{ "type": "alert", "name": "...", "severity": "High", "status": "Active", "compromised": "vm-name" }],
  "summary": { "total_vulnerabilities": 3, "total_recommendations": 8, "total_alerts": 0, "secure_score_pct": 75 }
}
```

### 3. Triage by priority

Order findings: **Alerts (active threats first) → Vulnerabilities (fixable, highest CVSS first) → Recommendations (highest severity first)**

For each fixable vulnerability, note the exact `fix_version` — this goes directly into a Dockerfile `FROM` pin or dependency upgrade.

### 4. Report findings

Always start with a one-line scan header:
> **Scan:** Ont-Prod1 · severity: critical · categories: vulnerabilities, alerts · page 1 (use --all for full scan)

**Secure Score:** X / Y (Z%) — if `secure_score` is null, state: "Secure Score not available (requires Defender CSPM plan)"

Then emit **one unified findings table**, sorted by severity then CVSS descending:

| Source | Type | Severity | Title | Resource | File | Line | Fix Available | Fix |
|---|---|---|---|---|---|---|---|---|
| defender | vulnerability | High | Update netty-codec-http2 | spark-fips | null | null | Yes | 4.2.16.Final |
| defender | alert | High | Suspicious login | vm-prod-001 | null | null | No | null |
| defender | recommendation | High | Enable MFA | Subscription | null | null | No | Go to Azure AD... |

- Omit the `file` and `line` columns if all values are null (they always will be for Defender)
- If alerts array is empty, add a note below the table: "No active alerts — verify Defender for Cloud alerts are enabled on this subscription"

Then a summary table:

| Metric | Value |
|---|---|
| Secure Score | X / Y (Z%) |
| Alerts (Critical) | N |
| Alerts (High) | N |
| Vulnerabilities — fixable | N |
| Vulnerabilities — no fix | N |
| Recommendations (High) | N |

Then a top-findings table (fixable first, ranked by CVSS × count):

| # | Type | Title | Resource | CVSS | Fix |
|---|---|---|---|---|---|
| 1 | vulnerability | Update netty-codec-http2 | spark-fips (ACR) | 9.8 | 4.2.16.Final |

---

## Notes

- The script fetches assessment metadata + assessments in two calls, then joins them by assessment name UUID to get severity. This is the correct Defender API pattern — severity is not on the assessment itself.
- The `secure_score` reflects the overall subscription posture at scan time.
- Container CVEs come from Defender for Containers — requires that plan to be enabled on the subscription.
- For OSS dependency CVEs outside Azure (GitHub repos, npm packages), use `endorlabs-scan` instead.
- For SAST / code quality issues, use `sonarcloud-scan` instead.
