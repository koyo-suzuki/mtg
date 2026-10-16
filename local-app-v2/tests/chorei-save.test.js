const test = require('node:test');
const assert = require('node:assert/strict');

const sheetsClientPath = require.resolve('../src/sheets/sheets-client');
const dataStorePath = require.resolve('../src/sheets/data-store');
const DATE = '2026-10-16';
const SHEET_ID = 123;

function castRow(store, email, overrides = {}) {
  return [DATE, store, email.split('@')[0], email, '1000', '3', '2', 'goal', 'memo', '1', 'destination', '2026-10-16T08:00:00Z']
    .map((value, index) => Object.hasOwn(overrides, index) ? overrides[index] : value);
}

function castInput(email, overrides = {}) {
  return { castName: email.split('@')[0], gmail: email, monthlySales: 2000, monthlyDrinks: 5,
    expectedVisitors: 4, castGoal: 'new goal', managerMemo: '', needsPickup: false, pickupDestination: '', ...overrides };
}

function loadStore(initialChorei, initialShurei = [], options = {}) {
  const rows = initialChorei.map(row => [...row]);
  const shureiRows = initialShurei.map(row => [...row]);
  const calls = [];
  const fakeClient = {
    async getRows(_id, range) {
      calls.push({ type: 'get', range });
      if (range === 'chorei!A2:L') return rows.map(row => [...row]);
      if (range === 'shurei!A2:E') return shureiRows.map(row => [...row]);
      if (range === 'chorei!A2:L10000') return rows.slice(0, 9999).map(row => [...row]);
      throw new Error(`Unexpected read: ${range}`);
    },
    async getSpreadsheetMetadata() {
      calls.push({ type: 'metadata' });
      return { sheets: [{ properties: { sheetId: SHEET_ID, title: 'chorei' } }] };
    },
    async batchUpdateSpreadsheet(_id, requests) {
      calls.push({ type: 'batch', requests });
      if (options.failBatch) throw new Error('write failed');
      const next = rows.map(row => [...row]);
      for (const request of requests) {
        if (request.updateCells) {
          const { range, rows: cellRows, fields } = request.updateCells;
          assert.equal(range.sheetId, SHEET_ID);
          assert.equal(fields, 'userEnteredValue');
          assert.equal(range.endRowIndex, range.startRowIndex + 1);
          assert.ok(range.startRowIndex >= 1, 'never write the header');
          const index = range.startRowIndex - 1;
          assert.ok(next[index], 'updates must use an existing physical row');
          cellRows[0].values.forEach((cell, offset) => {
            next[index][range.startColumnIndex + offset] = cell.userEnteredValue.stringValue;
          });
        } else if (request.appendCells) {
          assert.equal(request.appendCells.sheetId, SHEET_ID);
          next.push(...request.appendCells.rows.map(row => row.values.map(cell => cell.userEnteredValue.stringValue)));
        } else {
          assert.fail('must not move or delete physical rows');
        }
      }
      rows.splice(0, rows.length, ...next);
    },
    async appendRows(_id, range, values) {
      calls.push({ type: 'append', range });
      const target = range.startsWith('chorei!') ? rows : shureiRows;
      target.push(...values.map(row => [...row]));
    },
    async updateRange(_id, range, values) {
      calls.push({ type: 'update', range });
      const match = range.match(/^shurei!A(\d+):E\1$/);
      assert.ok(match, 'chorei must never rewrite a whole sheet');
      shureiRows[Number(match[1]) - 2] = [...values[0]];
    },
    async clearRange() { assert.fail('must not clear a whole tail'); },
    async batchGet() { return []; },
    async getValueRange() { return {}; },
  };
  delete require.cache[dataStorePath];
  require.cache[sheetsClientPath] = { id: sheetsClientPath, filename: sheetsClientPath, loaded: true, exports: fakeClient };
  process.env.DATA_SPREADSHEET_ID = 'test-only';
  return { dataStore: require(dataStorePath), rows, shureiRows, calls };
}

test('reads casts past row 10000 and displays only the newest duplicate', async () => {
  const older = castRow('osaka', 'cast@example.test', { 7: 'old', 11: '2026-10-16T07:00:00Z' });
  const newest = castRow('osaka', 'cast@example.test', { 7: 'newest', 11: '2026-10-16T09:00:00Z' });
  const { dataStore } = loadStore([
    ...Array.from({ length: 9999 }, () => []), older, newest,
    castRow('osaka', 'cast@example.test', { 7: 'older physical tail', 11: '2026-10-16T08:00:00Z' }),
  ]);
  const casts = await dataStore.getChoreiByDateStore(DATE, 'osaka');
  assert.equal(casts.length, 1);
  assert.equal(casts[0].castGoal, 'newest');
  assert.equal((await dataStore.getCastStores(DATE, 'cast@example.test')).length, 1);
  assert.equal((await dataStore.getPickupList(DATE)).length, 1);
});

test('updates the newest target row beyond 10000, preserving other stores, history and older duplicates', async () => {
  const historical = castRow('osaka', 'cast@example.test', { 0: '2026-10-15' });
  const older = castRow('osaka', 'cast@example.test', { 11: '2026-10-16T07:00:00Z' });
  const other = castRow('tokyo', 'other@example.test');
  const { dataStore, rows, calls } = loadStore([
    historical, older, ...Array.from({ length: 9997 }, () => []), other,
    castRow('osaka', 'cast@example.test'),
  ]);
  const before = rows.map(row => [...row]);
  await dataStore.saveChoreiCasts(DATE, 'osaka', [castInput('cast@example.test')], 'cast@example.test');
  assert.deepEqual(rows.slice(0, 10000), before.slice(0, 10000));
  assert.equal(rows[10000][4], '2000');
  assert.equal(rows.length, before.length);
  const batch = calls.find(call => call.type === 'batch');
  assert.equal(batch.requests.length, 1);
  assert.equal(batch.requests[0].updateCells.range.startRowIndex, 10001);
});

test('adds and removes only target-store casts in one atomic write, without shifting other rows', async () => {
  const other = castRow('tokyo', 'other@example.test');
  const { dataStore, rows, calls } = loadStore([
    castRow('osaka', 'removed@example.test'), other, castRow('osaka', 'kept@example.test'),
  ]);
  await dataStore.saveChoreiCasts(DATE, 'osaka', [castInput('kept@example.test'), castInput('new@example.test')], undefined, [{ gmail: 'removed@example.test' }]);
  assert.deepEqual(rows[0].slice(0, 11), [DATE, 'osaka', ...Array(9).fill('')]);
  assert.deepEqual(rows[1], other);
  assert.equal(rows[2][3], 'kept@example.test');
  assert.equal(rows[3][3], 'new@example.test');
  assert.equal(calls.filter(call => call.type === 'batch').length, 1);
  assert.equal(calls.filter(call => call.type === 'append').length, 0);
});

test('a failed atomic write leaves edits, removals and additions unapplied', async () => {
  const { dataStore, rows } = loadStore([castRow('osaka', 'old@example.test')], [], { failBatch: true });
  const before = rows.map(row => [...row]);
  await assert.rejects(dataStore.saveChoreiCasts(DATE, 'osaka', [castInput('new@example.test')], undefined, [{ gmail: 'old@example.test' }]), /write failed/);
  assert.deepEqual(rows, before);
});

test('concurrent saves at two stores preserve both changes and all physical row positions', async () => {
  const { dataStore, rows } = loadStore([castRow('osaka', 'a@example.test'), castRow('tokyo', 'b@example.test')]);
  await Promise.all([
    dataStore.saveChoreiCasts(DATE, 'osaka', [castInput('a@example.test'), castInput('new-a@example.test')]),
    dataStore.saveChoreiCasts(DATE, 'tokyo', [castInput('b@example.test'), castInput('new-b@example.test')]),
  ]);
  assert.equal(rows[0][3], 'a@example.test');
  assert.equal(rows[0][4], '2000');
  assert.equal(rows[1][3], 'b@example.test');
  assert.equal(rows[1][4], '2000');
  assert.deepEqual(rows.slice(2).map(row => row[3]).sort(), ['new-a@example.test', 'new-b@example.test']);
});

test('manager sales save and personal goal save preserve each other under concurrent updates', async () => {
  const { dataStore, rows } = loadStore([castRow('osaka', 'cast@example.test')]);
  await Promise.all([
    dataStore.saveChoreiCasts(DATE, 'osaka', [castInput('cast@example.test')], 'manager@example.test'),
    dataStore.saveCastGoal(DATE, 'osaka', 'cast@example.test', {
      castName: 'cast', goal: 'personal update', expectedVisitors: 7, needsPickup: true, pickupDestination: 'new destination',
    }),
  ]);
  assert.equal(rows[0][4], '2000');
  assert.equal(rows[0][5], '5');
  assert.equal(rows[0][6], '7');
  assert.equal(rows[0][7], 'personal update');
  assert.equal(rows[0][8], 'memo');
  assert.equal(rows[0][10], 'new destination');
});

test('personal goal updates the latest duplicate beyond 10000 without appending or altering sales', async () => {
  const older = castRow('osaka', 'cast@example.test', { 11: '2026-10-16T07:00:00Z' });
  const { dataStore, rows, calls } = loadStore([older, ...Array.from({ length: 9998 }, () => []), castRow('osaka', 'cast@example.test')]);
  await dataStore.saveCastGoal(DATE, 'osaka', 'cast@example.test', { goal: 'saved', expectedVisitors: 9 });
  assert.deepEqual(rows[0], older);
  assert.equal(rows[9999][4], '1000');
  assert.equal(rows[9999][7], 'saved');
  assert.equal(calls.filter(call => call.type === 'append').length, 0);
});

test('rejects duplicate or incomplete cast payloads before any writes', async () => {
  const { dataStore, calls } = loadStore([castRow('osaka', 'cast@example.test')]);
  await assert.rejects(dataStore.saveChoreiCasts(DATE, 'osaka', [castInput('cast@example.test'), castInput('CAST@example.test')]), /重複/);
  await assert.rejects(dataStore.saveChoreiCasts(DATE, '', []));
  assert.equal(calls.length, 0);
});

test('stale or empty client lists never remove casts that were not explicitly deleted', async () => {
  const existing = [castRow('osaka', 'a@example.test'), castRow('osaka', 'b@example.test')];
  const { dataStore, rows } = loadStore(existing);
  await dataStore.saveChoreiCasts(DATE, 'osaka', []);
  assert.deepEqual(rows, existing);
  await dataStore.saveChoreiCasts(DATE, 'osaka', [castInput('new@example.test')]);
  assert.deepEqual(rows.slice(0, 2), existing);
});

test('explicit removal clears all duplicate rows only at the selected store and date', async () => {
  const other = castRow('tokyo', 'removed@example.test');
  const history = castRow('osaka', 'removed@example.test', { 0: '2026-10-15' });
  const { dataStore, rows } = loadStore([
    castRow('osaka', 'removed@example.test'), other, history, castRow('osaka', 'removed@example.test'),
  ]);
  await dataStore.saveChoreiCasts(DATE, 'osaka', [], undefined, [{ gmail: 'removed@example.test' }]);
  assert.deepEqual(rows[0].slice(0, 11), [DATE, 'osaka', ...Array(9).fill('')]);
  assert.deepEqual(rows[1], other);
  assert.deepEqual(rows[2], history);
  assert.deepEqual(rows[3].slice(0, 11), [DATE, 'osaka', ...Array(9).fill('')]);
  assert.equal((await dataStore.getChoreiByDateStore(DATE, 'osaka')).length, 0);
});

test('new personal goals append after existing data even when there are empty rows in the middle', async () => {
  const other = castRow('tokyo', 'other@example.test');
  const { dataStore, rows, calls } = loadStore([[], [], other]);
  await dataStore.saveCastGoal(DATE, 'osaka', 'new@example.test', { castName: 'new', goal: 'saved' });
  assert.deepEqual(rows[2], other);
  assert.equal(rows[3][3], 'new@example.test');
  assert.equal(calls.filter(call => call.type === 'append').length, 0);
});

test('shurei reads and updates beyond row 5000 without duplicating or touching other stores', async () => {
  const other = [DATE, 'tokyo', '900', '9000', 'old'];
  const { dataStore, shureiRows, calls } = loadStore([], [other, ...Array.from({ length: 4998 }, () => []), [DATE, 'osaka', '100', '1000', 'old']]);
  assert.equal((await dataStore.getShureiByDateStore(DATE, 'osaka')).salesToday, 100);
  await dataStore.saveShurei(DATE, 'osaka', { salesToday: 200, monthlySales: 1200 });
  assert.deepEqual(shureiRows[0], other);
  assert.equal(shureiRows[4999][2], '200');
  assert.equal(shureiRows.length, 5000);
  assert.equal((await dataStore.getShureiByDateStore(DATE, 'osaka')).salesToday, 200);
  assert.equal(calls.filter(call => call.type === 'append').length, 0);
});
