---
name: endorlabs-scan
description: "Run Endorlabs security investigations using the endor-cli-tools MCP. Trigger words: 'endorlabs', 'endor scan', 'scan for vulnerabilities', 'check dependencies', 'CVE lookup', 'security scan', 'dependency risks'."
when_to_use: "Use when asked to: scan a repo for vulnerabilities, check a dependency for CVEs, investigate security risks, look up a CVE in Endorlabs, run a security review on code changes, or audit open source dependencies. Accepts optional arguments: severity (critical|high|medium|all, default: high) and repo name."
allowed-tools: mcp__endor-cli-tools__get_resource mcp__endor-cli-tools__check_dependency_for_vulnerabilities mcp__endor-cli-tools__check_dependency_for_risks mcp__endor-cli-tools__get_endor_vulnerability mcp__endor-cli-tools__security_review
arguments:
  - name: severity
    description: "Minimum severity to surface. Options: critical, high, medium, all. Default: critical"
    default: critical
  - name: repo
    description: "Repository name to scan (e.g. my-service). Omit to scan the current directory's repo."
  - name: categories
    description: "Comma-separated finding categories to fetch. Options: sca, vulnerability, secrets, security, operational. Default: sca,vulnerability"
    default: "sca,vulnerability"
argument-hint: "[severity: critical|high|medium|all] [repo-name] [--categories sca,vulnerability,secrets,security,operational]"
metadata:
  version: 1.2.0
  setup-hint: "set ENDOR_NAMESPACE, ENDOR_ORG env vars + connect endor-cli-tools MCP"
---

# Endorlabs Security Scan

> **Execute directly using MCP tool calls. Do not spawn subagents.**

Use the `endor-cli-tools` MCP server to fetch existing findings and investigate CVEs for a specific repository or dependency.

> **This skill is distinct from `endor-digest`** which produces a bulk estate-wide count. This skill investigates a *specific* repo, package, or CVE — with severity filtering and actionable triage.

---

## Prerequisites

### 1. MCP connection

Verify the MCP server is connected:
```
claude mcp list
```
`endor-cli-tools` must show `✓ Connected`. If it shows `✗ Failed`:

1. Run `endorctl auth login` and follow the browser prompt
2. Verify credentials: `endorctl config get`
3. Restart Claude Code and retry

If the MCP server still fails to connect, check that `endorctl` is on your PATH and that your Endor Labs API token has the correct scopes (namespace read + findings read).

### 2. Required environment variables

This skill reads namespace and org from env vars. Fail clearly if either is unset:

```bash
echo "ENDOR_NAMESPACE: ${ENDOR_NAMESPACE:?ENDOR_NAMESPACE is not set — export it before running this skill}"
echo "ENDOR_ORG: ${ENDOR_ORG:?ENDOR_ORG is not set — export it before running this skill}"
```

| Variable | Example | Description |
|---|---|---|
| `ENDOR_NAMESPACE` | `myorg.myteam` | Your Endorlabs namespace |
| `ENDOR_ORG` | `my-github-org` | Your SCM org slug (GitHub/Bitbucket) |

If either is unset, stop and tell the user to set them before retrying.

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

### 0. Resolve arguments

- **severity**: from user request or default `critical`. Map to level filter: `critical` → `FINDING_LEVEL_CRITICAL`; `high` → `FINDING_LEVEL_HIGH,FINDING_LEVEL_CRITICAL`; `medium` → includes MEDIUM+; `all` → no level filter.
- **categories**: from user request or default `sca,vulnerability`. Map each to Endor category values:
  - `sca` → `FINDING_CATEGORY_SCA`
  - `vulnerability` → `FINDING_CATEGORY_VULNERABILITY`
  - `secrets` → `FINDING_CATEGORY_SECRETS`
  - `security` → `FINDING_CATEGORY_SECURITY`
  - `operational` → `FINDING_CATEGORY_OPERATIONAL`
- **repo**: from user request, or infer from current directory name if running inside a git repo.
- **namespace / org**: from `$ENDOR_NAMESPACE` and `$ENDOR_ORG`. If unset, stop with a clear error message.

### 1. Check if the project is onboarded in Endorlabs

Always fetch existing results first — never run a local scan unless necessary.

```
get_resource(
  resource_type: "Project",
  namespace: "$ENDOR_NAMESPACE",
  name: "namespaces/$ENDOR_NAMESPACE/projects/<scm>.com/$ENDOR_ORG/<repo>",
  fields: ["uuid", "meta.name"]
)
```

- **Project found** → proceed to Step 2
- **Project not found** → stop and inform the user: the repo needs to be onboarded in Endorlabs before results can be fetched. Do not proceed with a local scan unless the user explicitly asks.

### 2. Fetch existing findings

Apply the category filter from Step 0. Build the `filter` expression as:
```
spec.finding_categories contains "FINDING_CATEGORY_SCA" or spec.finding_categories contains "FINDING_CATEGORY_VULNERABILITY"
```
(adjust the `or` clauses to match the resolved categories list)

```
get_resource(
  resource_type: "Finding",
  namespace: "$ENDOR_NAMESPACE",
  name: "namespaces/$ENDOR_NAMESPACE/findings",
  filter: "<category filter expression>",
  fields: ["uuid", "meta.name", "spec.level", "spec.summary", "spec.remediation", "spec.finding_categories", "spec.finding_tags", "spec.target_dependency_package_name", "spec.target_dependency_version", "spec.ecosystem"]
)
```

### 3. Triage — filter by severity and summarize

Apply the severity filter from Step 0. Group findings: **Critical → High → Medium → Low** (stop at the requested minimum severity).

For each finding at or above the requested severity, capture:
- Category (from `spec.finding_categories` — e.g. SCA, Secrets, Security)
- Package name + version (`spec.target_dependency_package_name`, `spec.target_dependency_version`)
- CVE ID if applicable (call `get_endor_vulnerability` for full details if needed)
- Whether a fix version exists (`spec.remediation`)
- Reachability from `spec.finding_tags`: `FINDING_TAGS_REACHABLE_FUNCTION` = reachable, `FINDING_TAGS_POTENTIALLY_REACHABLE_FUNCTION` = potentially reachable
- Fix available: `FINDING_TAGS_FIX_AVAILABLE` in tags

Skip findings below the requested severity entirely — do not mention them unless the user asks.

### 4. Report findings

Always start with a one-line scan header:
> **Scan:** my-service · severity: critical · categories: sca, vulnerability · page 1 (use --all for full scan)

Then emit **one unified findings table**, sorted by severity then reachability (reachable first):

| Source | Type | Severity | Title | Repo | File | Line | Resource | Fix Available | Fix |
|---|---|---|---|---|---|---|---|---|---|
| endorlabs | sca | FINDING_LEVEL_CRITICAL | CVE-2021-44228 in log4j | my-service | null | null | log4j:2.14.1 | Yes | 2.17.1 |
| endorlabs | secrets | FINDING_LEVEL_CRITICAL | Exposed API key | my-service | src/config.ts | 12 | null | No | null |

- `File` and `Line` are populated when the finding includes location data (secrets, some security findings)
- `Resource` = `package:version` for SCA/vulnerability findings, null otherwise

Then a summary table:

| Metric | Value |
|---|---|
| Repo | org/repo |
| Critical findings | N |
| High findings | N |
| Fixable | N |
| Reachable | N |
| Potentially reachable | N |

Then a top-findings table (reachable + fixable first, highest severity first):

| # | Type | Title | Resource | Severity | Reachable | Fix |
|---|---|---|---|---|---|---|
| 1 | sca | CVE-2021-44228 | log4j:2.14.1 | FINDING_LEVEL_CRITICAL | Yes | 2.17.1 |

---

## Notes

- Always fetch existing results first — `get_resource` queries the Endorlabs platform and requires no special network access beyond `api.endorlabs.com`.
- The `scan` tool runs endorctl locally (reads source files) and sends data to `api.oss.endorlabs.com`. It is intentionally excluded from `allowed-tools` — use it only as a last resort when the repo is not yet onboarded, and only after the user explicitly approves the tool call.
- Do not invoke `endorctl` directly from the CLI — always use the MCP tools.
- This skill investigates a specific repo or package. For a bulk estate-wide digest across all namespaces, use the `endor-digest` skill instead.
