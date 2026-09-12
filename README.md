# ai-toolkit

A private, growing library of AI-assisted workflows, skills, and tooling for the squad.

Built incrementally alongside the team's AI upskilling journey — each addition maps to a real use case, not a hypothetical one.

## What's here

| Folder | Contents |
|---|---|
| `skills/` | Claude Code skill files — reusable AI-assisted procedures |
| `workflows/` | Documented AI-assisted workflows (coming soon) |
| `cli/` | Skill installer CLI (coming soon) |

## Installing a skill

Copy the skill file into your global Claude Code agents directory:

```bash
cp skills/<skill-name>.md ~/.claude/agents/<skill-name>.md
```

Restart Claude Code. The skill is now available in any session.

## Contributing a skill

1. Write and test the skill locally in `~/.claude/agents/`
2. Copy the file into `skills/` in this repo
3. Strip any client-specific values — use placeholders (see `skills/README.md`)
4. Open a PR with a sample run in the description
