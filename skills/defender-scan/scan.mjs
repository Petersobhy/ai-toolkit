#!/usr/bin/env node
import https from 'https';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ARM = 'https://management.azure.com';
const API_VERSIONS = {
  assessments: '2021-06-01',
  assessmentMetadata: '2021-06-01',
  alerts: '2022-01-01',
  secureScores: '2020-01-01',
};

const SEVERITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1, Informational: 0 };
const MIN_RANK = { critical: 4, high: 3, medium: 2, all: 0 };

export function severityAtLeast(severityValue, minSeverity) {
  const rank = SEVERITY_RANK[severityValue] ?? -1;
  return rank >= (MIN_RANK[minSeverity] ?? 3);
}

// Returns the sorted list of Defender severity labels at or above minSeverity — used for server-side OData filters
export function severityLabels(minSeverity) {
  const min = MIN_RANK[minSeverity] ?? 3;
  return Object.entries(SEVERITY_RANK).filter(([, r]) => r >= min).map(([s]) => s);
}

// Real Defender categories from assessmentMetadata.properties.categories
// vulnerabilities = CVE findings (Defender for Containers / CSPM)
// alerts = active runtime threats
// compute/networking/data/container/identityandaccess/appservices = posture recommendation types
export const CATEGORIES = ['vulnerabilities', 'recommendations', 'alerts', 'compute', 'networking', 'data', 'container', 'identityandaccess', 'appservices'];
export const DEFAULT_CATEGORIES = ['vulnerabilities', 'container'];

// Map user-facing category names to Defender metadata category values
const DEFENDER_CATEGORY_MAP = {
  compute:          'Compute',
  networking:       'Networking',
  data:             'Data',
  container:        'Container',
  identityandaccess:'IdentityAndAccess',
  appservices:      'AppServices',
};

export function parseArgs(argv) {
  const out = { severity: 'critical', resourceGroup: null, all: false, categories: DEFAULT_CATEGORIES };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--severity' || argv[i] === '-s') && argv[i + 1]) out.severity = argv[++i];
    else if ((argv[i] === '--resource-group' || argv[i] === '-g') && argv[i + 1]) out.resourceGroup = argv[++i];
    else if (argv[i] === '--all') out.all = true;
    else if (argv[i] === '--categories' && argv[i + 1]) {
      const raw = argv[++i];
      out.categories = raw === 'all' ? CATEGORIES : raw.split(',').map(c => c.trim().toLowerCase());
    }
  }
  return out;
}

// Extract resource group name from an ARM resource ID
export function rgFromId(resourceId) {
  if (!resourceId) return null;
  const m = resourceId.match(/resourceGroups\/([^/]+)/i);
  return m ? m[1] : null;
}

// Extract resource type from an ARM resource ID (e.g. "registries", "virtualMachines", "managedClusters")
export function resourceTypeFromId(resourceId) {
  if (!resourceId) return null;
  const m = resourceId.match(/providers\/[^/]+\/([^/]+)\//i);
  return m ? m[1] : null;
}

// Parse CvesDetails JSON string safely
export function parseCves(additionalData) {
  const raw = additionalData?.CvesDetails;
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function buildVulnerability(assessment, minSeverity) {
  const props = assessment.properties ?? {};
  const data  = props.additionalData ?? {};
  const cves  = parseCves(data);

  const filtered = cves.filter(c => severityAtLeast(c.Severity, minSeverity));
  if (filtered.length === 0) return null;

  const fixable      = filtered.filter(c => c.FixStatus === 'FixAvailable');
  const resourceId   = props.resourceDetails?.Id ?? props.resourceDetails?.NativeResourceId ?? null;
  const resource     = props.resourceDetails?.ResourceName ?? rgFromId(resourceId) ?? null;

  return {
    // common fields
    source:         'defender',
    type:           'vulnerability',
    severity:       filtered[0]?.Severity ?? null,
    title:          props.displayName ?? assessment.name,
    repo:           null,
    file:           null,
    line:           null,
    resource,
    resource_type:  resourceTypeFromId(resourceId),
    fix_available:  fixable.length > 0,
    fix:            fixable[0]?.FixedVersion ?? null,
    categories:     [],
    // defender-specific
    assessment:     props.displayName ?? assessment.name,
    package:        data.SoftwareName ?? null,
    language:       data.Language ?? null,
    resource_group: rgFromId(resourceId),
    cves:           filtered.map(c => ({
      id:            c.CveId,
      severity:      c.Severity,
      fix_available: c.FixStatus === 'FixAvailable',
      fix_version:   c.FixedVersion ?? null,
    })),
    fix_version:    fixable[0]?.FixedVersion ?? null,
    max_cvss:       data.MaxCvssScore ? parseFloat(data.MaxCvssScore) : null,
  };
}

export function buildRecommendation(assessment, metadata) {
  const props      = assessment.properties ?? {};
  const meta       = metadata?.properties ?? {};
  const resourceId = props.resourceDetails?.Id ?? props.resourceDetails?.NativeResourceId ?? null;
  const resource   = props.resourceDetails?.ResourceName ?? rgFromId(resourceId) ?? null;
  const remediation = meta.remediationDescription
    ?.replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) ?? null;

  return {
    // common fields
    source:         'defender',
    type:           'recommendation',
    severity:       meta.severity ?? null,
    title:          props.displayName ?? meta.displayName ?? assessment.name,
    repo:           null,
    file:           null,
    line:           null,
    resource,
    resource_type:  resourceTypeFromId(resourceId),
    fix_available:  false,
    fix:            remediation,
    categories:     (meta.categories ?? []).map(c => c.toLowerCase()),
    // defender-specific
    name:           props.displayName ?? meta.displayName ?? assessment.name,
    resource_group: rgFromId(resourceId),
    remediation,
  };
}

export function buildAlert(alert) {
  const props      = alert.properties ?? {};
  const remediation = Array.isArray(props.remediationSteps)
    ? props.remediationSteps.join(' ').slice(0, 200)
    : null;
  return {
    // common fields
    source:        'defender',
    type:          'alert',
    severity:      props.severity ?? null,
    title:         props.alertDisplayName ?? alert.name,
    repo:          null,
    file:          null,
    line:          null,
    resource:      props.compromisedEntity ?? null,
    resource_type: props.compromisedEntityType ?? null,
    fix_available: false,
    fix:           remediation,
    categories:    [],
    // defender-specific
    name:        props.alertDisplayName ?? alert.name,
    status:      props.status ?? null,
    description: props.description?.slice(0, 200) ?? null,
    compromised: props.compromisedEntity ?? null,
    remediation,
  };
}

export function buildResult({ subscription, severity, secureScore, vulnerabilities, recommendations, alerts }) {
  const score = secureScore?.properties?.score;
  return {
    subscription,
    severity,
    secure_score: score ? {
      current:    score.current,
      max:        score.max,
      percentage: score.max > 0 ? Math.round((score.current / score.max) * 100) : null,
    } : null,
    vulnerabilities,
    recommendations,
    alerts,
    summary: {
      total_vulnerabilities:  vulnerabilities.length,
      total_recommendations:  recommendations.length,
      total_alerts:           alerts.length,
      secure_score_pct:       score?.max > 0 ? Math.round((score.current / score.max) * 100) : null,
    },
  };
}

// ---- HTTP + auth ----

function getToken() {
  const r = spawnSync('az', [
    'account', 'get-access-token',
    '--resource', 'https://management.azure.com/',
    '--query', 'accessToken', '-o', 'tsv',
  ], { encoding: 'utf8', timeout: 10000 });
  if (r.error?.code === 'ETIMEDOUT') throw new Error('Azure token request timed out — run `az login` to refresh your session.');
  if (r.status !== 0) throw new Error('Failed to get Azure token — run `az login` first.\n' + r.stderr);
  return r.stdout.trim();
}

function getOnce(url, token, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ai-toolkit/defender-scan' },
    }, (res) => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        req.destroy();
        if (res.statusCode === 404) { reject(Object.assign(new Error('not_found'), { code: 'not_found' })); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`)); return; }
        try { resolve(JSON.parse(raw)); } catch { reject(new Error(`Bad JSON from ${url}`)); }
      });
    }).on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs / 1000}s: ${url.slice(0, 120)}`));
    });
  });
}

export async function get(url, token, timeoutMs = 30000, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await getOnce(url, token, timeoutMs);
    } catch (err) {
      const retryable = err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT';
      if (!retryable || attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

export async function paginate(baseUrl, token, maxPages = 1) {
  const items = [];
  let url = baseUrl;
  let page = 0;
  while (url && page < maxPages) {
    const data = await get(url, token);
    items.push(...(data.value ?? []));
    url = data.nextLink ?? null;
    page++;
  }
  return items;
}

async function main() {
  const { severity, resourceGroup, all, categories } = parseArgs(process.argv.slice(2));
  const sub = process.env.AZURE_SUBSCRIPTION_ID;

  if (!sub) { console.error('AZURE_SUBSCRIPTION_ID is not set'); process.exit(1); }

  const levels   = severityLabels(severity);
  const token    = getToken();
  const base     = `${ARM}/subscriptions/${encodeURIComponent(sub)}`;
  const rgFilter = resourceGroup ? `/resourceGroups/${encodeURIComponent(resourceGroup)}` : '';
  const maxPages = all ? Infinity : 1;

  // Fetch only Unhealthy assessments server-side — avoids pulling all assessments
  const unhealthy = await paginate(
    `${base}${rgFilter}/providers/Microsoft.Security/assessments?api-version=${API_VERSIONS.assessments}&$filter=properties/status/code eq 'Unhealthy'`,
    token,
    maxPages
  );

  // Fetch metadata only for the unique assessment types that appear in results, in parallel
  // Avoids paginating through the full metadata catalogue (~500+ entries)
  const uniqueNames = [...new Set(
    unhealthy.filter(a => !a.properties?.additionalData?.CvesDetails).map(a => a.name)
  )];
  const metaResults = await Promise.all(
    uniqueNames.map(name =>
      get(`${base}/providers/Microsoft.Security/assessmentMetadata/${encodeURIComponent(name)}?api-version=${API_VERSIONS.assessmentMetadata}`, token)
        .catch(() => null)
    )
  );
  const metaByName = Object.fromEntries(uniqueNames.map((name, i) => [name, metaResults[i]]));

  // Resolve which top-level categories are requested
  const wantVulns = categories.includes('vulnerabilities');
  const wantAlerts = categories.includes('alerts');
  // Recommendation sub-categories: compute, networking, data, container, identityandaccess, appservices
  const recCategoryFilter = categories.filter(c => DEFENDER_CATEGORY_MAP[c]).map(c => DEFENDER_CATEGORY_MAP[c]);
  const wantRecs = categories.includes('recommendations') || recCategoryFilter.length > 0;

  // Fetch alerts only if requested
  let alertItems = [];
  if (wantAlerts) {
    try {
      const severityFilter = levels.map(l => `properties/severity eq '${l}'`).join(' or ');
      alertItems = await paginate(
        `${base}/providers/Microsoft.Security/alerts?api-version=${API_VERSIONS.alerts}&$filter=${encodeURIComponent(severityFilter)}`,
        token,
        maxPages
      );
    } catch { /* alerts endpoint may require Defender plan */ }
  }

  // Fetch secure score (always — small call, useful context)
  let secureScore = null;
  try {
    const scores = await paginate(
      `${base}/providers/Microsoft.Security/secureScores?api-version=${API_VERSIONS.secureScores}`,
      token
    );
    secureScore = scores.find(s => s.name === 'ascScore') ?? scores[0] ?? null;
  } catch { /* secure score may not be available */ }

  // Build results — filter by requested categories
  const vulnerabilities = [];
  const recommendations = [];

  for (const assessment of unhealthy) {
    const hasCves = assessment.properties?.additionalData?.CvesDetails;
    if (hasCves) {
      if (!wantVulns) continue;
      const vuln = buildVulnerability(assessment, severity);
      if (vuln) vulnerabilities.push(vuln);
    } else {
      if (!wantRecs) continue;
      const meta = metaByName[assessment.name];
      const sev  = meta?.properties?.severity;
      if (!sev || !severityAtLeast(sev, severity)) continue;
      const rec = buildRecommendation(assessment, meta);
      // Apply Defender sub-category filter if specific categories were requested
      if (recCategoryFilter.length > 0 && !rec.categories.some(c => recCategoryFilter.map(x=>x.toLowerCase()).includes(c))) continue;
      recommendations.push(rec);
    }
  }

  const alerts = alertItems.map(buildAlert);

  console.log(JSON.stringify(buildResult({ subscription: sub, severity, secureScore, vulnerabilities, recommendations, alerts }), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
