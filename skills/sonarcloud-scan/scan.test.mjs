// Uses Node built-in test runner (node:test) — no external dependencies
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs,
  stripProjectKey,
  buildResult,
  SEVERITY_FILTER,
  HOTSPOT_PROB_FILTER,
} from './scan.mjs';

// --- parseArgs ---

test('parseArgs: defaults when no args', () => {
  const result = parseArgs([]);
  assert.equal(result.severity, 'high');
  assert.equal(result.repo, null);
});

test('parseArgs: reads --severity and --repo', () => {
  const result = parseArgs(['--severity', 'critical', '--repo', 'my-service']);
  assert.equal(result.severity, 'critical');
  assert.equal(result.repo, 'my-service');
});

test('parseArgs: unknown flags do not crash', () => {
  const result = parseArgs(['--unknown', 'foo', '--repo', 'svc']);
  assert.equal(result.repo, 'svc');
  assert.equal(result.severity, 'high');
});

// --- SEVERITY_FILTER mapping ---

test('SEVERITY_FILTER: critical excludes MAJOR', () => {
  assert.ok(!SEVERITY_FILTER.critical.includes('MAJOR'));
});

test('SEVERITY_FILTER: high includes MAJOR but not MINOR', () => {
  assert.ok(SEVERITY_FILTER.high.includes('MAJOR'));
  assert.ok(!SEVERITY_FILTER.high.includes('MINOR'));
});

test('SEVERITY_FILTER: all includes INFO', () => {
  assert.ok(SEVERITY_FILTER.all.includes('INFO'));
});

// --- HOTSPOT_PROB_FILTER mapping ---

test('HOTSPOT_PROB_FILTER: critical only HIGH', () => {
  assert.deepEqual(HOTSPOT_PROB_FILTER.critical, ['HIGH']);
});

test('HOTSPOT_PROB_FILTER: high includes MEDIUM', () => {
  assert.ok(HOTSPOT_PROB_FILTER.high.includes('MEDIUM'));
  assert.ok(!HOTSPOT_PROB_FILTER.high.includes('LOW'));
});

// --- stripProjectKey ---

test('stripProjectKey: removes org:repo prefix', () => {
  assert.equal(stripProjectKey('my-org:my-repo:src/auth.ts', 'my-org:my-repo'), 'src/auth.ts');
});

test('stripProjectKey: no-op when component has no prefix', () => {
  assert.equal(stripProjectKey('src/auth.ts', 'my-org:my-repo'), 'src/auth.ts');
});

test('stripProjectKey: handles null component', () => {
  assert.equal(stripProjectKey(null, 'my-org:my-repo'), null);
});

// --- buildResult ---

const projectKey = 'my-org:my-repo';

test('buildResult: maps vulnerabilities correctly', () => {
  const result = buildResult({
    projectKey,
    severity: 'high',
    rawVulns: [{
      severity: 'CRITICAL',
      rule: 'ts:S2068',
      component: `${projectKey}:src/auth.ts`,
      line: 42,
      message: 'Hardcoded password',
      effort: '5min',
    }],
    rawHotspots: [],
    probFilter: HOTSPOT_PROB_FILTER.high,
  });

  assert.equal(result.project, projectKey);
  assert.equal(result.vulnerabilities.length, 1);
  assert.equal(result.vulnerabilities[0].file, 'src/auth.ts');
  assert.equal(result.vulnerabilities[0].severity, 'CRITICAL');
  assert.equal(result.summary.total_vulnerabilities, 1);
});

test('buildResult: filters hotspots by probability', () => {
  const hotspots = [
    { vulnerabilityProbability: 'HIGH',   ruleKey: 'r1', component: `${projectKey}:a.ts`, line: 1, message: 'h1' },
    { vulnerabilityProbability: 'LOW',    ruleKey: 'r2', component: `${projectKey}:b.ts`, line: 2, message: 'h2' },
    { vulnerabilityProbability: 'MEDIUM', ruleKey: 'r3', component: `${projectKey}:c.ts`, line: 3, message: 'h3' },
  ];

  const result = buildResult({
    projectKey,
    severity: 'high',
    rawVulns: [],
    rawHotspots: hotspots,
    probFilter: HOTSPOT_PROB_FILTER.high, // ['HIGH', 'MEDIUM']
  });

  assert.equal(result.hotspots.length, 2);
  assert.equal(result.summary.total_hotspots, 2);
  assert.ok(result.hotspots.every(h => ['HIGH', 'MEDIUM'].includes(h.probability)));
});

test('buildResult: null effort and line are preserved as null', () => {
  const result = buildResult({
    projectKey,
    severity: 'high',
    rawVulns: [{ severity: 'MAJOR', rule: 'r', component: `${projectKey}:f.ts`, message: 'm' }],
    rawHotspots: [],
    probFilter: HOTSPOT_PROB_FILTER.high,
  });

  assert.equal(result.vulnerabilities[0].line, null);
  assert.equal(result.vulnerabilities[0].effort, null);
});
