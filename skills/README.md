# Skills

Claude Code skill files. Each file is a self-contained procedure that Claude follows when triggered by a matching prompt.

## Structure of a skill file

```markdown
---
name: skill-name
description: "One-line description. Include trigger words so Claude knows when to use it."
---

# Skill Title

Steps Claude follows...
```

## Rules for contributed skills

- **No client-specific values** — replace tenant names, org slugs, namespaces, and endpoints with `<YOUR_NAMESPACE>`, `<YOUR_ORG>`, etc.
- **Trigger words must be explicit** — list them in the `description` frontmatter field
- **Include a Prerequisites section** — list any MCP servers, env vars, or tools required
- **Test before PR** — paste a sample run output in the PR description as evidence

## Installing a skill locally

```bash
cp <skill-name>.md ~/.claude/agents/<skill-name>.md
```

Then restart Claude Code.
