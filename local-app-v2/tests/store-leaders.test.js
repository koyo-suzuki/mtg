const test = require('node:test');
const assert = require('node:assert/strict');

const sheetsClientPath = require.resolve('../src/sheets/sheets-client');
const storeLeadersPath = require.resolve('../src/sheets/store-leaders');
const DATE = '2026-11-09';

function loadModule({ sheetExists = true, header = [] } = {}) {
  const rows = [];
  const calls = [];
  let exists = sheetExists;
  const fakeClient = {
    async getRows(_id, range) {
      calls.push({ type: 'get', range });
      assert.ok(['store_leaders!A2:N', 'store_leaders!A1:N1'].includes(range), range);
      if (range === 'store_leaders!A1:N1') return [header];
      return rows.map(row => [...row]);
    },
    async appendRows(_id, range, values) {
      calls.push({ type: 'append', range, values });
      rows.push(...values.map(row => [...row]));
    },
    async updateRange(_id, range, values) {
      calls.push({ type: 'update', range, values });
      const match = range.match(/^store_leaders!A(\d+):N(\d+)$/);
      assert.ok(match, `unexpected range ${range}`);
      const sheetRow = Number(match[1]);
      if (sheetRow === 1) return; // header
      assert.ok(rows[sheetRow - 2], 'update must target an existing row');
      rows[sheetRow - 2] = [...values[0]];
    },
    async getSpreadsheetMetadata() {
      return { sheets: exists ? [{ properties: { title: 'store_leaders', sheetId: 1 } }] : [] };
    },
    async batchUpdateSpreadsheet(_id, requests) {
      calls.push({ type: 'batch', requests });
      if (requests.some(r => r.addSheet)) exists = true;
    },
  };
  delete require.cache[storeLeadersPath];
  require.cache[sheetsClientPath] = { id: sheetsClientPath, filename: sheetsClientPath, loaded: true, exports: fakeClient };
  const mod = require(storeLeadersPath);
  return { mod, rows, calls };
}

const active = (rows, store, position) => rows
  .filter(r => r[1] === DATE && r[2] === store && r[3] === position && !r[7] && !r[11]);

test('enter records leader and kennin stores, replacing current holders', async () => {
  const { mod, rows } = loadModule();
  await mod.enterStoreLeader({ date: DATE, storeCodes: ['AKB1'], position: 'leader', gmail: 'miku@example.com', castName: 'みく', editorEmail: 'miku@example.com' });
  await mod.enterStoreLeader({ date: DATE, storeCodes: ['AKB1', 'NNB'], position: 'leader', gmail: 'Ayane@example.com', castName: 'あやね', editorEmail: 'ayane@example.com' });

  assert.equal(active(rows, 'AKB1', 'leader').length, 1);
  assert.equal(active(rows, 'AKB1', 'leader')[0][4], 'ayane@example.com');
  assert.equal(active(rows, 'NNB', 'leader')[0][5], 'あやね');
  const miku = rows.find(r => r[4] === 'miku@example.com');
  assert.ok(miku[7], 'previous leader is ended, not deleted');
  assert.equal(miku[11], '');
});

test('entering the same role twice does not duplicate', async () => {
  const { mod, rows } = loadModule();
  const input = { date: DATE, storeCodes: ['AKB1'], position: 'sub', gmail: 'yuna@example.com', castName: 'ゆな', editorEmail: 'yuna@example.com' };
  await mod.enterStoreLeader(input);
  const result = await mod.enterStoreLeader(input);
  assert.equal(result.added, 0);
  assert.equal(rows.length, 1);
});

test('switching from sub to leader in the same store ends the sub record', async () => {
  const { mod, rows } = loadModule();
  const base = { date: DATE, storeCodes: ['AKB1'], gmail: 'yuna@example.com', castName: 'ゆな', editorEmail: 'yuna@example.com' };
  await mod.enterStoreLeader({ ...base, position: 'sub' });
  await mod.enterStoreLeader({ ...base, position: 'leader' });
  assert.equal(active(rows, 'AKB1', 'sub').length, 0);
  assert.equal(active(rows, 'AKB1', 'leader').length, 1);
});

test('handover ends own record and starts the next person', async () => {
  const { mod, rows } = loadModule();
  await mod.enterStoreLeader({ date: DATE, storeCodes: ['AKB1'], position: 'leader', gmail: 'ayane@example.com', castName: 'あやね', editorEmail: 'ayane@example.com' });
  const id = rows[0][0];

  await assert.rejects(
    mod.handoverStoreLeader({ date: DATE, id, toGmail: 'miku@example.com', toCastName: 'みく', editorEmail: 'other@example.com' }),
    /自分の担当だけ/
  );
  await mod.handoverStoreLeader({ date: DATE, id, toGmail: 'miku@example.com', toCastName: 'みく', editorEmail: 'ayane@example.com' });
  const now = active(rows, 'AKB1', 'leader');
  assert.equal(now.length, 1);
  assert.equal(now[0][4], 'miku@example.com');
  assert.equal(now[0][8], 'ayane@example.com', 'createdBy is the person who handed over');
  assert.ok(rows[0][7]);
});

test('end and delete only touch own records', async () => {
  const { mod, rows } = loadModule();
  await mod.enterStoreLeader({ date: DATE, storeCodes: ['AKB1', 'IKB'], position: 'leader', gmail: 'riri@example.com', castName: 'りり', editorEmail: 'riri@example.com' });
  const [a, b] = rows.map(r => r[0]);

  await assert.rejects(mod.endStoreLeaders({ date: DATE, ids: [a], editorEmail: 'x@example.com' }), /終了できる担当がありません/);
  await mod.endStoreLeaders({ date: DATE, ids: [a], editorEmail: 'riri@example.com' });
  assert.ok(rows[0][7]);
  assert.equal(rows[1][7], '');

  await mod.deleteStoreLeader({ date: DATE, id: b, editorEmail: 'riri@example.com' });
  assert.ok(rows[1][11]);
  const listed = await mod.getStoreLeaders(DATE);
  assert.deepEqual(listed.map(r => r.id), [a]);
});

test('creates the sheet with a header when it does not exist', async () => {
  const { mod, calls } = loadModule({ sheetExists: false });
  await mod.enterStoreLeader({ date: DATE, storeCodes: ['AKB1'], position: 'leader', gmail: 'a@example.com', castName: 'a', editorEmail: 'a@example.com' });
  assert.ok(calls.some(c => c.type === 'batch' && c.requests[0].addSheet.properties.title === 'store_leaders'));
  const header = calls.find(c => c.type === 'update' && c.range === 'store_leaders!A1:N1');
  assert.deepEqual(header.values[0], mod.HEADER);
});

test('summary counts days, kennin and hours per person', () => {
  const { mod } = loadModule();
  const rec = (date, store, position, start, end, extra = {}) => ({
    id: `${date}-${store}-${position}`, businessDate: date, storeCode: store, position,
    gmail: 'riri@example.com', castName: 'りり', startAt: start, endAt: end, deletedAt: '', ...extra,
  });
  const summary = mod.summarize([
    rec('2026-11-01', 'IKB', 'leader', '2026-11-01T09:00:00Z', '2026-11-01T13:00:00Z'),
    rec('2026-11-01', 'SJK', 'leader', '2026-11-01T09:00:00Z', '2026-11-01T13:00:00Z'),
    rec('2026-11-02', 'IKB', 'sub', '2026-11-02T09:00:00Z', '2026-11-02T11:30:00Z'),
    rec('2026-11-03', 'IKB', 'leader', '2026-11-03T09:00:00Z', '', {}), // 終了押し忘れ → 翌朝5時(JST)で打ち切り
    rec('2026-11-04', 'IKB', 'leader', '2026-11-04T09:00:00Z', '2026-11-04T10:00:00Z', { deletedAt: 'x' }),
    rec('2026-10-31', 'IKB', 'leader', '2026-10-31T09:00:00Z', '2026-10-31T10:00:00Z'),
  ], { month: '2026-11', now: Date.parse('2026-11-20T00:00:00Z') });

  assert.equal(summary.length, 1);
  const p = summary[0];
  assert.equal(p.leaderDays, 2);
  assert.equal(p.subDays, 1);
  assert.equal(p.kenninDays, 1);
  assert.equal(p.maxStores, 2);
  // 4h + 4h + 2.5h + (09:00Z → 翌20:00Z = 11h)
  assert.equal(p.hours, 21.5);
});

test('summary filtered by store keeps kennin info but only that store time', () => {
  const { mod } = loadModule();
  const base = { gmail: 'riri@example.com', castName: 'りり', deletedAt: '', businessDate: '2026-11-01', position: 'leader' };
  const summary = mod.summarize([
    { ...base, id: '1', storeCode: 'IKB', startAt: '2026-11-01T09:00:00Z', endAt: '2026-11-01T10:00:00Z' },
    { ...base, id: '2', storeCode: 'SJK', startAt: '2026-11-01T09:00:00Z', endAt: '2026-11-01T12:00:00Z' },
  ], { month: '2026-11', storeCode: 'IKB' });
  assert.equal(summary[0].hours, 1);
  assert.equal(summary[0].kenninDays, 1);
  assert.deepEqual(mod.summarize([{ ...base, id: '3', storeCode: 'SJK', startAt: '', endAt: '' }], { month: '2026-11', storeCode: 'IKB' }), []);
});

test('existing sheet with the old 12-column header gets the new columns added', async () => {
  const oldHeader = ['id', 'businessDate', 'storeCode', 'position', 'gmail', 'castName', 'startAt', 'endAt', 'createdBy', 'createdAt', 'updatedAt', 'deletedAt'];
  const { mod, calls } = loadModule({ header: oldHeader });
  await mod.enterStoreLeader({ date: DATE, storeCodes: ['AKB1'], position: 'leader', gmail: 'a@example.com', castName: 'a', editorEmail: 'a@example.com' });
  const header = calls.find(c => c.type === 'update' && c.range === 'store_leaders!A1:N1');
  assert.deepEqual(header.values[0], mod.HEADER);
  assert.deepEqual(mod.HEADER.slice(12), ['updatedBy', 'note']);
});

test('history returns month records and summary, limited to one person when asked', async () => {
  const { mod } = loadModule();
  await mod.enterStoreLeader({ date: DATE, storeCodes: ['AKB1', 'IKB'], position: 'leader', gmail: 'riri@example.com', castName: 'りり', editorEmail: 'riri@example.com' });
  await mod.enterStoreLeader({ date: DATE, storeCodes: ['SJK'], position: 'sub', gmail: 'yuna@example.com', castName: 'ゆな', editorEmail: 'yuna@example.com' });
  await mod.enterStoreLeader({ date: '2026-10-31', storeCodes: ['SJK'], position: 'leader', gmail: 'yuna@example.com', castName: 'ゆな', editorEmail: 'yuna@example.com' });

  const all = await mod.getStoreLeaderHistory({ month: '2026-11', today: '2026-11-10' });
  assert.equal(all.records.length, 3);
  const riri = all.summary.find(p => p.castName === 'りり');
  assert.equal(riri.storeDays, 2);
  assert.equal(riri.kenninDays, 1);
  assert.equal(riri.unfinished, 2, 'past business date without end is flagged');

  const own = await mod.getStoreLeaderHistory({ month: '2026-11', gmail: 'YUNA@example.com', today: '2026-11-10' });
  assert.deepEqual(own.records.map(r => r.castName), ['ゆな']);
  assert.deepEqual(own.summary.map(p => p.castName), ['ゆな']);

  const store = await mod.getStoreLeaderHistory({ month: '2026-11', storeCode: 'IKB', today: '2026-11-10' });
  assert.deepEqual(store.records.map(r => r.storeCode), ['IKB']);
});
