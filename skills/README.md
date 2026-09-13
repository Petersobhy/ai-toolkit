# Skills index

Claude Code skill files. Each skill lives in its own folder and is a self-contained unit that Claude follows when triggered by a matching prompt.

## Available skills

| Skill | Trigger words | Setup | Guardrails |
|---|---|---|---|
| [defender-scan](defender-scan/SKILL.md) | defender, defender for cloud, azure security, cloud posture, security recommendations | `AZURE_SUBSCRIPTION_ID` + `az login` | Read-only · No lateral movement · No exfiltration · No credential echo |
| [endorlabs-scan](endorlabs-scan/SKILL.md) | endorlabs, endor scan, scan for vulnerabilities, check dependencies, CVE lookup | `ENDOR_NAMESPACE`, `ENDOR_ORG` + endor-cli-tools MCP | Read-only · No lateral movement · No exfiltration · No credential echo |
| [sonarcloud-scan](sonarcloud-scan/SKILL.md) | sonarcloud, sonar scan, sonar vulnerabilities, SAST scan, code quality scan | `SONAR_TOKEN`, `SONAR_ORG` | Read-only · No lateral movement · No exfiltration · No credential echo |

### Install all skills

```bash
# Via skills.sh (multi-agent, interactive)
npx skills add Petersobhy/ai-toolkit

# Via ai-toolkit CLI (installs companion scripts automatically)
npx @petersobhy/ai-toolkit@1 add --all
```

Restart Claude Code after installing.

## Folder structure

```
skills/
├── my-skill/
│   ├── SKILL.md          # skill definition — required
│   ├── scan.mjs          # companion script — if the skill needs to run code
│   └── scan.test.mjs     # tests for the companion script — required if script exists
```

The CLI installs:
- `SKILL.md` → `~/.claude/agents/<skill-name>.md` (Claude Code agents directory)
- Companion scripts → `~/.ai-toolkit/scripts/<skill-name>/` (separate from Claude config)

## Structure of SKILL.md

```markdown
---
name: skill-name
description: "Short description with trigger words (max 1,536 chars combined with when_to_use)."
when_to_use: "Detailed guidance on when Claude should invoke this skill."
allowed-tools: Bash Read mcp__your-server__tool_name
arguments:
  - name: severity
    description: "Minimum severity to surface."
    default: high
argument-hint: "[severity: critical|high|medium|all] [repo-name]"
metadata:
  version: 1.0.0
---

# Skill Title

Steps Claude follows...
```

Key fields:
- `description` + `when_to_use` — combined max 1,536 chars; put trigger words in `description`, detail in `when_to_use`
- `allowed-tools` — pre-approves tools without per-use prompts; use `mcp__<server>__<tool>` format for MCP tools
- `arguments` — named arguments the skill accepts; Claude resolves these from the user's request
- `metadata.version` — skill version (not an official frontmatter field; stored under `metadata`)

## Companion script conventions

- `.mjs` (ESM), no external npm dependencies — Node built-ins only
- Export all pure functions so they can be imported by tests
- Guard the entrypoint: `if (process.argv[1] === fileURLToPath(import.meta.url)) { main()... }`
- Output structured JSON to stdout; errors to stderr with non-zero exit code
- Test with `node:test` + `node:assert/strict`: `node --test skills/<name>/<name>.test.mjs`

## Rules for contributed skills

> **This is a public repo.** Every skill file is visible to anyone on the internet. The first rule below is a merge blocker — PRs that contain client-specific values will not be merged.

- **No client-specific values** *(merge blocker)* — replace tenant names, org slugs, namespaces, and endpoints with `<YOUR_NAMESPACE>`, `<YOUR_ORG>`, etc. before opening a PR
- **Trigger words must be explicit** — list them in the `description` frontmatter field
- **Include a Prerequisites section** — list any MCP servers, env vars, or tools required
- **Test companion scripts** — every `.mjs` must have a `.test.mjs` and all tests must pass
- **Test before PR** — paste a sample run output in the PR description as evidence

## Installing a skill locally

```bash
npx @petersobhy/ai-toolkit add <skill-name>
```

Or manually:
```bash
cp skills/<skill-name>/SKILL.md ~/.claude/agents/<skill-name>.md   # skill definition
mkdir -p ~/.ai-toolkit/scripts/<skill-name>
cp skills/<skill-name>/*.mjs ~/.ai-toolkit/scripts/<skill-name>/   # companion scripts (if any)
```

Then restart Claude Code.
