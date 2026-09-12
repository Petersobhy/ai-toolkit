---
name: endorlabs-scan
description: "Run Endorlabs security investigations using the endor-cli-tools MCP. Use when asked to: scan a repo for vulnerabilities, check a dependency for CVEs, investigate security risks, look up a CVE in Endorlabs, run a security review on code changes, or audit open source dependencies. Trigger words: 'endorlabs', 'endor scan', 'scan for vulnerabilities', 'check dependencies', 'CVE lookup', 'security scan', 'dependency risks'."
---

# Endorlabs Security Scan

Use the `endor-cli-tools` MCP server to fetch existing findings and investigate CVEs.

> **Configure before use:** Replace `<YOUR_NAMESPACE>` with your Endorlabs namespace (e.g. `myorg.myteam`) and `<YOUR_ORG>` with your Bitbucket/GitHub org slug.

---

## Prerequisites

Before running any scan, verify the MCP is connected:
```
claude mcp list
```
`endor-cli-tools` must show `✓ Connected`. If it shows `✗ Failed`, run:
```bash
npm install -g endorctl
```
Then restart Claude Code and retry.

---

## Available MCP Tools

| Tool | When to use |
|---|---|
| `get_resource` | **Primary tool** — fetch existing findings, projects, scan results from Endorlabs platform |
| `check_dependency_for_vulnerabilities` | Check a specific package for known CVEs |
| `check_dependency_for_risks` | Check a package for CVEs + malware + other risks |
| `get_endor_vulnerability` | Get full details on a specific CVE from Endorlabs DB |
| `security_review` | Review a code diff for security issues |
| `scan` | **Last resort only** — local scan when repo is not onboarded. May be blocked by corporate firewall. |

---

## Steps

### 1. Check if the project is onboarded in Endorlabs

Always fetch existing results first — never run a local scan unless necessary.

```
get_resource(
  resource_type: "Project",
  namespace: "<YOUR_NAMESPACE>",
  name: "namespaces/<YOUR_NAMESPACE>/projects/<YOUR_SCM>.com/<YOUR_ORG>/<repo-name>",
  fields: ["uuid", "meta.name"]
)
```

- **Project found** → proceed to Step 2
- **Project not found** → stop and inform the user: the repo needs to be onboarded in Endorlabs before results can be fetched.

### 2. Fetch existing findings

```
get_resource(
  resource_type: "Finding",
  namespace: "<YOUR_NAMESPACE>",
  name: "namespaces/<YOUR_NAMESPACE>/findings",
  fields: ["uuid", "meta.name", "spec.finding_type", "spec.level", "spec.summary", "spec.remediation"]
)
```

### 3. Triage results

Group findings by severity: **Critical → High → Medium → Low**

For each Critical/High finding, capture:
- Package name + version
- CVE ID (call `get_endor_vulnerability` for full details if needed)
- Whether a fix version exists
- Reachability (if provided)

### 4. Create Jira sub-tasks for actionable findings

For each Critical/High CVE with a fix available, create a Sub-task using the `/jira-work-item` skill:
```
<repo>: Remediate <CVE-ID> in <package>
```

### 5. Report summary

| Package | Version | CVE | Severity | Fix Available | Jira |
|---|---|---|---|---|---|
| lodash | 4.17.15 | CVE-2021-23337 | High | 4.17.21 | PROJ-XXXX |

Follow with a short recommendation paragraph.

---

## Notes

- Always fetch existing results first — `get_resource` queries the Endorlabs platform and requires no special network access beyond `api.endorlabs.com`.
- The `scan` tool runs endorctl locally and needs access to `api.oss.endorlabs.com` — use only as a last resort.
- Do not invoke `endorctl` directly from the CLI — always use the MCP tools.
