# Contributing to ai-toolkit

Developer guide for maintaining the repo, adding skills, and understanding the release process.

---

## Repo structure

```
ai-toolkit/
├── skills/               # Claude Code skill files (one .md per skill)
├── cli/                  # npm CLI — @petersobhy/ai-toolkit
│   ├── index.js          # CLI entry point (no external dependencies)
│   ├── package.json      # npm package config
│   └── .releaserc.json   # semantic-release config
├── .github/
│   └── workflows/
│       └── publish.yml   # CI: runs semantic-release on every push to main
└── CONTRIBUTING.md       # this file
```

---

## Adding a new skill

1. Write and test the skill locally in `~/.claude/agents/<skill-name>.md`
2. Add a `version: 1.0.0` field to the YAML frontmatter
3. Strip all client-specific values — replace with `<YOUR_NAMESPACE>`, `<YOUR_ORG>`, etc.
4. Copy the file to `skills/<skill-name>.md`
5. Open a PR with a sample run output in the description
6. Use a `feat:` commit message — this triggers a minor version bump on merge

Skill frontmatter structure:
```yaml
---
name: skill-name
description: "Short description with trigger words (max 1,536 chars combined with when_to_use)."
when_to_use: "Detailed guidance on when Claude should invoke this skill."
allowed-tools: Bash Read mcp__your-server__tool_name
metadata:
  version: 1.0.0
---
```

---

## Semantic-release — how it works

Every push to `main` triggers the release workflow. semantic-release reads the commit messages since the last release, determines the version bump, publishes to npm, and creates a GitHub release — automatically.

**No manual tagging. No manual npm publish.**

### Commit message format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

[optional body]
```

### Version bump rules

| Commit type | Example | Version bump |
|---|---|---|
| `feat:` | `feat: add terraform-plan skill` | Minor (1.0.0 → 1.1.0) |
| `fix:` | `fix: correct trigger words in endorlabs-scan` | Patch (1.0.0 → 1.0.1) |
| `docs:` | `docs: update install instructions` | No release |
| `chore:` | `chore: update node version in workflow` | No release |
| `refactor:` | `refactor: simplify CLI fetch logic` | No release |
| `BREAKING CHANGE:` | footer in commit body | Major (1.0.0 → 2.0.0) |

### Breaking change example

```
feat: rename add command to install

BREAKING CHANGE: `ai-toolkit add` is now `ai-toolkit install`.
Users must update any scripts that call `add`.
```

---

## Updating a skill

1. Edit `skills/<skill-name>.md` locally
2. Bump the `version:` field in the frontmatter manually (patch or minor)
3. Commit with `fix:` (bug/correction) or `feat:` (new capability)
4. Push to main — the CLI package version bumps automatically

---

## Maintaining the CLI

The CLI (`cli/index.js`) has no external dependencies — keep it that way. All logic uses Node built-ins (`https`, `fs`, `path`, `os`).

If a new command is needed:
1. Add a `cmdXxx` async function
2. Register it in the `commands` map in `main()`
3. Update the usage block in `main()`
4. Use a `feat:` commit — triggers a minor bump

---

## Release workflow

The workflow at `.github/workflows/publish.yml` runs on every push to `main`.

| Step | What it does |
|---|---|
| Checkout (full history) | semantic-release needs the full git log to determine the bump |
| Install semantic-release | Installs plugins globally — no lockfile needed |
| Run semantic-release | Analyzes commits, bumps version in `package.json`, publishes to npm, creates GitHub release |

**Required secrets** (set in repo Settings → Secrets → Actions):

| Secret | Purpose |
|---|---|
| `NPM_TOKEN` | Granular npm token with publish + bypass 2FA. Scope: all packages. |
| `GITHUB_TOKEN` | Automatically provided by GitHub Actions — no setup needed. |

---

## Local testing before PR

Test the CLI against the live repo before opening a PR:

```bash
node cli/index.js list
node cli/index.js add <skill-name>
node cli/index.js update
```

No build step needed — the CLI runs directly with Node 18+.
