const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  daysRemaining,
  nextDueDate,
  parseReminderDays,
  renewalValid,
  filterServers,
  aggregateStatus,
  reminderCandidates,
  DEFAULT_REMINDERS,
  localDate,
} = require('../dist-electron/src/shared/serverManagement.js');
const { serialWriter } = require('../dist-electron/src/shared/serialWriter.js');
const server = (id, dueDate, extra = {}) => ({
  id,
  name: id,
  host: 'example.test',
  username: 'root',
  port: 22,
  authType: 'password',
  password: 'test-secret',
  ...(dueDate ? { renewal: { dueDate, cycle: 1, currency: 'CNY' } } : {}),
  ...extra,
});

test('homepage restores filters and scroll after async server loading and remount', async () => {
  const React = require('react');
  const { act, create } = require('react-test-renderer');
  const { createServer } = await import('vite');
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  let stored = JSON.stringify({ query: 'cloud', group: 'company', tags: ['prod'], limit: 100, scrollTop: 420 });
  const previousStorage = global.localStorage;
  global.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  let renderer, api;
  const node = { scrollTop: 0 };
  try {
    const { useHomePreferences } = await vite.ssrLoadModule('/src/hooks/useHomePreferences.ts');
    function Harness({ count }) {
      api = useHomePreferences(count);
      return React.createElement('div', { ref: api.listRef });
    }
    await act(async () => { renderer = create(React.createElement(Harness, { count: 0 }), { createNodeMock: () => node }); });
    assert.equal(api.group, 'company');
    assert.deepEqual(api.tags, ['prod']);
    assert.equal(api.query, 'cloud');
    assert.equal(node.scrollTop, 0);
    assert.equal(JSON.parse(stored).scrollTop, 420, 'empty startup must not overwrite saved scroll');
    await act(async () => { renderer.update(React.createElement(Harness, { count: 200 })); });
    assert.equal(node.scrollTop, 420);
    await act(async () => { api.setGroup('personal'); api.setTags(['test']); api.setLimit(150); });
    node.scrollTop = 760;
    api.onScroll();
    await act(async () => { renderer.unmount(); });
    node.scrollTop = 0;
    await act(async () => { renderer = create(React.createElement(Harness, { count: 200 }), { createNodeMock: () => node }); });
    assert.equal(api.group, 'personal');
    assert.deepEqual(api.tags, ['test']);
    assert.equal(api.limit, 150);
    assert.equal(node.scrollTop, 760);
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    global.localStorage = previousStorage;
    await vite.close();
  }
});

test('page probes cap concurrency at five and abandon old page queues', async () => {
  const React = require('react');
  const { act, create } = require('react-test-renderer');
  const { createServer } = await import('vite');
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  const pending = [];
  const targets = [];
  let active = 0, peak = 0, renderer;
  global.window = { electron: { probeHost: ({ host }) => {
    targets.push(host); active++; peak = Math.max(peak, active);
    return new Promise(resolve => pending.push(() => { active--; resolve({ ok: true, ms: 17 }); }));
  } } };
  try {
    const { useHostProbes } = await vite.ssrLoadModule('/src/hooks/useHostProbes.ts');
    function Harness({ connections }) { useHostProbes(connections); return null; }
    const first = Array.from({ length: 12 }, (_, i) => ({ ...server(`a${i}`), host: `a${i}` }));
    const second = Array.from({ length: 6 }, (_, i) => ({ ...server(`b${i}`), host: `b${i}` }));
    await act(async () => { renderer = create(React.createElement(Harness, { connections: first })); });
    assert.equal(active, 5);
    await act(async () => { renderer.update(React.createElement(Harness, { connections: second })); });
    assert.equal(targets.length, 5, 'new page waits for in-flight probes');
    await act(async () => { pending.splice(0).forEach(done => done()); });
    assert.equal(targets.length, 10);
    assert.equal(targets.filter(host => host.startsWith('a')).length, 5);
    await act(async () => { pending.splice(0).forEach(done => done()); });
    assert.equal(targets.length, 11);
    await act(async () => { pending.splice(0).forEach(done => done()); });
    assert.equal(peak, 5);
    await act(async () => { renderer.update(React.createElement(Harness, { connections: second.map(c => ({ ...c, name: 'renamed' })) })); });
    assert.equal(targets.length, 11, 'metadata changes do not restart probing');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    pending.splice(0).forEach(done => done());
    await vite.close(); delete global.window;
  }
});

test('calendar dates handle leap days, invalid dates, year changes and DST without elapsed-hour errors', () => {
  assert.equal(daysRemaining('2028-02-29', '2028-02-28'), 1);
  assert.equal(daysRemaining('2027-02-29', '2027-02-28'), null);
  assert.equal(daysRemaining('2027-01-01', '2026-12-31'), 1);
  assert.equal(daysRemaining('2026-03-09', '2026-03-08'), 1);
  assert.equal(daysRemaining('2026-11-02', '2026-11-01'), 1);
  assert.equal(daysRemaining('2026-10-26', '2026-10-26'), 0);
  assert.equal(daysRemaining('2026-10-25', '2026-10-26'), -1);
  assert.equal(daysRemaining(undefined), null);
  assert.equal(nextDueDate('2028-01-31', 1), '2028-02-29');
  assert.equal(nextDueDate('2028-02-29', 12), '2029-02-28');
  assert.equal(nextDueDate('2026-11-30', 3), '2027-02-28');
  assert.equal(localDate(new Date(2026, 9, 26, 23, 59)), '2026-10-26');
});

test('legacy connection restore preserves credentials and drafts; failed restore cannot overwrite storage', async () => {
  const React = require('react');
  const { act, create } = require('react-test-renderer');
  const { createServer } = await import('vite');
  const vite = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  const legacy = server('legacy');
  const values = { connections: [legacy], connectionDraft: { data: { host: 'draft.test', password: 'draft-key' }, savedAt: 1 }, lastConnectedAt: { legacy: 123 }, language: 'zh' };
  let failRead = false, writes = 0, api, renderer;
  global.window = { electron: {
    storeGet: async key => { if (failRead && key === 'serverCatalog') throw Error('read failed'); return values[key]; },
    saveServerManagement: async next => { writes++; Object.assign(values, next); },
    logWrite: () => {},
  } };
  try {
    const { useConnections } = await vite.ssrLoadModule('/src/hooks/useConnections.ts');
    function Harness() { api = useConnections(); return null; }
    await act(async () => { renderer = create(React.createElement(Harness)); });
    assert.equal(api.restored, true);
    assert.equal(api.connections[0].password, 'test-secret');
    assert.equal(api.draft.data.password, 'draft-key');
    assert.equal(api.lastConnectedAt.legacy, 123);
    assert.equal(api.catalog.groups[0].name, '个人');
    await act(async () => { await api.updateManagement(current => ({ ...current, connections: current.connections.map(c => ({ ...c, groupId: 'personal' })) })); });
    assert.equal(values.connections[0].password, 'test-secret');
    assert.equal(values.connections[0].groupId, 'personal');
    await act(async () => renderer.unmount());
    failRead = true;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await assert.rejects(api.upsert(server('new')), /could not be restored/);
    assert.equal(writes, 1);
    assert.equal(values.connections.length, 1);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await vite.close(); delete global.window;
  }
});
test('renewal input validates currency, amount and custom reminder nodes', () => {
  assert.deepEqual(parseReminderDays('7, 30，7 0'), [30, 7, 0]);
  for (const text of ['', '-1', '1.5', '3651', 'abc']) assert.equal(parseReminderDays(text), null);
  const r = { cycle: 0, currency: 'CNY' };
  assert.equal(renewalValid(r), true);
  for (const patch of [
    { amount: -1 },
    { amount: NaN },
    { currency: 'C' },
    { cycle: 2 },
    { dueDate: '2026-02-30' },
    { reminder: 'custom', days: [] },
  ])
    assert.equal(renewalValid({ ...r, ...patch }), false);
});
test('filters intersect dimensions, OR tags, aggregate multiple sessions, sort missing dates last', () => {
  const catalog = {
    groups: [{ id: 'g', name: 'Company A' }],
    tags: [
      { id: 'p', name: 'Production' },
      { id: 't', name: 'Testing' },
    ],
  };
  const a = server('a', '2026-10-28', { groupId: 'g', tagIds: ['p'] });
  const b = server('b', '2026-10-27', { tagIds: ['t'] });
  const old = server('old');
  const sessions = [
    { connection: a, status: 'disconnected' },
    { connection: a, status: 'connected' },
  ];
  const base = { query: '', group: '', tags: [], status: '', due: '', sort: 'due' };
  const filter = (patch) =>
    filterServers([old, a, b], sessions, catalog, { ...base, ...patch }, {}, '2026-10-26').map((c) => c.id);
  assert.equal(aggregateStatus(sessions, 'a'), 'connected');
  assert.deepEqual(filter({}), ['b', 'a', 'old']);
  assert.deepEqual(filter({ tags: ['p', 't'] }), ['b', 'a']);
  assert.deepEqual(filter({ tags: ['p', 't'], group: 'g', status: 'connected', due: 'upcoming' }), ['a']);
  assert.deepEqual(filter({ query: 'production' }), ['a']);
  assert.deepEqual(filter({ query: 'company' }), ['a']);
  assert.deepEqual(filter({ group: 'ungrouped', due: 'unset' }), ['old']);
});
test('reminders catch missed nodes without replaying daily, obey overrides and expiry changes', () => {
  const c = server('a', '2026-11-25');
  const testAt = (today, ledger = { seen: {} }, settings = DEFAULT_REMINDERS, connection = c) =>
    reminderCandidates([connection], settings, ledger, today).length;
  assert.equal(testAt('2026-10-25'), 0);
  assert.equal(testAt('2026-10-26'), 1);
  assert.equal(testAt('2026-11-01'), 1, 'startup catches a missed 30-day node');
  const ledger = { lastDate: '2026-10-26', seen: { 'a:2026-11-25': 30 } };
  assert.equal(testAt('2026-10-26', ledger), 0);
  assert.equal(testAt('2026-10-27', ledger), 0);
  for (const day of ['2026-11-18', '2026-11-22', '2026-11-24', '2026-11-25', '2026-11-26'])
    assert.equal(testAt(day, ledger), 1);
  assert.equal(testAt('2026-11-20', ledger), 1, 'resume catches crossed seven-day node');
  assert.equal(testAt('2026-11-26', { lastDate: '2026-11-26', seen: {} }), 0);
  assert.equal(testAt('2026-11-27', { lastDate: '2026-11-26', seen: {} }), 1);
  assert.equal(testAt('2026-11-18', ledger, { ...DEFAULT_REMINDERS, enabled: false }), 0);
  assert.equal(
    testAt('2026-11-18', ledger, DEFAULT_REMINDERS, { ...c, renewal: { ...c.renewal, reminder: 'off' } }),
    0,
  );
  assert.equal(
    testAt('2026-11-18', ledger, DEFAULT_REMINDERS, { ...c, renewal: { ...c.renewal, reminder: 'custom', days: [2] } }),
    0,
  );
  assert.equal(
    testAt('2026-11-18', ledger, DEFAULT_REMINDERS, server('a', '2026-12-18')),
    1,
    'new due date has its own reminder state',
  );
});
test('serialized mutations keep credentials and do not publish failed saves or overwrite later updates', async () => {
  let published = [server('legacy')];
  let fail = true;
  const writer = serialWriter(
    published,
    async () => {
      await Promise.resolve();
      if (fail) {
        fail = false;
        throw Error('disk full');
      }
    },
    (value) => {
      published = value;
    },
  );
  const failed = writer.update((cs) => cs.map((c) => ({ ...c, name: 'failed' })));
  const second = writer.update((cs) => cs.map((c) => ({ ...c, groupId: 'personal' })));
  const third = writer.update((cs) => cs.map((c) => ({ ...c, tagIds: ['test'] })));
  await assert.rejects(failed, /disk full/);
  await Promise.all([second, third]);
  assert.equal(published[0].name, 'legacy');
  assert.equal(published[0].groupId, 'personal');
  assert.deepEqual(published[0].tagIds, ['test']);
  assert.equal(published[0].password, 'test-secret');
});
