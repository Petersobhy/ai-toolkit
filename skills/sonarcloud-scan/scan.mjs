#!/usr/bin/env node
import https from 'https';
import { fileURLToPath } from 'url';

const BASE = 'https://sonarcloud.io/api';

export const SEVERITY_FILTER = {
  critical: 'BLOCKER,CRITICAL',
  high:     'BLOCKER,CRITICAL,MAJOR',
  medium:   'BLOCKER,CRITICAL,MAJOR,MINOR',
  all:      'BLOCKER,CRITICAL,MAJOR,MINOR,INFO',
};

export const HOTSPOT_PROB_FILTER = {
  critical: ['HIGH'],
  high:     ['HIGH', 'MEDIUM'],
  medium:   ['HIGH', 'MEDIUM', 'LOW'],
  all:      ['HIGH', 'MEDIUM', 'LOW'],
};

export function parseArgs(argv) {
  const out = { severity: 'high', repo: null, all: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--severity' && argv[i + 1]) out.severity = argv[++i];
    else if (argv[i] === '--repo' && argv[i + 1]) out.repo = argv[++i];
    else if (argv[i] === '--all') out.all = true;
  }
  return out;
}

export function stripProjectKey(component, projectKey) {
  return component ? component.replace(`${projectKey}:`, '') : component;
}

export function buildResult({ projectKey, severity, rawVulns, rawHotspots, probFilter }) {
  return {
    project: projectKey,
    severity,
    vulnerabilities: rawVulns.map(i => ({
      severity: i.severity,
      rule:     i.rule,
      file:     stripProjectKey(i.component, projectKey),
      line:     i.line ?? null,
      message:  i.message,
      effort:   i.effort ?? null,
    })),
    hotspots: rawHotspots
      .filter(h => probFilter.includes(h.vulnerabilityProbability))
      .map(h => ({
        probability: h.vulnerabilityProbability,
        rule:        h.ruleKey,
        file:        stripProjectKey(h.component, projectKey),
        line:        h.line ?? null,
        message:     h.message,
      })),
    summary: {
      total_vulnerabilities: rawVulns.length,
      total_hotspots:        rawHotspots.filter(h => probFilter.includes(h.vulnerabilityProbability)).length,
    },
  };
}

export function get(url, token, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ai-toolkit/sonarcloud-scan' },
    }, (res) => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        req.destroy();
        if (res.statusCode === 404) { reject(Object.assign(new Error('not_found'), { code: 'not_found' })); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${raw}`)); return; }
        try { resolve(JSON.parse(raw)); } catch { reject(new Error(`Bad JSON from ${url}`)); }
      });
    }).on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs / 1000}s: ${url.slice(0, 120)}`));
    });
  });
}

export async function paginate(buildUrl, token, key, maxPages = 1) {
  const items = [];
  let page = 1;
  while (page <= maxPages) {
    const data = await get(buildUrl(page), token);
    const batch = data[key] ?? [];
    items.push(...batch);
    const total = data.paging?.total ?? data.total ?? 0;
    if (items.length >= total || batch.length === 0) break;
    page++;
    await new Promise(r => setTimeout(r, 200));
  }
  return items;
}

async function main() {
  const { severity, repo, all } = parseArgs(process.argv.slice(2));
  const token = process.env.SONAR_TOKEN;
  const org   = process.env.SONAR_ORG;

  if (!token) { console.error('SONAR_TOKEN is not set'); process.exit(1); }
  if (!org)   { console.error('SONAR_ORG is not set');   process.exit(1); }
  if (!repo)  { console.error('--repo is required');      process.exit(1); }

  const projectKey = `${org}:${repo}`;
  const maxPages   = all ? Infinity : 1;

  try {
    await get(`${BASE}/components/show?component=${encodeURIComponent(projectKey)}`, token);
  } catch (err) {
    if (err.code === 'not_found') {
      console.error(`Project not found: ${projectKey} — ensure the repo is onboarded in SonarCloud`);
      process.exit(2);
    }
    throw err;
  }

  const sonarSeverities = SEVERITY_FILTER[severity] ?? SEVERITY_FILTER.high;
  const probFilter      = HOTSPOT_PROB_FILTER[severity] ?? HOTSPOT_PROB_FILTER.high;

  const vulnBase = `${BASE}/issues/search?componentKeys=${encodeURIComponent(projectKey)}&types=VULNERABILITY&statuses=OPEN,CONFIRMED,REOPENED&severities=${sonarSeverities}&organization=${encodeURIComponent(org)}`;
  const rawVulns = await paginate(p => `${vulnBase}&p=${p}&ps=100`, token, 'issues', maxPages);

  let rawHotspots = [];
  try {
    const hotspotBase = `${BASE}/hotspots/search?projectKey=${encodeURIComponent(projectKey)}&status=TO_REVIEW`;
    rawHotspots = await paginate(p => `${hotspotBase}&p=${p}&ps=100`, token, 'hotspots', maxPages);
  } catch {
    // hotspots endpoint may be unavailable on free plans — skip silently
  }

  console.log(JSON.stringify(buildResult({ projectKey, severity, rawVulns, rawHotspots, probFilter }), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
