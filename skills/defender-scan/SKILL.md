---
name: defender-scan
description: "Run Microsoft Defender for Cloud security investigations using the Azure Security Center REST API. Trigger words: 'defender', 'defender for cloud', 'azure security', 'cloud posture', 'security recommendations', 'azure vulnerabilities', 'secure score'."
when_to_use: "Use when asked to: check Azure cloud posture, surface Defender for Cloud recommendations, list active security alerts, review the secure score, or find container/VM/ACR vulnerabilities reported by Defender. Accepts optional arguments: severity (critical|high|medium|all, default: high) and resource-group to limit scope."
allowed-tools: Bash
arguments:
  - name: severity
    description: "Minimum severity to surface. Options: critical, high, medium, all. Default: high"
    default: high
  - name: resource-group
    description: "Azure resource group to limit scope (optional). Omit to scan the entire subscription."
argument-hint: "[severity: critical|high|medium|all] [--resource-group <rg-name>]"
metadata:
  version: 1.0.0
---

# Microsoft Defender for Cloud Scan

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

```bash
ls ~/.claude/agents/scripts/defender-scan/scan.mjs
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

Defender uses High / Medium / Low / Informational (no "Critical" tier):

| Skill severity | Defender levels surfaced |
|---|---|
| `critical` | High only |
| `high` | High, Medium |
| `medium` | High, Medium, Low |
| `all` | High, Medium, Low, Informational |

---

## Steps

### 0. Resolve arguments

- **severity**: from user request or default `high`
- **resource-group**: from user request, or omit for full subscription scan
- **AZURE_SUBSCRIPTION_ID**: from env var — fail clearly if unset

### 1. Run the scan script

```bash
node ~/.claude/agents/scripts/defender-scan/scan.mjs \
  --severity <severity> \
  [--resource-group <rg-name>]
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

**Secure Score:** X / Y (Z%) — include trend if available

**Active Alerts:**

| Alert | Severity | Status | Compromised Resource |
|---|---|---|---|
| Suspicious login | High | Active | vm-prod-001 |

**Software Vulnerabilities (fixable first):**

| Package | CVE | Severity | Fix Version | Resource | RG |
|---|---|---|---|---|---|
| netty-codec-http2 | CVE-2026-56819 | High | 4.2.16.Final | myacr | acr001-prod-rg |

**Cloud Posture Recommendations:**

| Recommendation | Severity | Resource | Remediation |
|---|---|---|---|
| Enable MFA | High | Subscription | Go to Azure AD... |

Follow with:
- Overall risk summary
- Top 3 immediate actions (patch this, fix that, enable this)
- Suggested next action: open a ticket, apply the Dockerfile patch inline, or escalate to the security lead

Do **not** create tickets automatically — suggest the action and let the user decide.

---

## Notes

- The script fetches assessment metadata + assessments in two calls, then joins them by assessment name UUID to get severity. This is the correct Defender API pattern — severity is not on the assessment itself.
- The `secure_score` reflects the overall subscription posture at scan time.
- Container CVEs come from Defender for Containers — requires that plan to be enabled on the subscription.
- For OSS dependency CVEs outside Azure (GitHub repos, npm packages), use `endorlabs-scan` instead.
- For SAST / code quality issues, use `sonarcloud-scan` instead.
