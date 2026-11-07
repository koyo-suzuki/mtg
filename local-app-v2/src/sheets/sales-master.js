const { getSpreadsheetMetadata, batchGet } = require('./sheets-client');

// ESPマネージャー【マスター】。Vercelのサービスアカウントに閲覧権限が必要。
const SALES_MASTER_SPREADSHEET_ID = process.env.SALES_MASTER_SPREADSHEET_ID;
const MONTH_PREFIX = 'AirREGI・Rose売上_';
const STORE_HEADERS = {
  '10sion本店': 'store_007',
  'Revelio本店': 'store_005',
  'Bisquedoll本店': 'store_001',
  Rozengarden: 'store_003',
  'Revelio新宿': 'store_006',
  'Bisq OSAKA': 'store_002',
  Galette: 'store_004',
  '10sion超はなれ': 'store_008',
  'Revelio大阪': 'store_009',
  'Bisq Bunny': 'store_010',
};
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
const STORE_CODES = new Map(Object.entries(STORE_HEADERS).map(([name, code]) => [normalize(name), code]));

function parseAmount(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).normalize('NFKC').replace(/[¥￥,\s]/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

function parseMasterDate(value, month) {
  let date = '';
  if (typeof value === 'number') {
    date = new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  } else {
    const text = String(value || '').trim();
    const full = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    const short = text.match(/^(\d{1,2})[/-](\d{1,2})$/);
    if (full) date = `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
    else if (short) date = `${month.slice(0, 4)}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
  }
  if (!date.startsWith(`${month}-`)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}

function parseManagementMonth(values, month, storeCode = 'all') {
  const headerIndex = values.findIndex(row => normalize(row[0]) === '日付');
  if (headerIndex < 0) throw new Error(`${MONTH_PREFIX}${month}: 日付見出しが見つかりません`);
  const headers = values[headerIndex];
  const metrics = values[headerIndex + 1] || [];
  const stores = [];
  for (let column = 1; column < metrics.length; column += 1) {
    if (normalize(metrics[column]) !== normalize('AirREGI売上')) continue;
    const code = STORE_CODES.get(normalize(headers[column]));
    if (!code) throw new Error(`${MONTH_PREFIX}${month}: 未対応の店舗名 ${headers[column] || '(空欄)'}`);
    if (normalize(metrics[column + 1]) !== normalize('Rose使用数')) {
      throw new Error(`${MONTH_PREFIX}${month}: ${headers[column]} のRose使用数列が見つかりません`);
    }
    if (stores.some(store => store.code === code)) throw new Error(`${MONTH_PREFIX}${month}: 店舗が重複しています`);
    stores.push({ code, column });
  }
  if (!stores.length) throw new Error(`${MONTH_PREFIX}${month}: 売上列が見つかりません`);
  if (storeCode !== 'all' && !stores.some(store => store.code === storeCode)) {
    throw new Error(`${MONTH_PREFIX}${month}: 店舗 ${storeCode} が見つかりません`);
  }

  const byDate = new Map();
  for (const row of values.slice(headerIndex + 2)) {
    const date = parseMasterDate(row[0], month);
    if (!date) continue; // 今月合計・営業管理売上などの集計行は加算しない。
    if (byDate.has(date)) throw new Error(`${MONTH_PREFIX}${month}: 日付 ${date} が重複しています`);
    byDate.set(date, row);
  }

  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const sales = [];
  for (const store of stores.filter(store => storeCode === 'all' || store.code === storeCode)) {
    let cumulative = 0;
    let complete = true;
    for (let day = 1; day <= days; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const row = byDate.get(date) || [];
      const airregiSales = parseAmount(row[store.column]);
      const roseUsed = parseAmount(row[store.column + 1]);
      const salesToday = airregiSales !== null && roseUsed !== null ? airregiSales + roseUsed : null;
      if (salesToday === null) complete = false;
      else cumulative += salesToday;
      sales.push({
        date, storeCode: store.code, salesToday,
        monthlySales: complete ? cumulative : null,
        airregiSales, roseUsed,
        source: 'management_sales_master',
      });
    }
  }
  return sales;
}

function getMonths(from, to) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw new Error('売上の対象期間を確認してください');
  const months = [];
  const current = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  while (current.toISOString().slice(0, 7) <= to.slice(0, 7)) {
    months.push(current.toISOString().slice(0, 7));
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return months;
}

function columnName(count) {
  let name = '';
  while (count > 0) {
    count -= 1;
    name = String.fromCharCode(65 + count % 26) + name;
    count = Math.floor(count / 26);
  }
  return name;
}

async function getManagementSales(from, to, storeCode) {
  if (!SALES_MASTER_SPREADSHEET_ID) throw new Error('売上マスターの参照先（SALES_MASTER_SPREADSHEET_ID）が未設定です');
  const months = getMonths(from, to);
  const metadata = await getSpreadsheetMetadata(SALES_MASTER_SPREADSHEET_ID);
  const sheets = new Map((metadata.sheets || []).map(sheet => [sheet.properties.title, sheet.properties]));
  const missingSalesMonths = months.filter(month => !sheets.has(`${MONTH_PREFIX}${month}`));
  const available = months.filter(month => !missingSalesMonths.includes(month));
  const ranges = available.map(month => {
    const sheet = sheets.get(`${MONTH_PREFIX}${month}`);
    return `'${sheet.title.replace(/'/g, "''")}'!A1:${columnName(sheet.gridProperties.columnCount)}${sheet.gridProperties.rowCount}`;
  });
  const results = ranges.length ? await batchGet(SALES_MASTER_SPREADSHEET_ID, ranges) : [];
  const sales = available.flatMap((month, index) => {
    if (!results[index]) throw new Error(`${MONTH_PREFIX}${month}: 売上データを取得できませんでした`);
    return parseManagementMonth(results[index].values || [], month, storeCode);
  }).filter(row => row.date >= from && row.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || a.storeCode.localeCompare(b.storeCode));
  return { sales, salesSource: 'management_sales_master', missingSalesMonths };
}

module.exports = { getManagementSales, parseManagementMonth };
