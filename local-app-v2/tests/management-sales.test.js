const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const clientPath = require.resolve('../src/sheets/sheets-client');
const masterPath = require.resolve('../src/sheets/sales-master');
const dataStorePath = require.resolve('../src/sheets/data-store');
const { parseManagementMonth } = require(masterPath);

function monthValues(month = '11') {
  // Deliberately put Osaka first to verify mapping by name rather than column order.
  return [
    ['日付', '10sion超はなれ', '', '10sion本店'],
    ['', 'AirREGI売上', 'Rose使用数', 'AirREGI売上', 'Rose使用数'],
    [`${month}/1`, '100', '5', '200', '0'],
    [`${month}/2`, '0', '0', '10', '2'],
    [`${month}/3`, '', '0', '3', ''],
    [`${month}/4`, '20', '1', '40', '0'],
    ['今月合計', '99999', '99999', '99999', '99999'],
    ['営業管理売上', '99999', '', '99999'],
  ];
}

function loadWithClient(options = {}) {
  const calls = [];
  const months = options.months || ['2026-11'];
  const client = {
    async getRows(id, range) {
      calls.push({ type: 'getRows', id, range });
      if (options.targetsError) throw new Error(options.targetsError);
      return options.targets || [];
    },
    async getSpreadsheetMetadata(id) {
      calls.push({ type: 'metadata', id });
      if (id === 'test-operational-data') return { namedRanges: [], sheets: [] };
      if (options.failRead) throw new Error('permission denied');
      return { sheets: months.map(month => ({ properties: {
        title: `AirREGI・Rose売上_${month}`, gridProperties: { rowCount: 40, columnCount: 5 },
      } })) };
    },
    async batchGet(id, ranges) {
      calls.push({ type: 'batchGet', id, ranges });
      if (id === 'test-operational-data') return ranges.map(range => ({ values:
        range.startsWith('chorei!') ? [['2026-11-02', 'store_007', 'Sample', 'sample@example.test']]
          : range.startsWith('issues!') ? [['issue', '2026-11-02', 'store_007', 'Sample', 'test issue']]
            : range.startsWith('manager_feedback!') ? [['feedback', '2026-11-02', 'store_007', 'Sample', 'test feedback']]
              : [],
      }));
      return ranges.map(range => ({ values: monthValues(range.match(/2026-(\d{2})/)[1]) }));
    },
  };
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: client };
  delete require.cache[masterPath];
  delete require.cache[dataStorePath];
  process.env.DATA_SPREADSHEET_ID = 'test-operational-data';
  process.env.SALES_MASTER_SPREADSHEET_ID = 'test-sales-master';
  return { master: require(masterPath), dataStore: require(dataStorePath), calls };
}

test('maps both gal cafes by header, adds Rose once, and excludes total rows', () => {
  const rows = parseManagementMonth(monthValues(), '2026-11');
  assert.equal(rows.find(r => r.storeCode === 'store_008' && r.date === '2026-11-01').salesToday, 105);
  const shibuya = rows.find(r => r.storeCode === 'store_007' && r.date === '2026-11-02');
  assert.equal(shibuya.salesToday, 12);
  assert.equal(shibuya.monthlySales, 212);
  assert.equal(rows.length, 60);
  assert.ok(rows.every(row => row.source === 'management_sales_master'));
});

test('distinguishes an entered zero from blank/invalid cells and incomplete cumulative sales', () => {
  const rows = parseManagementMonth(monthValues(), '2026-11', 'store_008');
  assert.equal(rows[1].salesToday, 0);
  assert.equal(rows[1].monthlySales, 105);
  assert.equal(rows[2].salesToday, null);
  assert.equal(rows[2].monthlySales, null);
  assert.equal(rows[3].salesToday, 21);
  assert.equal(rows[3].monthlySales, null, 'must not claim a complete monthly total after a gap');
  const values = monthValues();
  values[2][1] = '#REF!';
  assert.equal(parseManagementMonth(values, '2026-11', 'store_008')[0].salesToday, null);
  values[2][1] = '-1,200';
  assert.equal(parseManagementMonth(values, '2026-11', 'store_008')[0].salesToday, -1195);
});

test('reads serial/full dates, ignores out-of-month dates, and handles leap years', () => {
  const values = monthValues('02').slice(0, 2);
  values.push([45323, '10', '2', '20', '0']); // 2024-02-01
  values.push(['2024/02/29', '5', '0', '5', '0']);
  values.push(['2024/03/01', '999', '0', '999', '0']);
  const rows = parseManagementMonth(values, '2024-02', 'store_008');
  assert.equal(rows.length, 29);
  assert.equal(rows[0].salesToday, 12);
  assert.equal(rows[28].salesToday, 5);
});

test('rejects ambiguous dates, unknown stores and broken metric columns', () => {
  const duplicate = monthValues();
  duplicate.push(['11/1', '1', '0', '1', '0']);
  assert.throws(() => parseManagementMonth(duplicate, '2026-11'), /日付.*重複/);
  const unknown = monthValues();
  unknown[0][1] = 'Unknown store';
  assert.throws(() => parseManagementMonth(unknown, '2026-11'), /未対応の店舗/);
  const broken = monthValues();
  broken[1][2] = '別の指標';
  assert.throws(() => parseManagementMonth(broken, '2026-11'), /Rose使用数列/);
});

test('fetches multiple monthly tabs and computes cumulative sales from month start before date filtering', async () => {
  const { master, calls } = loadWithClient({ months: ['2026-10', '2026-11'] });
  const result = await master.getManagementSales('2026-10-31', '2026-11-02', 'store_007');
  assert.deepEqual(result.sales.map(row => row.date), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(result.sales[2].monthlySales, 212);
  assert.ok(result.sales.every(row => row.storeCode === 'store_007'));
  assert.deepEqual(result.missingSalesMonths, []);
  assert.deepEqual(calls.find(call => call.type === 'batchGet').ranges,
    ["'AirREGI・Rose売上_2026-10'!A1:E40", "'AirREGI・Rose売上_2026-11'!A1:E40"]);
});

test('reports missing monthly tabs and propagates access errors without using old sales', async () => {
  const { master } = loadWithClient();
  const missing = await master.getManagementSales('2026-12-01', '2026-12-02', 'all');
  assert.deepEqual(missing.sales, []);
  assert.deepEqual(missing.missingSalesMonths, ['2026-12']);
  assert.deepEqual(missing.salesSource, 'management_sales_master');
  await assert.rejects(master.getManagementSales('2026-02-30', '2026-03-02', 'all'), /対象期間/);
  await assert.rejects(loadWithClient({ failRead: true }).master.getManagementSales('2026-11-01', '2026-11-02', 'all'), /permission denied/);
  delete process.env.SALES_MASTER_SPREADSHEET_ID;
  delete require.cache[masterPath];
  await assert.rejects(require(masterPath).getManagementSales('2026-11-01', '2026-11-02', 'all'), /未設定/);
});

test('dashboard uses the master exclusively and keeps attendance/issues/feedback indexes intact', async () => {
  const { dataStore, calls } = loadWithClient();
  const result = await dataStore.getDashboardSummary('2026-11-01', '2026-11-02', 'all', { includeManagerFeedback: true });
  assert.equal(result.sales.length, 4);
  assert.equal(result.salesSource, 'management_sales_master');
  assert.equal(result.attendance[0].castName, 'Sample');
  assert.equal(result.issues[0].content, 'test issue');
  assert.equal(result.managerFeedback[0].content, 'test feedback');
  assert.deepEqual(calls.find(call => call.type === 'batchGet' && call.id === 'test-operational-data').ranges,
    ['chorei!A2:L', 'issues!A2:I5000', 'manager_feedback!A2:I5000']);
});

function frontend(sales) {
  const source = fs.readFileSync(require.resolve('../public/scripts/app.js'), 'utf8');
  const State = {
    businessDate: '2026-11-03', dashStoreCode: 'all', dashDateTo: '2026-11-02',
    dashStores: ['store_007', 'store_008'].map(code => ({ code, name: code, brandCode: 'gal', brand: 'Sample', monthlyTarget: 1000 })),
    dashData: { sales, salesSource: 'management_sales_master', missingSalesMonths: [] },
  };
  const context = vm.createContext({ State, getDashRelativeDate: () => '2026-11-02', fmtYen: n => `¥${n.toLocaleString()}` });
  vm.runInContext(source.slice(source.indexOf('function sumDashSales('), source.indexOf('function getDashRelativeDate(')), context);
  vm.runInContext(source.slice(source.indexOf('function buildMonthlyProgressData('), source.indexOf('function renderMonthlyProgress(')), context);
  return context;
}

test('frontend sums all stores for monthly metrics and preserves real zero vs missing data', () => {
  const sales = parseManagementMonth(monthValues(), '2026-11').filter(row => row.date <= '2026-11-02');
  const context = frontend(sales);
  assert.equal(context.aggregateSalesTotal(context.State.dashData), 317);
  assert.equal(context.getLatestMonthlySales(context.State.dashData), 317);
  assert.equal(context.buildMonthlyProgressData().brands[0].monthlySales, 317);
  assert.equal(context.buildMonthlyProgressData().brands[0].yesterdaySales, 12);
  assert.equal(context.fmtDashSales(0), '¥0');
  assert.equal(context.fmtDashSales(null), '未入力');
  sales.find(row => row.date === '2026-11-02' && row.storeCode === 'store_008').salesToday = null;
  sales.find(row => row.date === '2026-11-02' && row.storeCode === 'store_008').monthlySales = null;
  assert.equal(context.aggregateSalesTotal(context.State.dashData), null);
  assert.equal(context.getLatestMonthlySales(context.State.dashData), null);
  assert.equal(context.buildSalesSeries(context.State.dashData, ['2026-11-02'])[0], null);
  assert.equal(context.buildMonthlyProgressData().brands[0].achievementRate, null);
  assert.equal(context.buildMonthlyProgressData().total.yesterdaySales, null);
});

test('monthly targets are private, filtered by month/store, and tolerate an absent optional tab', async () => {
  const targets = [
    ['2026-10', 'store_007', 800],
    ['2026-11', 'store_007', '¥1,200'],
    ['2026-11', 'store_008', 600],
    ['2026-12', 'store_007', 900],
  ];
  const { dataStore } = loadWithClient({ targets });
  const result = await dataStore.getDashboardSummary('2026-11-01', '2026-11-02', 'store_007');
  assert.deepEqual(result.salesTargets, { '2026-11': { store_007: 1200 } });
  const absent = loadWithClient({ targetsError: 'Unable to parse range: sales_targets!A2:C' });
  assert.deepEqual((await absent.dataStore.getDashboardSummary('2026-11-01', '2026-11-02', 'all')).salesTargets, {});
  const denied = loadWithClient({ targetsError: 'permission denied' });
  await assert.rejects(denied.dataStore.getDashboardSummary('2026-11-01', '2026-11-02', 'all'), /permission denied/);
});

test('monthly targets reject ambiguous or invalid amounts and preserve an explicit zero', () => {
  const { parseSalesTargets } = require('../src/sheets/sales-targets');
  const parse = rows => parseSalesTargets(rows, '2026-11-01', '2026-11-30', 'all');
  assert.deepEqual(parse([['2026-11', 'store_007', 0]]), { '2026-11': { store_007: 0 } });
  assert.throws(() => parse([['2026-11', 'store_007', 1], ['2026-11', 'store_007', 2]]), /重複/);
  for (const amount of ['', -1, '#REF!', 1.5]) {
    assert.throws(() => parse([['2026-11', 'store_007', amount]]), /金額/);
  }
});

test('monthly progress uses the selected month targets for stores, brands and totals only', () => {
  const context = frontend(parseManagementMonth(monthValues(), '2026-11').filter(row => row.date <= '2026-11-02'));
  context.State.dashData.salesTargets = {
    '2026-10': { store_007: 9000, store_008: 9000 },
    '2026-11': { store_007: 1200, store_008: 600 },
  };
  let progress = context.buildMonthlyProgressData();
  assert.equal(progress.brands[0].stores[0].monthlyTarget, 1200);
  assert.equal(progress.brands[0].monthlyTarget, 1800);
  assert.equal(progress.total.monthlyTarget, 1800);
  assert.equal(progress.total.achievementRate, 317 / 1800 * 100);
  delete context.State.dashData.salesTargets['2026-11'];
  assert.equal(context.buildMonthlyProgressData().total.monthlyTarget, 2000, 'other months must not override defaults');
  context.State.dashData.salesTargets['2026-11'] = { store_007: 0 };
  assert.equal(context.buildMonthlyProgressData().total.monthlyTarget, 1000, 'zero must not fall back to the default');
});
