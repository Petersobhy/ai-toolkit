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

export const SEVERITY_LEVELS = {
  critical: ['High'],
  high:     ['High', 'Medium'],
  medium:   ['High', 'Medium', 'Low'],
  all:      ['High', 'Medium', 'Low', 'Informational'],
};

export function parseArgs(argv) {
  const out = { severity: 'high', resourceGroup: null };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--severity' || argv[i] === '-s') && argv[i + 1]) out.severity = argv[++i];
    else if ((argv[i] === '--resource-group' || argv[i] === '-g') && argv[i + 1]) out.resourceGroup = argv[++i];
  }
  return out;
}

// Extract resource group name from an ARM resource ID
export function rgFromId(resourceId) {
  if (!resourceId) return null;
  const m = resourceId.match(/resourceGroups\/([^/]+)/i);
  return m ? m[1] : null;
}

// Parse CvesDetails JSON string safely
export function parseCves(additionalData) {
  const raw = additionalData?.CvesDetails;
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function buildVulnerability(assessment, severityLevels) {
  const props = assessment.properties ?? {};
  const data  = props.additionalData ?? {};
  const cves  = parseCves(data);

  // Filter CVEs by requested severity
  const filtered = cves.filter(c => severityLevels.includes(c.Severity));
  if (filtered.length === 0) return null;

  const fixable = filtered.filter(c => c.FixStatus === 'FixAvailable');

  return {
    type:           'vulnerability',
    assessment:     props.displayName ?? assessment.name,
    package:        data.SoftwareName ?? null,
    language:       data.Language ?? null,
    resource:       props.resourceDetails?.ResourceName ?? rgFromId(props.resourceDetails?.Id) ?? null,
    resource_group: rgFromId(props.resourceDetails?.Id ?? props.resourceDetails?.NativeResourceId),
    cves:           filtered.map(c => ({
      id:            c.CveId,
      severity:      c.Severity,
      fix_available: c.FixStatus === 'FixAvailable',
      fix_version:   c.FixedVersion ?? null,
    })),
    fix_available:  fixable.length > 0,
    fix_version:    fixable[0]?.FixedVersion ?? null,
    max_cvss:       data.MaxCvssScore ? parseFloat(data.MaxCvssScore) : null,
  };
}

export function buildRecommendation(assessment, metadata) {
  const props = assessment.properties ?? {};
  const meta  = metadata?.properties ?? {};
  const sev   = meta.severity ?? null;

  return {
    type:           'recommendation',
    name:           props.displayName ?? meta.displayName ?? assessment.name,
    severity:       sev,
    resource:       props.resourceDetails?.ResourceName ?? rgFromId(props.resourceDetails?.Id) ?? null,
    resource_group: rgFromId(props.resourceDetails?.Id ?? props.resourceDetails?.NativeResourceId),
    remediation:    meta.remediationDescription
                      ?.replace(/<[^>]+>/g, '')  // strip HTML tags
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 200) ?? null,
  };
}

export function buildAlert(alert) {
  const props = alert.properties ?? {};
  return {
    type:            'alert',
    name:            props.alertDisplayName ?? alert.name,
    severity:        props.severity ?? null,
    status:          props.status ?? null,
    description:     props.description?.slice(0, 200) ?? null,
    compromised:     props.compromisedEntity ?? null,
    remediation:     Array.isArray(props.remediationSteps)
                       ? props.remediationSteps.join(' ').slice(0, 200)
                       : null,
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

export function get(url, token, timeoutMs = 30000) {
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

export async function paginate(baseUrl, token) {
  const items = [];
  let url = baseUrl;
  while (url) {
    const data = await get(url, token);
    items.push(...(data.value ?? []));
    url = data.nextLink ?? null;
  }
  return items;
}

async function main() {
  const { severity, resourceGroup } = parseArgs(process.argv.slice(2));
  const sub = process.env.AZURE_SUBSCRIPTION_ID;

  if (!sub) { console.error('AZURE_SUBSCRIPTION_ID is not set'); process.exit(1); }

  const levels = SEVERITY_LEVELS[severity] ?? SEVERITY_LEVELS.high;
  const token  = getToken();
  const base   = `${ARM}/subscriptions/${encodeURIComponent(sub)}`;
  const rgFilter = resourceGroup ? `/resourceGroups/${encodeURIComponent(resourceGroup)}` : '';

  // Fetch metadata for severity lookup (subscription-scoped, no RG filter)
  const metaItems = await paginate(
    `${base}/providers/Microsoft.Security/assessmentMetadata?api-version=${API_VERSIONS.assessmentMetadata}`,
    token
  );
  const metaByName = Object.fromEntries(metaItems.map(m => [m.name, m]));

  // Fetch assessments (scoped to RG if provided)
  const assessments = await paginate(
    `${base}${rgFilter}/providers/Microsoft.Security/assessments?api-version=${API_VERSIONS.assessments}`,
    token
  );
  const unhealthy = assessments.filter(a => a.properties?.status?.code === 'Unhealthy');

  // Fetch alerts
  let alertItems = [];
  try {
    alertItems = await paginate(
      `${base}/providers/Microsoft.Security/alerts?api-version=${API_VERSIONS.alerts}`,
      token
    );
    alertItems = alertItems.filter(a => levels.includes(a.properties?.severity));
  } catch { /* alerts endpoint may require Defender plan */ }

  // Fetch secure score (overall subscription score)
  let secureScore = null;
  try {
    const scores = await paginate(
      `${base}/providers/Microsoft.Security/secureScores?api-version=${API_VERSIONS.secureScores}`,
      token
    );
    secureScore = scores.find(s => s.name === 'ascScore') ?? scores[0] ?? null;
  } catch { /* secure score may not be available */ }

  // Build results
  const vulnerabilities = [];
  const recommendations = [];

  for (const assessment of unhealthy) {
    const hasCves = assessment.properties?.additionalData?.CvesDetails;
    if (hasCves) {
      const vuln = buildVulnerability(assessment, levels);
      if (vuln) vulnerabilities.push(vuln);
    } else {
      const meta = metaByName[assessment.name];
      const sev  = meta?.properties?.severity;
      if (sev && levels.includes(sev)) {
        recommendations.push(buildRecommendation(assessment, meta));
      }
    }
  }

  const alerts = alertItems.map(buildAlert);

  console.log(JSON.stringify(buildResult({ subscription: sub, severity, secureScore, vulnerabilities, recommendations, alerts }), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
