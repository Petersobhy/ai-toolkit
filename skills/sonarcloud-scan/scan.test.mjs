// Uses Node built-in test runner (node:test) — no external dependencies
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'https';
import { EventEmitter } from 'events';

import {
  parseArgs,
  stripProjectKey,
  buildResult,
  SEVERITY_FILTER,
  HOTSPOT_PROB_FILTER,
  CATEGORIES,
  DEFAULT_CATEGORIES,
  get,
  paginate,
} from './scan.mjs';

// --- parseArgs ---

test('parseArgs: defaults when no args', () => {
  const result = parseArgs([]);
  assert.equal(result.severity, 'critical');
  assert.equal(result.repo, null);
  assert.deepEqual(result.categories, DEFAULT_CATEGORIES);
});

test('parseArgs: reads --severity and --repo', () => {
  const result = parseArgs(['--severity', 'critical', '--repo', 'my-service']);
  assert.equal(result.severity, 'critical');
  assert.equal(result.repo, 'my-service');
});

test('parseArgs: unknown flags do not crash', () => {
  const result = parseArgs(['--unknown', 'foo', '--repo', 'svc']);
  assert.equal(result.repo, 'svc');
  assert.equal(result.severity, 'critical');
});

test('parseArgs: --all sets all flag', () => {
  const result = parseArgs(['--all', '--repo', 'svc']);
  assert.equal(result.all, true);
});

test('parseArgs: all defaults to false', () => {
  const result = parseArgs([]);
  assert.equal(result.all, false);
});

test('parseArgs: --categories parses comma-separated list', () => {
  const result = parseArgs(['--categories', 'vulnerability,bug']);
  assert.deepEqual(result.categories, ['vulnerability', 'bug']);
});

test('parseArgs: --categories all expands to full list', () => {
  const result = parseArgs(['--categories', 'all']);
  assert.deepEqual(result.categories, CATEGORIES);
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
const defaultCategories = ['vulnerability'];

test('buildResult: maps issues correctly', () => {
  const result = buildResult({
    projectKey,
    severity: 'high',
    categories: defaultCategories,
    rawIssues: [{
      type: 'VULNERABILITY',
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
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].file, 'src/auth.ts');
  assert.equal(result.issues[0].severity, 'CRITICAL');
  assert.equal(result.issues[0].category, 'vulnerability');
  assert.equal(result.summary.total_issues, 1);
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
    categories: ['hotspot'],
    rawIssues: [],
    rawHotspots: hotspots,
    probFilter: HOTSPOT_PROB_FILTER.high,
  });

  assert.equal(result.hotspots.length, 2);
  assert.equal(result.summary.total_hotspots, 2);
  assert.ok(result.hotspots.every(h => ['HIGH', 'MEDIUM'].includes(h.probability)));
});

test('buildResult: null effort and line are preserved as null', () => {
  const result = buildResult({
    projectKey,
    severity: 'high',
    categories: defaultCategories,
    rawIssues: [{ type: 'VULNERABILITY', severity: 'MAJOR', rule: 'r', component: `${projectKey}:f.ts`, message: 'm' }],
    rawHotspots: [],
    probFilter: HOTSPOT_PROB_FILTER.high,
  });

  assert.equal(result.issues[0].line, null);
  assert.equal(result.issues[0].effort, null);
});

test('buildResult: includes categories in output', () => {
  const result = buildResult({
    projectKey, severity: 'high', categories: ['vulnerability', 'bug'],
    rawIssues: [], rawHotspots: [], probFilter: HOTSPOT_PROB_FILTER.high,
  });
  assert.deepEqual(result.categories, ['vulnerability', 'bug']);
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
  mockHttpGet(200, { issues: [], paging: { total: 0 } });
  const result = await get('https://sonarcloud.io/api/issues/search', 'tok');
  assert.deepEqual(result, { issues: [], paging: { total: 0 } });
  mock.restoreAll();
});

test('get: rejects with not_found code on 404', async () => {
  mockHttpGet(404, 'Not Found');
  await assert.rejects(
    () => get('https://sonarcloud.io/api/components/show?component=org:repo', 'tok'),
    (err) => { assert.equal(err.code, 'not_found'); return true; }
  );
  mock.restoreAll();
});

test('get: rejects with HTTP error on non-200/non-404', async () => {
  mockHttpGet(401, 'Unauthorized');
  await assert.rejects(
    () => get('https://sonarcloud.io/api/issues/search', 'bad-token'),
    /HTTP 401/
  );
  mock.restoreAll();
});

test('get: rejects with timeout error when request hangs', async () => {
  mockHttpGet(200, {}, { triggerTimeout: true });
  await assert.rejects(
    () => get('https://sonarcloud.io/api/issues/search', 'tok', 100),
    /timed out/i
  );
  mock.restoreAll();
});

test('get: rejects on invalid JSON', async () => {
  mockHttpGet(200, '<html>error page</html>');
  await assert.rejects(
    () => get('https://sonarcloud.io/api/issues/search', 'tok'),
    /Bad JSON/
  );
  mock.restoreAll();
});

// ---- paginate() ----

test('paginate: collects all items from a single page', async () => {
  mockHttpGet(200, { issues: [{ severity: 'CRITICAL' }, { severity: 'MAJOR' }], paging: { total: 2 } });
  const items = await paginate(() => 'https://sonarcloud.io/api/issues/search', 'tok', 'issues');
  assert.equal(items.length, 2);
  mock.restoreAll();
});

test('paginate: follows page numbers across two pages when maxPages=Infinity', async () => {
  let call = 0;
  mock.method(https, 'get', (_url, _opts, cb) => {
    const req = fakeReq();
    const bodies = [
      { issues: [{ severity: 'CRITICAL' }], paging: { total: 3 } },
      { issues: [{ severity: 'MAJOR' }, { severity: 'MAJOR' }], paging: { total: 3 } },
    ];
    setImmediate(() => cb(fakeRes(200, bodies[call++])));
    return req;
  });
  const items = await paginate((p) => `https://sonarcloud.io/api/issues/search?p=${p}&ps=100`, 'tok', 'issues', Infinity);
  assert.equal(items.length, 3);
  assert.equal(call, 2);
  mock.restoreAll();
});

test('paginate: returns empty array when key is absent', async () => {
  mockHttpGet(200, { paging: { total: 0 } });
  const items = await paginate(() => 'https://sonarcloud.io/api/issues/search', 'tok', 'issues');
  assert.deepEqual(items, []);
  mock.restoreAll();
});

test('paginate: respects maxPages=1 and stops after first page', async () => {
  let call = 0;
  mock.method(https, 'get', (_url, _opts, cb) => {
    const req = fakeReq();
    setImmediate(() => cb(fakeRes(200, { issues: [{ severity: 'CRITICAL' }], paging: { total: 50 } })));
    call++;
    return req;
  });
  const items = await paginate(() => 'https://sonarcloud.io/api/issues/search', 'tok', 'issues', 1);
  assert.equal(items.length, 1);
  assert.equal(call, 1); // only one page fetched
  mock.restoreAll();
});

test('paginate: stops when batch is empty before reaching total', async () => {
  let call = 0;
  mock.method(https, 'get', (_url, _opts, cb) => {
    const req = fakeReq();
    // total says 5 but second page returns empty — should stop
    const bodies = [
      { issues: [{ severity: 'MAJOR' }], paging: { total: 5 } },
      { issues: [], paging: { total: 5 } },
    ];
    setImmediate(() => cb(fakeRes(200, bodies[call++])));
    return req;
  });
  const items = await paginate((p) => `https://sonarcloud.io/api/issues/search?p=${p}&ps=100`, 'tok', 'issues', Infinity);
  assert.equal(items.length, 1);
  assert.equal(call, 2);
  mock.restoreAll();
});
