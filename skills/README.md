# Skills

Claude Code skill files. Each file is a self-contained procedure that Claude follows when triggered by a matching prompt.

## Structure of a skill file

```markdown
---
name: skill-name
description: "Short description with trigger words (max 1,536 chars combined with when_to_use)."
when_to_use: "Detailed guidance on when Claude should invoke this skill."
allowed-tools: Bash Read Grep mcp__your-server__tool_name
metadata:
  version: 1.0.0
---

# Skill Title

Steps Claude follows...
```

Key fields:
- `description` + `when_to_use` — combined max 1,536 chars; put trigger words in `description`, detail in `when_to_use`
- `allowed-tools` — pre-approves tools without per-use prompts; use `mcp__<server>__<tool>` format for MCP tools
- `metadata.version` — skill version (not an official frontmatter field; stored under `metadata`)

## Rules for contributed skills

> **This is a public repo.** Every skill file is visible to anyone on the internet. The first rule below is a merge blocker — PRs that contain client-specific values will not be merged.

- **No client-specific values** *(merge blocker)* — replace tenant names, org slugs, namespaces, and endpoints with `<YOUR_NAMESPACE>`, `<YOUR_ORG>`, etc. before opening a PR
- **Trigger words must be explicit** — list them in the `description` frontmatter field
- **Include a Prerequisites section** — list any MCP servers, env vars, or tools required
- **Test before PR** — paste a sample run output in the PR description as evidence

## Installing a skill locally

```bash
cp <skill-name>.md ~/.claude/agents/<skill-name>.md
```

Then restart Claude Code.
