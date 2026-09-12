# ai-toolkit

[![SkillShield](https://skillshield.io/api/v1/badge/54960b55711e0bbf.svg)](https://skillshield.io/report/54960b55711e0bbf)

A growing library of AI-assisted skills and tooling for the squad — each addition maps to a real use case, not a hypothetical one.

## What's here

| Folder | Contents |
|---|---|
| `skills/` | Claude Code skill files — reusable AI-assisted procedures |
| `cli/` | Skill installer CLI — `npx @petersobhy/ai-toolkit` |

## Installing a skill

Requires Node 18+. No additional dependencies.

```bash
npx @petersobhy/ai-toolkit list                  # see available skills
npx @petersobhy/ai-toolkit add endorlabs-scan    # install one skill
npx @petersobhy/ai-toolkit add --all             # install all skills
npx @petersobhy/ai-toolkit update                # update installed skills
```

Skills are installed to `~/.claude/agents/` — no skill file ever lands in a client repo. Restart Claude Code after installing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a skill, commit conventions, and the release process.
