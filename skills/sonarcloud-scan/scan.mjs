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

// Real SonarCloud issue types from their API
// vulnerability = confirmed SAST security issues
// bug           = code correctness issues
// code_smell    = maintainability issues
// hotspot       = security hotspots requiring manual review
export const CATEGORIES = ['vulnerability', 'bug', 'code_smell', 'hotspot'];
export const DEFAULT_CATEGORIES = ['vulnerability'];

// Map user-facing category names to SonarCloud API type values
const SONAR_TYPE_MAP = {
  vulnerability: 'VULNERABILITY',
  bug:           'BUG',
  code_smell:    'CODE_SMELL',
};

export function parseArgs(argv) {
  const out = { severity: 'critical', repo: null, all: false, categories: DEFAULT_CATEGORIES };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--severity' && argv[i + 1]) out.severity = argv[++i];
    else if (argv[i] === '--repo' && argv[i + 1]) out.repo = argv[++i];
    else if (argv[i] === '--all') out.all = true;
    else if (argv[i] === '--categories' && argv[i + 1]) {
      const raw = argv[++i];
      out.categories = raw === 'all' ? CATEGORIES : raw.split(',').map(c => c.trim().toLowerCase());
    }
  }
  return out;
}

export function stripProjectKey(component, projectKey) {
  return component ? component.replace(`${projectKey}:`, '') : component;
}

export function buildResult({ projectKey, severity, categories, rawIssues, rawHotspots, probFilter }) {
  const repo = projectKey.includes(':') ? projectKey.split(':')[1] : projectKey;
  const filteredHotspots = rawHotspots.filter(h => probFilter.includes(h.vulnerabilityProbability));
  return {
    project: projectKey,
    severity,
    categories,
    issues: rawIssues.map(i => ({
      // common fields
      source:        'sonarcloud',
      type:          (i.type ?? 'VULNERABILITY').toLowerCase(),
      severity:      i.severity,
      title:         i.message,
      repo,
      file:          stripProjectKey(i.component, projectKey),
      line:          i.line ?? null,
      resource:      null,
      fix_available: !!i.effort,
      fix:           null,
      categories:    [(i.type ?? 'VULNERABILITY').toLowerCase()],
      // sonarcloud-specific
      category:      (i.type ?? 'VULNERABILITY').toLowerCase(),
      rule:          i.rule,
      effort:        i.effort ?? null,
    })),
    hotspots: filteredHotspots.map(h => ({
      // common fields
      source:        'sonarcloud',
      type:          'hotspot',
      severity:      h.vulnerabilityProbability,
      title:         h.message,
      repo,
      file:          stripProjectKey(h.component, projectKey),
      line:          h.line ?? null,
      resource:      null,
      fix_available: false,
      fix:           null,
      categories:    ['hotspot'],
      // sonarcloud-specific
      probability:   h.vulnerabilityProbability,
      rule:          h.ruleKey,
    })),
    summary: {
      total_issues:   rawIssues.length,
      total_hotspots: filteredHotspots.length,
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
  const { severity, repo, all, categories } = parseArgs(process.argv.slice(2));
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

  // Map requested categories to SonarCloud types — fetch only what was asked for
  const wantHotspots = categories.includes('hotspot');
  const issueTypes = categories.filter(c => SONAR_TYPE_MAP[c]).map(c => SONAR_TYPE_MAP[c]);

  let rawIssues = [];
  if (issueTypes.length > 0) {
    const issueBase = `${BASE}/issues/search?componentKeys=${encodeURIComponent(projectKey)}&types=${issueTypes.join(',')}&statuses=OPEN,CONFIRMED,REOPENED&severities=${sonarSeverities}&organization=${encodeURIComponent(org)}`;
    rawIssues = await paginate(p => `${issueBase}&p=${p}&ps=100`, token, 'issues', maxPages);
  }

  let rawHotspots = [];
  if (wantHotspots) {
    try {
      const hotspotBase = `${BASE}/hotspots/search?projectKey=${encodeURIComponent(projectKey)}&status=TO_REVIEW`;
      rawHotspots = await paginate(p => `${hotspotBase}&p=${p}&ps=100`, token, 'hotspots', maxPages);
    } catch {
      // hotspots endpoint may be unavailable on free plans — skip silently
    }
  }

  console.log(JSON.stringify(buildResult({ projectKey, severity, categories, rawIssues, rawHotspots, probFilter }), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
