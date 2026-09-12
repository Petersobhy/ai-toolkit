#!/usr/bin/env node
// Reads metadata.version from each skills/*/SKILL.md and writes skills.json

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const OUT_FILE   = path.join(__dirname, '..', 'skills.json');

function parseVersion(content) {
  const nested = content.match(/^metadata:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+version:\s*(.+)$/m);
  if (nested) return nested[1].trim();
  const top = content.match(/^version:\s*(.+?)$/m);
  return top ? top[1].trim() : null;
}

function parseSetupHint(content) {
  const m = content.match(/^[ \t]+setup-hint:\s*"?(.+?)"?\s*$/m);
  return m ? m[1].trim() : null;
}

const today = new Date().toISOString().slice(0, 10);
const manifest = {};

for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skillFile = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
  if (!fs.existsSync(skillFile)) continue;
  const content = fs.readFileSync(skillFile, 'utf8');
  const version   = parseVersion(content);
  const setupHint = parseSetupHint(content);
  manifest[entry.name] = { version: version ?? '0.0.0', updated: today, ...(setupHint && { setupHint }) };
}

fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2) + '\n');
console.log(`skills.json written with ${Object.keys(manifest).length} skills:`);
for (const [name, { version }] of Object.entries(manifest)) {
  console.log(`  ${name} v${version}`);
}
