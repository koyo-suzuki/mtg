#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const dataStore = require('../src/sheets/data-store');

function printUsage() {
  console.log(`
Usage:
  npm run import:airregi-sales-json -- --file <path-or-dir> [--dry-run]

Options:
  --file PATH   sync:airregi-sales --output-json のJSONファイル、またはJSONを置いたディレクトリ
  --dry-run     スプシには書き込まず、取り込み対象だけ確認
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (['help', 'dry-run'].includes(key)) {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function listJsonFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return fs.readdirSync(resolved)
      .filter(name => name.endsWith('.json'))
      .sort()
      .map(name => path.join(resolved, name));
  }
  return [resolved];
}

function readRows(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = Array.isArray(data) ? data : data.rows;
  if (!Array.isArray(rows)) {
    throw new Error(`rows が見つかりません: ${filePath}`);
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.file) throw new Error('--file を指定してください。');

  const files = listJsonFiles(args.file);
  const rows = files.flatMap(readRows);
  const result = await dataStore.importAirregiSalesRows(rows, {
    sourceName: 'airregi-json',
    dryRun: Boolean(args['dry-run']),
  });

  console.log(args['dry-run'] ? '確認完了' : '取り込み完了');
  console.log(`files: ${files.length}`);
  console.log(`rows: ${result.rowCount}`);
  console.log(`stores: ${result.storeCount}`);
  console.log(`date_range: ${result.dateFrom || '-'} ... ${result.dateTo || '-'}`);
  if (result.updatedRange) console.log(`updated: ${result.updatedRange}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
