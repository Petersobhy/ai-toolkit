import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs,
  rgFromId,
  parseCves,
  buildVulnerability,
  buildRecommendation,
  buildAlert,
  buildResult,
  SEVERITY_LEVELS,
} from './scan.mjs';

// ---- parseArgs ----

test('parseArgs: defaults', () => {
  const r = parseArgs([]);
  assert.equal(r.severity, 'high');
  assert.equal(r.resourceGroup, null);
});

test('parseArgs: --severity and --resource-group', () => {
  const r = parseArgs(['--severity', 'critical', '--resource-group', 'my-rg']);
  assert.equal(r.severity, 'critical');
  assert.equal(r.resourceGroup, 'my-rg');
});

test('parseArgs: short flags -s and -g', () => {
  const r = parseArgs(['-s', 'medium', '-g', 'prod-rg']);
  assert.equal(r.severity, 'medium');
  assert.equal(r.resourceGroup, 'prod-rg');
});

// ---- SEVERITY_LEVELS ----

test('SEVERITY_LEVELS: critical is only High', () => {
  assert.deepEqual(SEVERITY_LEVELS.critical, ['High']);
});

test('SEVERITY_LEVELS: high includes Medium but not Low', () => {
  assert.ok(SEVERITY_LEVELS.high.includes('Medium'));
  assert.ok(!SEVERITY_LEVELS.high.includes('Low'));
});

test('SEVERITY_LEVELS: all includes Informational', () => {
  assert.ok(SEVERITY_LEVELS.all.includes('Informational'));
});

// ---- rgFromId ----

test('rgFromId: extracts resource group from ARM id', () => {
  const id = '/subscriptions/abc/resourceGroups/my-prod-rg/providers/Microsoft.ContainerRegistry/registries/myacr';
  assert.equal(rgFromId(id), 'my-prod-rg');
});

test('rgFromId: returns null when no resourceGroups segment', () => {
  assert.equal(rgFromId('/subscriptions/abc/providers/Microsoft.Security'), null);
});

test('rgFromId: handles null', () => {
  assert.equal(rgFromId(null), null);
});

// ---- parseCves ----

test('parseCves: parses JSON string', () => {
  const data = { CvesDetails: JSON.stringify([{ CveId: 'CVE-2026-1234', Severity: 'High', FixStatus: 'FixAvailable', FixedVersion: '1.2.3' }]) };
  const cves = parseCves(data);
  assert.equal(cves.length, 1);
  assert.equal(cves[0].CveId, 'CVE-2026-1234');
});

test('parseCves: returns empty array when missing', () => {
  assert.deepEqual(parseCves({}), []);
  assert.deepEqual(parseCves(null), []);
});

test('parseCves: returns empty array on invalid JSON', () => {
  assert.deepEqual(parseCves({ CvesDetails: 'not-json' }), []);
});

// ---- buildVulnerability ----

const armId = '/subscriptions/abc/resourceGroups/prod-rg/providers/Microsoft.ContainerRegistry/registries/myacr';

const mockAssessment = {
  name: 'assess-uuid',
  properties: {
    displayName: 'Update lodash',
    status: { code: 'Unhealthy' },
    resourceDetails: { ResourceName: 'myacr', Id: armId },
    additionalData: {
      SoftwareName: 'lodash',
      Language: 'javascript',
      MaxCvssScore: '7.5',
      CvesDetails: JSON.stringify([
        { CveId: 'CVE-2026-001', Severity: 'High',   FixStatus: 'FixAvailable', FixedVersion: '4.18.0' },
        { CveId: 'CVE-2026-002', Severity: 'Medium', FixStatus: 'FixAvailable', FixedVersion: '4.18.0' },
        { CveId: 'CVE-2026-003', Severity: 'Low',    FixStatus: 'NoFixAvailable' },
      ]),
    },
  },
};

test('buildVulnerability: maps fields correctly for severity=high', () => {
  const v = buildVulnerability(mockAssessment, SEVERITY_LEVELS.high);
  assert.equal(v.package, 'lodash');
  assert.equal(v.resource, 'myacr');
  assert.equal(v.resource_group, 'prod-rg');
  assert.equal(v.max_cvss, 7.5);
  assert.equal(v.fix_available, true);
  assert.equal(v.fix_version, '4.18.0');
});

test('buildVulnerability: only includes CVEs at or above severity', () => {
  const v = buildVulnerability(mockAssessment, SEVERITY_LEVELS.high); // High + Medium only
  assert.equal(v.cves.length, 2);
  assert.ok(v.cves.every(c => ['High', 'Medium'].includes(c.severity)));
});

test('buildVulnerability: returns null when no CVEs match severity filter', () => {
  const result = buildVulnerability(mockAssessment, SEVERITY_LEVELS.critical); // High only
  // only CVE-2026-001 (High) matches → not null
  assert.notEqual(result, null);
  assert.equal(result.cves.length, 1);
});

test('buildVulnerability: returns null when all CVEs below threshold', () => {
  const lowOnly = {
    ...mockAssessment,
    properties: {
      ...mockAssessment.properties,
      additionalData: {
        CvesDetails: JSON.stringify([
          { CveId: 'CVE-x', Severity: 'Low', FixStatus: 'NoFixAvailable' },
        ]),
      },
    },
  };
  assert.equal(buildVulnerability(lowOnly, SEVERITY_LEVELS.critical), null);
});

// ---- buildRecommendation ----

const mockMeta = {
  properties: {
    severity: 'High',
    displayName: 'Enable MFA',
    remediationDescription: 'Go to <b>Azure AD</b> and enable MFA for all users.',
  },
};

test('buildRecommendation: strips HTML from remediation', () => {
  const rec = buildRecommendation(mockAssessment, mockMeta);
  assert.ok(!rec.remediation.includes('<b>'));
  assert.ok(rec.remediation.includes('Azure AD'));
});

test('buildRecommendation: uses metadata severity', () => {
  const rec = buildRecommendation(mockAssessment, mockMeta);
  assert.equal(rec.severity, 'High');
  assert.equal(rec.type, 'recommendation');
});

// ---- buildAlert ----

const mockAlert = {
  name: 'alert-uuid',
  properties: {
    alertDisplayName: 'Suspicious login',
    severity: 'High',
    status: 'Active',
    description: 'Unusual login detected.',
    compromisedEntity: 'vm-prod-001',
    remediationSteps: ['Isolate the VM', 'Reset credentials'],
  },
};

test('buildAlert: maps fields correctly', () => {
  const a = buildAlert(mockAlert);
  assert.equal(a.type, 'alert');
  assert.equal(a.name, 'Suspicious login');
  assert.equal(a.severity, 'High');
  assert.equal(a.compromised, 'vm-prod-001');
  assert.ok(a.remediation.includes('Isolate'));
});

// ---- buildResult ----

test('buildResult: computes secure_score percentage', () => {
  const score = { properties: { score: { current: 45, max: 60 } } };
  const result = buildResult({ subscription: 'sub-abc', severity: 'high', secureScore: score, vulnerabilities: [], recommendations: [], alerts: [] });
  assert.equal(result.secure_score.percentage, 75);
  assert.equal(result.summary.secure_score_pct, 75);
});

test('buildResult: handles null secure score', () => {
  const result = buildResult({ subscription: 'sub', severity: 'high', secureScore: null, vulnerabilities: [], recommendations: [], alerts: [] });
  assert.equal(result.secure_score, null);
  assert.equal(result.summary.secure_score_pct, null);
});

test('buildResult: summary counts match arrays', () => {
  const vuln  = [buildVulnerability(mockAssessment, SEVERITY_LEVELS.high)];
  const rec   = [buildRecommendation(mockAssessment, mockMeta)];
  const alert = [buildAlert(mockAlert)];
  const result = buildResult({ subscription: 'sub', severity: 'high', secureScore: null, vulnerabilities: vuln, recommendations: rec, alerts: alert });
  assert.equal(result.summary.total_vulnerabilities, 1);
  assert.equal(result.summary.total_recommendations, 1);
  assert.equal(result.summary.total_alerts, 1);
});
