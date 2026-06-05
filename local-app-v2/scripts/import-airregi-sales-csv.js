#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const dataStore = require('../src/sheets/data-store');
const { decodeCsvBuffer, formatImportSummary } = require('../src/airregi/sales-csv');

const DATA_SPREADSHEET_ID = process.env.DATA_SPREADSHEET_ID;

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
  const csvText = decodeCsvBuffer(fs.readFileSync(filePath));
  const result = await dataStore.importAirregiSalesCsv({
    csvText,
    storeCode,
    fixedDate: args.date || '',
    sourceName: `csv:${path.basename(filePath)}`,
    dryRun: Boolean(args['dry-run']),
  });

  formatImportSummary(result).forEach(line => console.log(line));
  if (result.updatedRange) console.log(`updated: ${result.updatedRange}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
