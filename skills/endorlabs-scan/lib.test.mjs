import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEVERITY_LEVELS,
  validateSeverity,
  filterFindings,
  buildFindingRow,
  buildResult,
} from './lib.mjs';

// ---- SEVERITY_LEVELS ----

test('SEVERITY_LEVELS: critical contains only CRITICAL', () => {
  assert.deepEqual(SEVERITY_LEVELS.critical, ['CRITICAL']);
});

test('SEVERITY_LEVELS: high includes HIGH but not MEDIUM', () => {
  assert.ok(SEVERITY_LEVELS.high.includes('HIGH'));
  assert.ok(!SEVERITY_LEVELS.high.includes('MEDIUM'));
});

test('SEVERITY_LEVELS: medium includes MEDIUM but not LOW', () => {
  assert.ok(SEVERITY_LEVELS.medium.includes('MEDIUM'));
  assert.ok(!SEVERITY_LEVELS.medium.includes('LOW'));
});

test('SEVERITY_LEVELS: all includes LOW', () => {
  assert.ok(SEVERITY_LEVELS.all.includes('LOW'));
});

// ---- validateSeverity ----

test('validateSeverity: accepts valid values', () => {
  for (const v of ['critical', 'high', 'medium', 'all']) {
    assert.ok(validateSeverity(v), `expected ${v} to be valid`);
  }
});

test('validateSeverity: rejects invalid values', () => {
  assert.ok(!validateSeverity(''));
  assert.ok(!validateSeverity('blocker'));
  assert.ok(!validateSeverity('HIGH'));      // case-sensitive
  assert.ok(!validateSeverity('; rm -rf')); // injection attempt
});

// ---- filterFindings ----

const mockFindings = [
  { uuid: '1', spec: { level: 'CRITICAL', finding_type: 'vuln', summary: 'crit issue', remediation: '1.2.3' } },
  { uuid: '2', spec: { level: 'HIGH',     finding_type: 'vuln', summary: 'high issue', remediation: null } },
  { uuid: '3', spec: { level: 'MEDIUM',   finding_type: 'vuln', summary: 'med issue',  remediation: null } },
  { uuid: '4', spec: { level: 'LOW',      finding_type: 'vuln', summary: 'low issue',  remediation: null } },
];

test('filterFindings: severity=critical returns only CRITICAL', () => {
  const r = filterFindings(mockFindings, 'critical');
  assert.equal(r.length, 1);
  assert.equal(r[0].uuid, '1');
});

test('filterFindings: severity=high returns CRITICAL and HIGH', () => {
  const r = filterFindings(mockFindings, 'high');
  assert.equal(r.length, 2);
  assert.ok(r.every(f => ['CRITICAL', 'HIGH'].includes(f.spec.level)));
});

test('filterFindings: severity=medium returns CRITICAL, HIGH, MEDIUM', () => {
  const r = filterFindings(mockFindings, 'medium');
  assert.equal(r.length, 3);
});

test('filterFindings: severity=all returns all findings', () => {
  const r = filterFindings(mockFindings, 'all');
  assert.equal(r.length, 4);
});

test('filterFindings: unknown severity falls back to high', () => {
  const r = filterFindings(mockFindings, 'blocker');
  assert.equal(r.length, 2); // fallback to SEVERITY_LEVELS.high
});

test('filterFindings: level comparison is case-insensitive', () => {
  const mixed = [{ uuid: 'x', spec: { level: 'critical' } }]; // lowercase
  const r = filterFindings(mixed, 'critical');
  assert.equal(r.length, 1);
});

test('filterFindings: missing spec.level is excluded', () => {
  const noLevel = [{ uuid: 'x', spec: {} }];
  const r = filterFindings(noLevel, 'all');
  assert.equal(r.length, 0);
});

// ---- buildFindingRow ----

test('buildFindingRow: maps all fields correctly', () => {
  const finding = {
    uuid: 'abc-123',
    meta: { name: 'lodash@4.17.15' },
    spec: {
      finding_type: 'VULNERABILITY',
      level: 'HIGH',
      summary: 'Prototype pollution in lodash',
      remediation: 'Upgrade to 4.17.21',
    },
  };
  const row = buildFindingRow(finding);
  assert.equal(row.uuid, 'abc-123');
  assert.equal(row.name, 'lodash@4.17.15');
  assert.equal(row.type, 'VULNERABILITY');
  assert.equal(row.level, 'HIGH');
  assert.equal(row.summary, 'Prototype pollution in lodash');
  assert.equal(row.remediation, 'Upgrade to 4.17.21');
  assert.equal(row.fixAvailable, true);
});

test('buildFindingRow: fixAvailable is false when remediation is null', () => {
  const finding = { uuid: 'x', spec: { level: 'HIGH', remediation: null } };
  const row = buildFindingRow(finding);
  assert.equal(row.fixAvailable, false);
});

test('buildFindingRow: missing spec and meta do not throw', () => {
  const row = buildFindingRow({ uuid: 'bare' });
  assert.equal(row.uuid, 'bare');
  assert.equal(row.level, null);
  assert.equal(row.fixAvailable, false);
});

// ---- buildResult ----

test('buildResult: filters and assembles correctly', () => {
  const result = buildResult({
    namespace: 'myorg.team',
    repo:      'my-service',
    severity:  'high',
    findings:  mockFindings,
  });
  assert.equal(result.namespace, 'myorg.team');
  assert.equal(result.repo, 'my-service');
  assert.equal(result.severity, 'high');
  assert.equal(result.findings.length, 2); // CRITICAL + HIGH only
  assert.equal(result.summary.total, 2);
});

test('buildResult: summary.fixable counts only findings with remediation', () => {
  const result = buildResult({ namespace: 'ns', repo: 'r', severity: 'critical', findings: mockFindings });
  assert.equal(result.summary.total, 1);
  assert.equal(result.summary.fixable, 1); // CRITICAL finding has remediation
});

test('buildResult: empty findings produce zero counts', () => {
  const result = buildResult({ namespace: 'ns', repo: 'r', severity: 'high', findings: [] });
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.fixable, 0);
});
