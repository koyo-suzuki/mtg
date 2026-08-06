const test = require('node:test');
const assert = require('node:assert/strict');

const sheetsClientPath = require.resolve('../src/sheets/sheets-client');
const dataStorePath = require.resolve('../src/sheets/data-store');

function loadDataStore(initialRows, options = {}) {
  const calls = [];
  const rows = initialRows.map(row => [...row]);
  const namedRanges = options.namedRanges || [{
    namedRangeId: 'self-eval-202608',
    name: 'self_eval_202608',
    range: { sheetId: 487558682, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
  }];

  const fakeClient = {
    async getValueRange(_spreadsheetId, range) {
      calls.push({ type: 'get', range });
      if (range.startsWith('self_eval_')) {
        const namedRange = namedRanges.find(item => item.name === range);
        if (!namedRange) {
          const error = new Error(`Unable to parse range: ${range}`);
          error.code = 400;
          throw error;
        }
        const startRow = (namedRange.range.startRowIndex || 0) + 1;
        return {
          range: `self_evaluation!A${startRow}:H${Math.max(startRow, rows.length + 1)}`,
          values: rows.slice(startRow - 2).map(row => [...row]),
        };
      }
      return { range, values: [] };
    },
    async getRows(_spreadsheetId, range) {
      calls.push({ type: 'get', range });
      const match = range.match(/^self_evaluation!A(\d+):H\1$/);
      if (match) return [rows[parseInt(match[1], 10) - 2] || []];
      return [];
    },
    async appendRows(_spreadsheetId, range, values) {
      calls.push({ type: 'append', range, values });
      rows.push([...values[0]]);
      const sheetRow = rows.length + 1;
      return { updates: { updatedRange: `'self_evaluation'!A${sheetRow}:H${sheetRow}` } };
    },
    async updateRange(_spreadsheetId, range, values) {
      calls.push({ type: 'update', range, values });
      const match = range.match(/^self_evaluation!A(\d+):H\1$/);
      if (match) rows[parseInt(match[1], 10) - 2] = [...values[0]];
    },
    async clearRange() {},
    async batchGet() { return []; },
    async getSpreadsheetMetadata() {
      return {
        namedRanges,
        sheets: [{ properties: { sheetId: 487558682, title: 'self_evaluation' } }],
      };
    },
    async batchUpdateSpreadsheet(_spreadsheetId, requests) {
      calls.push({ type: 'batchUpdate', requests });
    },
  };

  delete require.cache[dataStorePath];
  require.cache[sheetsClientPath] = {
    id: sheetsClientPath,
    filename: sheetsClientPath,
    loaded: true,
    exports: fakeClient,
  };
  process.env.DATA_SPREADSHEET_ID = 'test-spreadsheet';

  return {
    dataStore: require(dataStorePath),
    calls,
    rows,
  };
}

test('reads beyond row 5000 and returns the latest duplicate with its row number', async () => {
  const blankRows = Array.from({ length: 4999 }, () => []);
  const { dataStore } = loadDataStore([
    ...blankRows,
    ['2026-08-05', 'store_002', 'まめる', 'cast@example.com', '10', '推し1', '0', 'old'],
    ['2026-08-05', 'store_002', 'まめる', 'cast@example.com', '10', '推し2', '0', 'new'],
  ]);

  const evaluations = await dataStore.getSelfEvalByDateStore('2026-08-05', 'store_002');

  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0].comment, '推し2');
  assert.equal(evaluations[0].recordRow, 5002);
});

test('updates only the returned row on subsequent saves', async () => {
  const { dataStore, calls } = loadDataStore([
    ['2026-08-05', 'store_002', 'まめる', 'cast@example.com', '10', '推し2', '0', 'old'],
  ]);
  const [evaluation] = await dataStore.getSelfEvalByDateStore('2026-08-05', 'store_002');
  calls.length = 0;

  const saved = await dataStore.saveSelfEval(
    '2026-08-05',
    'store_002',
    'cast@example.com',
    'まめる',
    { score: 9, comment: '更新後', isEarlyLeave: false },
    evaluation.recordRow
  );

  assert.equal(saved.recordRow, 2);
  assert.deepEqual(calls.map(call => call.type), ['update']);
  assert.equal(calls[0].range, 'self_evaluation!A2:H2');
});

test('refreshes before a first append and returns the appended row number', async () => {
  const { dataStore, calls } = loadDataStore([]);

  const saved = await dataStore.saveSelfEval(
    '2026-08-06',
    'store_001',
    'new@example.com',
    '新人',
    { score: 5, comment: '初回', isEarlyLeave: false },
    null
  );

  assert.equal(saved.recordRow, 2);
  assert.deepEqual(calls.map(call => call.type), ['get', 'append']);
  assert.equal(calls[0].range, 'self_eval_202608');
});

test('creates the next monthly named range and closes the previous open range', async () => {
  const { dataStore, calls } = loadDataStore([
    ['2026-08-31', 'store_001', '前月', 'old@example.com', '5', '前月', '0', 'old'],
  ]);

  const saved = await dataStore.saveSelfEval(
    '2026-09-01',
    'store_001',
    'new@example.com',
    '新人',
    { score: 6, comment: '新しい月', isEarlyLeave: false },
    null
  );

  assert.equal(saved.recordRow, 3);
  const batchCall = calls.find(call => call.type === 'batchUpdate');
  assert.ok(batchCall);
  assert.equal(batchCall.requests[0].updateNamedRange.namedRange.range.endRowIndex, 2);
  assert.equal(batchCall.requests[1].addNamedRange.namedRange.name, 'self_eval_202609');
});
