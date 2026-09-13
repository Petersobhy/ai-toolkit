# Contributing to ai-toolkit

Developer guide for maintaining the repo and adding skills.

---

## Repo structure

```
ai-toolkit/
├── skills/               # Claude Code skill files
│   ├── <skill-name>/
│   │   ├── SKILL.md      # skill definition (required)
│   │   ├── scan.mjs      # companion script (if needed)
│   │   ├── scan.test.mjs # tests for companion script (required if script exists)
│   │   └── evals/
│   │       └── evals.json  # structured test cases
│   └── README.md         # skills index
├── .github/
│   └── workflows/
│       ├── test.yml      # runs companion script tests on every push
│       └── security.yml  # NVIDIA skillspector scan, SARIF to GitHub Security
└── CONTRIBUTING.md       # this file
```

---

## Adding a new skill

1. Write and test the skill locally in `~/.claude/commands/<skill-name>.md`
2. Create `skills/<skill-name>/SKILL.md` — strip all client-specific values, replace with `<YOUR_NAMESPACE>`, `<YOUR_ORG>`, etc.
3. If the skill needs a companion script, add `scan.mjs` and write tests in `scan.test.mjs`
4. Add `evals/evals.json` with at least a happy-path test and one guardrail test
5. Add a bootstrap block in the Prerequisites section of `SKILL.md` (see existing skills for the curl pattern)
6. Run tests: `node --test skills/<skill-name>/scan.test.mjs`
7. Add the skill to the index table in `skills/README.md`
8. Open a PR with a sample run output in the description

**`SKILL.md` frontmatter structure:**
```yaml
---
name: skill-name
description: "Short description with trigger words (max 1,536 chars combined with when_to_use)."
when_to_use: "Detailed guidance on when Claude should invoke this skill."
allowed-tools: Bash Read mcp__your-server__tool_name
arguments:
  - name: severity
    description: "..."
    default: critical
argument-hint: "[severity: critical|high|medium|all] [repo-name]"
metadata:
  version: 1.0.0
---
```

**Companion script bootstrap (copy this pattern into Prerequisites):**
```bash
[ -f ~/.ai-toolkit/scripts/<skill-name>/scan.mjs ] || {
  mkdir -p ~/.ai-toolkit/scripts/<skill-name>
  curl -sL https://raw.githubusercontent.com/Petersobhy/ai-toolkit/main/skills/<skill-name>/scan.mjs \
    -o ~/.ai-toolkit/scripts/<skill-name>/scan.mjs
}
ls ~/.ai-toolkit/scripts/<skill-name>/scan.mjs
```

**Companion script conventions:**
- Use `.mjs` (ESM) with no external npm dependencies — Node built-ins only
- Export all pure functions so they can be imported by tests
- Guard the CLI entrypoint: `if (process.argv[1] === fileURLToPath(import.meta.url)) { main()... }`
- Output structured JSON to stdout; print errors to stderr with a non-zero exit code

**Test conventions:**
- Use `node:test` + `node:assert/strict` (no external test runner)
- Test pure functions: argument parsing, data mapping, filtering, output shape
- Run with: `node --test skills/<skill-name>/scan.test.mjs`

---

## Updating a skill

1. Edit `skills/<skill-name>/SKILL.md` (and companion scripts if present)
2. Bump `metadata.version` in `SKILL.md` frontmatter
3. Update `skills.json` version field for that skill
4. Run tests if a companion script changed
5. Push to main — CI runs tests and security scan automatically

No publishing step needed. skills.sh picks up changes from main automatically. Companion scripts are downloaded directly from GitHub by the bootstrap in each SKILL.md.

---

## Testing locally

```bash
# Test companion scripts
node --test skills/defender-scan/scan.test.mjs
node --test skills/sonarcloud-scan/scan.test.mjs

# Install a skill via skills.sh
npx skills add Petersobhy/ai-toolkit
```
