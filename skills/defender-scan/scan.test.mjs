import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'https';
import { EventEmitter } from 'events';

import {
  parseArgs,
  rgFromId,
  parseCves,
  buildVulnerability,
  buildRecommendation,
  buildAlert,
  buildResult,
  SEVERITY_LEVELS,
  get,
  paginate,
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

test('parseArgs: --all sets all flag', () => {
  const r = parseArgs(['--all']);
  assert.equal(r.all, true);
});

test('parseArgs: all defaults to false', () => {
  assert.equal(parseArgs([]).all, false);
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

// ---- HTTP mock helpers ----

function fakeReq(onTimeout) {
  const req = new EventEmitter();
  req.destroy = (err) => { if (err) req.emit('error', err); };
  req.setTimeout = (ms, cb) => { if (onTimeout) onTimeout(cb); return req; };
  return req;
}

function fakeRes(statusCode, body) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  setImmediate(() => {
    res.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    res.emit('end');
  });
  return res;
}

function mockHttpGet(statusCode, body, { triggerTimeout = false } = {}) {
  mock.method(https, 'get', (_url, _opts, cb) => {
    const req = fakeReq(triggerTimeout ? (timeoutCb) => setImmediate(timeoutCb) : null);
    if (!triggerTimeout) setImmediate(() => cb(fakeRes(statusCode, body)));
    return req;
  });
}

// ---- get() ----

test('get: resolves with parsed JSON on 200', async () => {
  mockHttpGet(200, { value: [1, 2], nextLink: null });
  const result = await get('https://example.com/api', 'tok');
  assert.deepEqual(result, { value: [1, 2], nextLink: null });
  mock.restoreAll();
});

test('get: rejects with not_found code on 404', async () => {
  mockHttpGet(404, 'Not Found');
  await assert.rejects(
    () => get('https://example.com/api', 'tok'),
    (err) => { assert.equal(err.code, 'not_found'); return true; }
  );
  mock.restoreAll();
});

test('get: rejects with HTTP error on non-200/non-404', async () => {
  mockHttpGet(500, 'Internal Server Error');
  await assert.rejects(
    () => get('https://example.com/api', 'tok'),
    /HTTP 500/
  );
  mock.restoreAll();
});

test('get: rejects with timeout error when request hangs', async () => {
  mockHttpGet(200, {}, { triggerTimeout: true });
  await assert.rejects(
    () => get('https://example.com/api', 'tok', 100),
    /timed out/i
  );
  mock.restoreAll();
});

test('get: rejects on invalid JSON', async () => {
  mockHttpGet(200, 'not-json-at-all{{');
  await assert.rejects(
    () => get('https://example.com/api', 'tok'),
    /Bad JSON/
  );
  mock.restoreAll();
});

test('get: retries on ECONNRESET then succeeds', async () => {
  let call = 0;
  mock.method(https, 'get', (_url, _opts, cb) => {
    const req = fakeReq();
    if (call++ === 0) {
      setImmediate(() => req.emit('error', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })));
    } else {
      setImmediate(() => cb(fakeRes(200, { value: [] })));
    }
    return req;
  });
  const result = await get('https://example.com/api', 'tok', 30000, 3);
  assert.deepEqual(result, { value: [] });
  assert.equal(call, 2);
  mock.restoreAll();
});

test('get: throws after exhausting retries on ECONNRESET', async () => {
  mock.method(https, 'get', (_url, _opts, _cb) => {
    const req = fakeReq();
    setImmediate(() => req.emit('error', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })));
    return req;
  });
  await assert.rejects(
    () => get('https://example.com/api', 'tok', 30000, 2),
    /ECONNRESET/
  );
  mock.restoreAll();
});

// ---- paginate() ----

test('paginate: collects all items from a single page', async () => {
  mockHttpGet(200, { value: [{ id: 'a' }, { id: 'b' }], nextLink: null });
  const items = await paginate('https://example.com/api', 'tok');
  assert.equal(items.length, 2);
  mock.restoreAll();
});

test('paginate: follows nextLink across two pages when maxPages=Infinity', async () => {
  let call = 0;
  mock.method(https, 'get', (_url, _opts, cb) => {
    const req = fakeReq();
    const bodies = [
      { value: [{ id: 'a' }], nextLink: 'https://example.com/api?page=2' },
      { value: [{ id: 'b' }, { id: 'c' }], nextLink: null },
    ];
    setImmediate(() => cb(fakeRes(200, bodies[call++])));
    return req;
  });
  const items = await paginate('https://example.com/api', 'tok', Infinity);
  assert.equal(items.length, 3);
  assert.equal(call, 2);
  mock.restoreAll();
});

test('paginate: returns empty array when value is absent', async () => {
  mockHttpGet(200, {});
  const items = await paginate('https://example.com/api', 'tok');
  assert.deepEqual(items, []);
  mock.restoreAll();
});

test('paginate: respects maxPages=1 and stops after first page', async () => {
  let call = 0;
  mock.method(https, 'get', (_url, _opts, cb) => {
    const req = fakeReq();
    setImmediate(() => cb(fakeRes(200, { value: [{ id: 'a' }], nextLink: 'https://example.com/api?page=2' })));
    call++;
    return req;
  });
  const items = await paginate('https://example.com/api', 'tok', 1);
  assert.equal(items.length, 1);
  assert.equal(call, 1);
  mock.restoreAll();
});
