#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = 'Petersobhy/ai-toolkit';
const BRANCH = 'main';
const SKILLS_PATH = 'skills';
const INSTALL_DIR = path.join(os.homedir(), '.claude', 'agents');

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

async function listAvailable() {
  const data = JSON.parse(await get(`${API_BASE}/${SKILLS_PATH}`));
  return data
    .filter(f => f.name.endsWith('.md') && f.name !== 'README.md')
    .map(f => f.name.replace(/\.md$/, ''));
}

function listInstalled() {
  if (!fs.existsSync(INSTALL_DIR)) return [];
  return fs.readdirSync(INSTALL_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));
}

async function installSkill(name) {
  const url = `${RAW_BASE}/${SKILLS_PATH}/${name}.md`;
  let content;
  try {
    content = await get(url);
  } catch {
    console.error(`  ✗ ${name} — not found in repo`);
    return false;
  }
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.writeFileSync(path.join(INSTALL_DIR, `${name}.md`), content);
  console.log(`  ✓ ${name} → ${INSTALL_DIR}/${name}.md`);
  return true;
}

async function cmdAdd(args) {
  const all = args.includes('--all');
  const names = all ? await listAvailable() : args.filter(a => !a.startsWith('-'));

  if (names.length === 0) {
    console.log('Usage: ai-toolkit add <skill-name>');
    console.log('       ai-toolkit add --all');
    process.exit(1);
  }

  console.log(all ? `Installing all ${names.length} skills...\n` : `Installing ${names.length} skill(s)...\n`);
  for (const name of names) await installSkill(name);
  console.log('\nRestart Claude Code to activate installed skills.');
}

async function cmdUpdate() {
  const installed = listInstalled();
  if (installed.length === 0) {
    console.log('No skills installed. Run: ai-toolkit add --all');
    return;
  }
  console.log(`Updating ${installed.length} installed skill(s)...\n`);
  for (const name of installed) await installSkill(name);
  console.log('\nRestart Claude Code to activate updated skills.');
}

async function cmdList() {
  const [available, installed] = await Promise.all([listAvailable(), Promise.resolve(listInstalled())]);
  console.log('Available skills:\n');
  for (const name of available) {
    const tag = installed.includes(name) ? ' (installed)' : '';
    console.log(`  ${name}${tag}`);
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
