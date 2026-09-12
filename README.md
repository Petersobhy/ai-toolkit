# ai-toolkit

A private, growing library of AI-assisted workflows, skills, and tooling for the squad.

Built incrementally alongside the team's AI upskilling journey — each addition maps to a real use case, not a hypothetical one.

## What's here

| Folder | Contents |
|---|---|
| `skills/` | Claude Code skill files — reusable AI-assisted procedures |
| `workflows/` | Documented AI-assisted workflows (coming soon) |
| `cli/` | Skill installer CLI — `npx @integrant/ai-toolkit` |

## Installing a skill

### Manual (now)

Copy the skill file into your global Claude Code agents directory:

```bash
cp skills/<skill-name>.md ~/.claude/agents/<skill-name>.md
```

Restart Claude Code. The skill is now available in any session.

### CLI (recommended)

```bash
npx @integrant/ai-toolkit list                  # see available skills
npx @integrant/ai-toolkit add endorlabs-scan    # install one skill
npx @integrant/ai-toolkit add --all             # install all skills
npx @integrant/ai-toolkit update                # update installed skills
```

Fetches skill files from this repo and writes them to `~/.claude/agents/` — no skill file ever lands in a client repo. Requires Node 18+. No additional dependencies.

## Contributing a skill

1. Write and test the skill locally in `~/.claude/agents/`
2. Copy the file into `skills/` in this repo
3. Strip any client-specific values — use placeholders (see `skills/README.md`)
4. Open a PR with a sample run in the description
