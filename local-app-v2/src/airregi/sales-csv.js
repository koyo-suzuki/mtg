const { TextDecoder } = require('util');

const AIRREGI_SALES_SHEET_NAME = 'airregi_sales_daily';
const AIRREGI_SALES_HEADER = ['date', 'store_code', 'sales_total', 'monthly_sales', 'source', 'synced_at', 'source_updated_at'];
const DATE_ALIASES = ['date', '日付', '営業日', '集計期間', '来店日時', '会計日時', '伝票作成日時'];
const SALES_ALIASES = ['sales_total', 'sales', '売上', '売上合計', '総売上', '販売総売上', '税込売上'];

function normalizeCsvText(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function decodeCsvBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('\uFFFD')) {
    text = new TextDecoder('shift_jis').decode(bytes);
  }
  return normalizeCsvText(text);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = normalizeCsvText(text);

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(v => String(v).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (row.some(v => String(v).trim() !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/\s/g, '').toLowerCase();
}

function findColumn(headers, aliases) {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const idx = normalized.indexOf(normalizeHeader(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseNumber(value) {
  if (value === null || value === undefined) return 0;
  const normalized = String(value).replace(/[¥￥,\s]/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function parseDate(value) {
  const raw = String(value || '').trim();
  let compact = raw.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (compact) {
    const [, y, m, d] = compact;
    return `${y}-${m}-${d}`;
  }
  let match = raw.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) match = raw.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!match) return '';
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function monthKey(date) {
  return date.slice(0, 7);
}

function buildDailyRows(csvRows, storeCode, fixedDate) {
  if (!storeCode) throw new Error('店舗を選択してください。');
  if (csvRows.length < 2) return [];

  const headers = csvRows[0];
  const dateCol = findColumn(headers, DATE_ALIASES);
  const salesCol = findColumn(headers, SALES_ALIASES);

  if (salesCol < 0) {
    throw new Error(`売上列が見つかりません。対応列名: ${SALES_ALIASES.join(', ')}`);
  }
  if (dateCol < 0 && !fixedDate) {
    throw new Error(`日付列が見つかりません。対応列名: ${DATE_ALIASES.join(', ')}`);
  }

  const byDate = {};
  for (const row of csvRows.slice(1)) {
    const date = dateCol >= 0 ? parseDate(row[dateCol]) : fixedDate;
    if (!date) continue;
    byDate[date] = (byDate[date] || 0) + parseNumber(row[salesCol]);
  }

  const cumulativeByMonth = {};
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, salesTotal]) => {
      const month = monthKey(date);
      cumulativeByMonth[month] = (cumulativeByMonth[month] || 0) + salesTotal;
      return {
        date,
        storeCode,
        salesTotal,
        monthlySales: cumulativeByMonth[month],
      };
    });
}

function getWarnings(rows) {
  const months = new Map();
  rows.forEach(row => {
    const month = monthKey(row.date);
    const day = Number(row.date.slice(8, 10));
    months.set(month, Math.min(months.get(month) || day, day));
  });

  return [...months.entries()]
    .filter(([, firstDay]) => firstDay !== 1)
    .map(([month]) => ({
      type: 'partial_month',
      message: `月初から始まっていない月があります: ${month}`,
      month,
    }));
}

function summarizeRows(rows) {
  const first = rows[0] || null;
  const last = rows[rows.length - 1] || null;
  return {
    storeCode: first ? first.storeCode : '',
    rowCount: rows.length,
    dateFrom: first ? first.date : '',
    dateTo: last ? last.date : '',
    latestMonthlySales: last ? last.monthlySales : 0,
  };
}

function parseAirregiSalesCsv(csvText, options = {}) {
  const storeCode = String(options.storeCode || '').trim();
  const fixedDate = options.fixedDate ? parseDate(options.fixedDate) : '';
  if (options.fixedDate && !fixedDate) throw new Error(`Invalid date: ${options.fixedDate}`);

  const csvRows = parseCsv(csvText);
  const rows = buildDailyRows(csvRows, storeCode, fixedDate);
  if (rows.length === 0) {
    throw new Error('取り込み対象の行がありません。CSVの種類・日付列を確認してください。');
  }

  const warnings = getWarnings(rows);
  return {
    ...summarizeRows(rows),
    warnings,
    rows,
  };
}

function toSheetRows(rows, source, syncedAt) {
  return rows.map(row => [
    row.date,
    row.storeCode,
    String(row.salesTotal),
    String(row.monthlySales),
    source,
    syncedAt,
    '',
  ]);
}

function formatImportSummary(result) {
  const lines = [
    `store_code: ${result.storeCode}`,
    `rows: ${result.rowCount}`,
    `date_range: ${result.dateFrom} ... ${result.dateTo}`,
    `latest_monthly_sales: ${result.latestMonthlySales}`,
  ];
  (result.warnings || []).forEach(warning => lines.push(`warning: ${warning.message}`));
  return lines;
}

module.exports = {
  AIRREGI_SALES_SHEET_NAME,
  AIRREGI_SALES_HEADER,
  decodeCsvBuffer,
  parseCsv,
  parseDate,
  parseAirregiSalesCsv,
  toSheetRows,
  formatImportSummary,
};
