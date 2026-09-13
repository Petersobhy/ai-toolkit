#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = 'Petersobhy/ai-toolkit';
const BRANCH = 'main';
const SKILLS_PATH = 'skills';
const INSTALL_DIR = path.join(os.homedir(), '.claude', 'commands');
const SCRIPTS_DIR = path.join(os.homedir(), '.ai-toolkit', 'scripts');
const MANIFEST_FILE = path.join(os.homedir(), '.ai-toolkit', 'installed.json');

const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const API_BASE = `https://api.github.com/repos/${REPO}/contents`;

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ai-toolkit-cli' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

function parseVersion(content) {
  // metadata.version: 1.0.0 (nested under metadata:)
  const nested = content.match(/^metadata:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+version:\s*(.+)$/m);
  if (nested) return nested[1].trim();
  // fallback: top-level version: (legacy)
  const top = content.match(/^version:\s*(.+?)$/m);
  return top ? top[1].trim() : null;
}

// List skill folders from GitHub API (directories only, skip README)
async function listAvailable() {
  const entries = JSON.parse(await get(`${API_BASE}/${SKILLS_PATH}`));
  return entries
    .filter(e => e.type === 'dir')
    .map(e => e.name);
}

function readInstalledManifest() {
  if (!fs.existsSync(MANIFEST_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch { return {}; }
}

function writeInstalledManifest(manifest) {
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

function listInstalled() {
  return Object.keys(readInstalledManifest());
}

// Fetch skill folder contents from GitHub API
async function getSkillContents(name) {
  const entries = JSON.parse(await get(`${API_BASE}/${SKILLS_PATH}/${name}`));
  return entries; // array of { name, type, download_url, ... }
}

async function installSkill(name, manifest = {}) {
  let entries;
  try {
    entries = await getSkillContents(name);
  } catch {
    console.error(`  ✗ ${name} — skill folder not found in repo`);
    return false;
  }

  const skillFile = entries.find(e => e.name === 'SKILL.md');
  if (!skillFile) {
    console.error(`  ✗ ${name} — missing SKILL.md in skill folder`);
    return false;
  }

  // Install SKILL.md → ~/.claude/commands/<name>.md
  const skillContent = await get(`${RAW_BASE}/${SKILLS_PATH}/${name}/SKILL.md`);
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.writeFileSync(path.join(INSTALL_DIR, `${name}.md`), skillContent);

  // Install companion scripts → ~/.ai-toolkit/scripts/<name>/
  const scripts = entries.filter(e =>
    e.type === 'file' &&
    e.name !== 'SKILL.md' &&
    e.name !== 'README.md' &&
    !e.name.endsWith('.test.mjs')
  );
  if (scripts.length > 0) {
    const scriptDir = path.join(SCRIPTS_DIR, name);
    fs.mkdirSync(scriptDir, { recursive: true });
    for (const script of scripts) {
      const content = await get(`${RAW_BASE}/${SKILLS_PATH}/${name}/${script.name}`);
      fs.writeFileSync(path.join(scriptDir, script.name), content);
    }
  }

  const version = manifest[name]?.version;
  const installed = readInstalledManifest();
  installed[name] = { installedAt: new Date().toISOString(), version: version || null };
  writeInstalledManifest(installed);

  console.log(`  ✓ ${name}${version ? ` v${version}` : ''}`);
  return true;
}

function printSetupHints(names, manifest) {
  const hints = names.map(n => [n, manifest[n]?.setupHint]).filter(([, h]) => h);
  if (hints.length === 0) return;
  const pad = Math.max(...hints.map(([n]) => n.length));
  console.log('\nSetup required:');
  for (const [name, hint] of hints) {
    console.log(`  ${name.padEnd(pad)}  → ${hint}`);
  }
}

async function cmdAdd(args) {
  const all = args.includes('--all');
  const names = all ? await listAvailable() : args.filter(a => !a.startsWith('-'));

  if (names.length === 0) {
    console.log('Usage: ai-toolkit add <skill-name>');
    console.log('       ai-toolkit add --all');
    process.exit(1);
  }

  const manifest = await fetchManifest();
  console.log(all ? `Installing all ${names.length} skills...\n` : `Installing ${names.length} skill(s)...\n`);
  for (const name of names) await installSkill(name, manifest);
  printSetupHints(names, manifest);
  console.log('\nRestart Claude Code to activate installed skills.');
}

async function cmdUpdate() {
  const installed = listInstalled();
  if (installed.length === 0) {
    console.log('No skills installed. Run: ai-toolkit add --all');
    return;
  }
  const manifest = await fetchManifest();
  console.log(`Updating ${installed.length} installed skill(s)...\n`);
  for (const name of installed) await installSkill(name, manifest);
  printSetupHints(installed, manifest);
  console.log('\nRestart Claude Code to activate updated skills.');
}

async function fetchManifest() {
  try {
    return JSON.parse(await get(`${RAW_BASE}/skills.json`));
  } catch {
    return {};
  }
}

async function cmdList() {
  const [manifest, installed] = await Promise.all([fetchManifest(), listInstalled()]);
  const names = Object.keys(manifest).sort();
  if (names.length === 0) {
    console.log('No skills found.');
    return;
  }
  console.log('Available skills:\n');
  for (const name of names) {
    const version      = manifest[name]?.version;
    const versionTag   = version ? ` v${version}` : '';
    const installedTag = installed.includes(name) ? ' (installed)' : '';
    console.log(`  ${name}${versionTag}${installedTag}`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  const commands = { add: cmdAdd, update: cmdUpdate, list: cmdList };

  if (!cmd || !commands[cmd]) {
    console.log('Usage:');
    console.log('  ai-toolkit list                  List available skills');
    console.log('  ai-toolkit add <skill-name>      Install a skill');
    console.log('  ai-toolkit add --all             Install all skills');
    console.log('  ai-toolkit update                Update all installed skills');
    process.exit(cmd ? 1 : 0);
  }

  try {
    await commands[cmd](args);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
