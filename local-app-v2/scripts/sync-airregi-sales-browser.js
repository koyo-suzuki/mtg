#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright-core');
const configReader = require('../src/sheets/config-reader');
const dataStore = require('../src/sheets/data-store');
const {
  buildAirregiStoreTargets,
  getMissingStoreCodes,
  normalizeText,
} = require('../src/airregi/store-map');

const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_PROFILE_DIR = path.join(os.homedir(), '.airregi-dashboard-sync', 'chrome-profile');
const DEFAULT_DEBUG_DIR = path.join(os.tmpdir(), 'airregi-dashboard-sync');

function printUsage() {
  console.log(`
Usage:
  npm run sync:airregi-sales -- [--year YYYY] [--month M] [--stores store_001,store_002] [--dry-run]
  npm run sync:airregi-sales -- --login-only

Options:
  --year YYYY       対象年。省略時は今日のJST年
  --month M         対象月。省略時は今日のJST月
  --stores LIST     同期する店舗コードをカンマ区切りで指定。省略時は全店舗
  --dry-run         Airレジから取得するがスプシには書き込まない
  --login-only      同期せず、Airレジログイン用Chromeだけ開く
  --headless        Chromeを画面なしで起動
  --keep-open       終了時にChromeを閉じない
  --profile-dir DIR ログイン状態を保存するChromeプロファイル
  --debug-dir DIR   取得失敗時のスクショ/HTML保存先

First run:
  1. npm run sync:airregi-sales -- --login-only
  2. 開いたChromeでAirレジへログイン
  3. 以後 npm run sync:airregi-sales -- で同期
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (['help', 'dry-run', 'headless', 'keep-open', 'login-only'].includes(key)) {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function getJstNow() {
  return new Date(Date.now() + (9 * 60 * 60 * 1000));
}

function getTargetPeriod(args) {
  const now = getJstNow();
  const year = Number(args.year || now.getUTCFullYear());
  const month = Number(args.month || (now.getUTCMonth() + 1));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error(`Invalid --year: ${args.year}`);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error(`Invalid --month: ${args.month}`);
  return { year, month };
}

function parseStoreCodes(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function storeSelectUrl(year, month) {
  const transitionUrl = `https://airregi.jp/CLP//view/salesList/#/year/${year}/month/${month}`;
  return `https://airregi.jp/CLP//view/displayPlfSettingStoreSelect/?transitionUrl=${encodeURIComponent(transitionUrl)}`;
}

function salesListUrl(year, month) {
  return `https://airregi.jp/CLP//view/salesList/#/year/${year}/month/${month}`;
}

async function promptEnter(message) {
  if (!process.stdin.isTTY) throw new Error(message);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question(`${message}\nEnterで続行します: `, resolve));
  rl.close();
}

async function launchBrowser(args) {
  const executablePath = process.env.AIRREGI_CHROME_PATH || DEFAULT_CHROME_PATH;
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Chromeが見つかりません: ${executablePath}`);
  }

  const profileDir = path.resolve(args['profile-dir'] || process.env.AIRREGI_CHROME_PROFILE_DIR || DEFAULT_PROFILE_DIR);
  fs.mkdirSync(profileDir, { recursive: true });

  return chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: Boolean(args.headless),
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
}

async function getPage(context) {
  const pages = context.pages();
  return pages[0] || context.newPage();
}

async function looksLikeLoginPage(page) {
  const url = page.url();
  if (/\/view\/login\/choose-store/.test(url)) return false;
  if (/login|airid|auth/i.test(url) && !/displayPlfSettingStoreSelect|salesList/.test(url)) return true;
  return page.evaluate(() => {
    const body = document.body?.innerText || '';
    return /AirID|ログイン|パスワード/.test(body) && !/売上|店舗選択|店舗/.test(body);
  }).catch(() => false);
}

async function ensureAirregiSession(page, year, month) {
  await page.goto(storeSelectUrl(year, month), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  if (await looksLikeLoginPage(page)) {
    console.log('Airレジログイン待ちです。Chromeでログインしてください。ログイン後は自動で続行します。');
    await waitForLoggedIn(page, year, month);
  }
}

async function waitForLoggedIn(page, year, month) {
  const deadline = Date.now() + (5 * 60 * 1000);
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (!(await looksLikeLoginPage(page))) {
      return;
    }
  }
  await page.goto(storeSelectUrl(year, month), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (await looksLikeLoginPage(page)) {
    throw new Error('Airレジログイン待ちがタイムアウトしました。');
  }
}

async function collectVisibleStoreTexts(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('a,button,label,li,div,span')];
    return nodes
      .map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(text => text.length >= 2 && text.length <= 80)
      .filter((text, index, arr) => arr.indexOf(text) === index)
      .slice(0, 80);
  });
}

async function clickStoreByCandidates(page, target) {
  const candidates = target.airregiNameCandidates;
  const marker = `airregi-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await page.evaluate(({ candidates, marker }) => {
    const normalize = value => String(value || '').replace(/\s+/g, '').toLowerCase();
    const candidateKeys = candidates.map(normalize);
    const nodes = [...document.querySelectorAll('a,button,label,li,div,span')];
    const choices = [];

    document.querySelectorAll('[data-airregi-sync-target]').forEach(node => {
      node.removeAttribute('data-airregi-sync-target');
    });

    nodes.forEach(node => {
      const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const textKey = normalize(text);
      const matchedIndex = candidateKeys.findIndex(key => textKey === key || textKey.includes(key));
      if (matchedIndex < 0) return;
      const clickable = node.closest('a,button,label,[role="button"],li,div') || node;
      const rect = clickable.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const tagPenalty = ['A', 'BUTTON', 'LABEL'].includes(clickable.tagName) ? 0 : 100;
      choices.push({
        node: clickable,
        text,
        matched: candidates[matchedIndex],
        score: tagPenalty + (textKey === candidateKeys[matchedIndex] ? 0 : 10) + text.length,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    });

    choices.sort((a, b) => a.score - b.score);
    const choice = choices[0];
    if (!choice) return null;
    choice.node.setAttribute('data-airregi-sync-target', marker);
    return {
      text: choice.text,
      matched: choice.matched,
      score: choice.score,
      x: choice.x,
      y: choice.y,
    };
  }, { candidates, marker });

  if (!result) {
    const visibleTexts = await collectVisibleStoreTexts(page);
    throw new Error(`${target.code} ${target.name} のAirレジ店舗が見つかりません。候補: ${candidates.join(' / ')}\n見えている文字: ${visibleTexts.join(' | ')}`);
  }

  const targetLocator = page.locator(`[data-airregi-sync-target="${marker}"]`);
  await targetLocator.click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await targetLocator.click({ timeout: 10000 }).catch(() => {});
  await page.waitForURL(/airregi\.jp\/CLP|salesList|callbackForPlfLogin/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return result;
}

function matchesAirregiStoreName(pageStoreName, target) {
  const pageKey = normalizeText(pageStoreName);
  if (!pageKey) return true;
  return target.airregiNameCandidates.some(candidate => {
    const candidateKey = normalizeText(candidate);
    return pageKey === candidateKey || pageKey.includes(candidateKey) || candidateKey.includes(pageKey);
  });
}

async function extractDailySales(page, target, year, month, debugDir) {
  await page.goto(salesListUrl(year, month), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(({ year, month }) => {
    const parseAmount = value => {
      const normalized = String(value || '').replace(/[¥￥,\s]/g, '');
      if (!/^-?\d+$/.test(normalized)) return null;
      const amount = Number(normalized);
      return Number.isFinite(amount) ? amount : null;
    };
    const formatDateLocal = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const parseDate = text => {
      const raw = String(text || '');
      let match = raw.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
      if (!match) match = raw.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
      if (match) return formatDateLocal(Number(match[1]), Number(match[2]), Number(match[3]));
      match = raw.match(/(\d{1,2})[/-](\d{1,2})/);
      if (match) return formatDateLocal(year, Number(match[1]), Number(match[2]));
      match = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (match) return formatDateLocal(year, Number(match[1]), Number(match[2]));
      match = raw.match(/(^|\D)(\d{1,2})\s*日/);
      if (match) return formatDateLocal(year, month, Number(match[2]));
      return '';
    };

    const storeName = document.querySelector('.header-store-name, [class*=storeName], [class*=store-name]')?.textContent?.trim() || '';
    const byDate = {};
    const rows = [...document.querySelectorAll('table tbody tr, table tr')];

    rows.forEach(row => {
      const cells = [...row.querySelectorAll('td,th')].map(cell => String(cell.textContent || '').replace(/\s+/g, ' ').trim());
      if (cells.length < 2) return;
      const date = parseDate(cells.slice(0, 3).join(' ') || row.textContent);
      if (!date) return;
      const amountCells = cells.slice(1)
        .filter(text => /[¥￥,]\d|\d[,]\d|\d{4,}/.test(text))
        .map(parseAmount)
        .filter(value => value !== null);
      const fallback = parseAmount(cells[1]);
      const salesTotal = amountCells.length ? amountCells[0] : fallback;
      if (salesTotal === null) return;
      byDate[date] = (byDate[date] || 0) + salesTotal;
    });

    const dailyRows = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, salesTotal]) => ({ date, salesTotal }));

    return {
      storeName,
      rows: dailyRows,
      title: document.title,
      url: location.href,
    };
  }, { year, month });

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const normalizedRows = result.rows
    .filter(row => row.date.startsWith(monthPrefix))
    .map(row => ({ date: row.date, salesTotal: Number(row.salesTotal || 0) }));

  if (normalizedRows.length === 0) {
    await writeDebugArtifacts(page, debugDir, target);
    throw new Error(`${target.code} ${target.name} の日別売上が取得できませんでした。debug: ${debugDir}`);
  }

  return {
    ...result,
    rows: normalizedRows,
  };
}

async function writeDebugArtifacts(page, debugDir, target) {
  fs.mkdirSync(debugDir, { recursive: true });
  const slug = `${target.code}-${Date.now()}`;
  await page.screenshot({ path: path.join(debugDir, `${slug}.png`), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(debugDir, `${slug}.html`), await page.content().catch(() => ''), 'utf8');
}

function rowsToCsvText(rows) {
  return [
    'date,sales_total',
    ...rows.map(row => `${row.date},${row.salesTotal}`),
  ].join('\n');
}

async function syncStore(page, target, year, month, args, debugDir) {
  let clickResult = null;
  let extracted = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(storeSelectUrl(year, month), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    if (await looksLikeLoginPage(page)) {
      await ensureAirregiSession(page, year, month);
    }

    clickResult = await clickStoreByCandidates(page, target);
    extracted = await extractDailySales(page, target, year, month, debugDir);
    if (matchesAirregiStoreName(extracted.storeName, target)) break;
    if (attempt === 2) {
      await writeDebugArtifacts(page, debugDir, target);
      throw new Error(`${target.code} ${target.name} の店舗切替に失敗しました。clicked=${clickResult.matched}, page=${extracted.storeName || 'unknown'}, debug=${debugDir}`);
    }
  }

  const result = await dataStore.importAirregiSalesCsv({
    csvText: rowsToCsvText(extracted.rows),
    storeCode: target.code,
    sourceName: `airregi-browser:${clickResult.matched}:${year}-${String(month).padStart(2, '0')}`,
    dryRun: Boolean(args['dry-run']),
  });

  return {
    target,
    matchedName: clickResult.matched,
    pageStoreName: extracted.storeName,
    ...result,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const { year, month } = getTargetPeriod(args);
  const debugDir = path.resolve(args['debug-dir'] || DEFAULT_DEBUG_DIR);
  const context = await launchBrowser(args);
  const page = await getPage(context);

  try {
    if (args['login-only']) {
      await page.goto('https://airregi.jp/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log(`Airレジログイン用Chromeを開きました: ${page.url()}`);
      console.log(`profile: ${path.resolve(args['profile-dir'] || process.env.AIRREGI_CHROME_PROFILE_DIR || DEFAULT_PROFILE_DIR)}`);
      await promptEnter('ログインできたらEnterを押してください。ログイン状態を保存して閉じます。');
      return;
    }

    await ensureAirregiSession(page, year, month);

    const requestedStoreCodes = parseStoreCodes(args.stores);
    const stores = await configReader.getStores();
    const missing = getMissingStoreCodes(stores, requestedStoreCodes);
    if (missing.length) throw new Error(`店舗コードが見つかりません: ${missing.join(', ')}`);

    const targets = buildAirregiStoreTargets(stores, requestedStoreCodes);
    if (!targets.length) throw new Error('同期対象店舗がありません。');

    console.log(`period: ${year}-${String(month).padStart(2, '0')}`);
    console.log(`stores: ${targets.map(store => `${store.code}:${store.name}`).join(', ')}`);
    if (args['dry-run']) console.log('dry-run: スプシには書き込みません');

    const summaries = [];
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      process.stdout.write(`[${i + 1}/${targets.length}] ${target.code} ${target.name} ... `);
      const result = await syncStore(page, target, year, month, args, debugDir);
      summaries.push(result);
      const pageStore = result.pageStoreName ? ` / page:${result.pageStoreName}` : '';
      console.log(`${result.rowCount}日 / ${result.dateFrom}..${result.dateTo} / ${result.latestMonthlySales.toLocaleString()}円 / clicked:${result.matchedName}${pageStore}`);
    }

    console.log('');
    console.log(args['dry-run'] ? '確認完了' : '同期完了');
    summaries.forEach(summary => {
      console.log(`${summary.target.code}\t${summary.target.name}\t${summary.rowCount}日\t${summary.latestMonthlySales}\t${summary.matchedName}\t${summary.pageStoreName || ''}`);
    });
  } finally {
    if (!args['keep-open']) {
      await context.close().catch(() => {});
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
