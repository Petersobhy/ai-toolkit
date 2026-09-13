# ai-toolkit

[![SkillShield](https://skillshield.io/api/v1/badge/54960b55711e0bbf.svg)](https://skillshield.io/report/54960b55711e0bbf)

A growing library of reusable AI skills for Claude Code — each addition maps to a real use case, not a hypothetical one.

## Installing skills

```bash
npx skills add Petersobhy/ai-toolkit
```

Select the skills you want from the interactive picker. Restart Claude Code after installing.

Skills are installed to `~/.claude/commands/`. Companion scripts download automatically on first use — no separate install step needed.

## Available skills

| Skill | Trigger words | Setup |
|---|---|---|
| [defender-scan](skills/defender-scan/SKILL.md) | defender, defender for cloud, azure security | `AZURE_SUBSCRIPTION_ID` + `az login` |
| [endorlabs-scan](skills/endorlabs-scan/SKILL.md) | endorlabs, endor scan, scan for vulnerabilities | `ENDOR_NAMESPACE`, `ENDOR_ORG` + endor-cli-tools MCP |
| [sonarcloud-scan](skills/sonarcloud-scan/SKILL.md) | sonarcloud, sonar scan, SAST scan | `SONAR_TOKEN`, `SONAR_ORG` |

Full index with guardrails: [skills/README.md](skills/README.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a skill.
