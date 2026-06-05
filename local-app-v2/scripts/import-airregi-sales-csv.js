#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const { getRows, updateRange, clearRange } = require('../src/sheets/sheets-client');

const DATA_SPREADSHEET_ID = process.env.DATA_SPREADSHEET_ID;
const SHEET_NAME = 'airregi_sales_daily';
const HEADER = ['date', 'store_code', 'sales_total', 'monthly_sales', 'source', 'synced_at', 'source_updated_at'];
const DATE_ALIASES = ['date', '日付', '営業日', '集計期間', '来店日時', '会計日時', '伝票作成日時'];
const SALES_ALIASES = ['sales_total', 'sales', '売上', '売上合計', '総売上', '販売総売上', '税込売上'];

function printUsage() {
  console.log(`
Usage:
  npm run import:airregi-sales -- --file <csv> --store-code <store_001> [--date YYYY-MM-DD] [--dry-run]

Notes:
  - Airレジの「売上集計CSV」を想定します。
  - 日付列がない商品別/バリエーション別CSVは、--date を渡した場合のみ全行合計で取り込みます。
  - 月累計は、CSV内の同一月の日別売上を日付順に累計して作ります。
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'dry-run' || key === 'help') {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function decodeCsvFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('\uFFFD')) {
    text = new TextDecoder('shift_jis').decode(bytes);
  }
  return text.replace(/^\uFEFF/, '');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

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
  if (csvRows.length < 2) return [];

  const headers = csvRows[0];
  const dateCol = findColumn(headers, DATE_ALIASES);
  const salesCol = findColumn(headers, SALES_ALIASES);
  if (salesCol < 0) {
    throw new Error(`売上列が見つかりません。対応列名: ${SALES_ALIASES.join(', ')}`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (!DATA_SPREADSHEET_ID) throw new Error('DATA_SPREADSHEET_ID is not set.');
  if (!args.file || !args['store-code']) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const filePath = path.resolve(args.file);
  const storeCode = args['store-code'];
  const fixedDate = args.date ? parseDate(args.date) : '';
  if (args.date && !fixedDate) throw new Error(`Invalid --date: ${args.date}`);

  const csvRows = parseCsv(decodeCsvFile(filePath));
  const importedRows = buildDailyRows(csvRows, storeCode, fixedDate);
  if (importedRows.length === 0) {
    throw new Error('取り込み対象の行がありません。CSVの種類・日付列を確認してください。');
  }

  const months = new Map();
  importedRows.forEach(row => {
    const month = monthKey(row.date);
    const day = Number(row.date.slice(8, 10));
    months.set(month, Math.min(months.get(month) || day, day));
  });
  const partialMonths = [...months.entries()].filter(([, firstDay]) => firstDay !== 1);

  console.log(`store_code: ${storeCode}`);
  console.log(`rows: ${importedRows.length}`);
  console.log(`date_range: ${importedRows[0].date} ... ${importedRows[importedRows.length - 1].date}`);
  console.log(`latest_monthly_sales: ${importedRows[importedRows.length - 1].monthlySales}`);
  if (partialMonths.length > 0) {
    console.log(`warning: 月初から始まっていない月があります: ${partialMonths.map(([m]) => m).join(', ')}`);
  }

  if (args['dry-run']) return;

  const syncedAt = new Date().toISOString();
  const importedKeys = new Set(importedRows.map(row => `${row.date}\t${row.storeCode}`));
  const existingRows = await getRows(DATA_SPREADSHEET_ID, `${SHEET_NAME}!A2:G10000`);
  const keptRows = existingRows.filter(row => !importedKeys.has(`${row[0]}\t${row[1]}`));
  const nextRows = [
    HEADER,
    ...keptRows,
    ...toSheetRows(importedRows, `csv:${path.basename(filePath)}`, syncedAt),
  ].sort((a, b) => {
    if (a === HEADER) return -1;
    if (b === HEADER) return 1;
    return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]));
  });

  await updateRange(DATA_SPREADSHEET_ID, `${SHEET_NAME}!A1:G${nextRows.length}`, nextRows);
  if (existingRows.length + 1 > nextRows.length) {
    await clearRange(DATA_SPREADSHEET_ID, `${SHEET_NAME}!A${nextRows.length + 1}:G${existingRows.length + 1}`);
  }
  console.log(`updated: ${SHEET_NAME}!A1:G${nextRows.length}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
