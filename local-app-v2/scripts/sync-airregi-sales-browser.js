#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright-core');
const configReader = require('../src/sheets/config-reader');
const dataStore = require('../src/sheets/data-store');
const { parseAirregiSalesCsv } = require('../src/airregi/sales-csv');
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
  npm run sync:airregi-sales -- --this-year [--stores store_001] [--output-json PATH]
  npm run sync:airregi-sales -- --from YYYY-MM --to YYYY-MM [--stores store_001] [--output-json PATH]
  npm run sync:airregi-sales -- --login-only

Options:
  --year YYYY       対象年。省略時は今日のJST年
  --month M         対象月。省略時は今日のJST月
  --this-year       JSTの今年1月から今月までを同期
  --from YYYY-MM    履歴同期の開始月
  --to YYYY-MM      履歴同期の終了月。省略時は今日のJST月
  --stores LIST     同期する店舗コードをカンマ区切りで指定。省略時は全店舗
  --dry-run         Airレジから取得するがスプシには書き込まない
  --collect-only    Airレジから取得してJSON出力だけ行い、スプシには書き込まない
  --output-json PATH 取得結果をJSONで保存。店舗別並列取得後の一括取り込みに使う
  --import-json PATH 取得済みJSONのrowsをスプシに取り込む
  --assume-current-store 現在選択中のAirレジ店舗を対象店舗として扱い、店舗選択を省略
  --skip-empty      売上行がない月をエラーにせずスキップ
  --list-airregi-stores Airレジ店舗選択画面の候補をJSON/標準出力へ出す
  --login-only      同期せず、Airレジログイン用Chromeだけ開く
  --headless        Chromeを画面なしで起動
  --headed          Chromeを画面ありで起動
  --no-auto-login   .envの認証情報による自動ログインを使わない
  --no-block-assets 画像/フォント/動画の読み込み抑制を使わない
  --keep-open       終了時にChromeを閉じない
  --profile-dir DIR ログイン状態を保存するChromeプロファイル
  --debug-dir DIR   取得失敗時のスクショ/HTML保存先

First run:
  1. npm run sync:airregi-sales -- --login-only
  2. 開いたChromeでAirレジへログイン
  3. 以後 npm run sync:airregi-sales -- で同期

Auto login env:
  AIRREGI_LOGIN_ID   AirID/メールアドレス。Chromeプロファイルに保存済みなら省略可
  AIRREGI_PASSWORD   AirIDパスワード
  AIRREGI_HEADLESS   1/trueなら通常同期をヘッドレス起動
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (['help', 'dry-run', 'headless', 'headed', 'no-auto-login', 'no-block-assets', 'keep-open', 'login-only', 'collect-only', 'skip-empty', 'list-airregi-stores', 'assume-current-store', 'this-year'].includes(key)) {
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

function parseYearMonth(value, label) {
  const match = String(value || '').trim().match(/^(20\d{2})-(\d{1,2})$/);
  if (!match) throw new Error(`Invalid ${label}: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error(`Invalid ${label}: ${value}`);
  return { year, month };
}

function formatYearMonth(period) {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

function comparePeriods(a, b) {
  return (a.year - b.year) || (a.month - b.month);
}

function addMonth(period) {
  if (period.month === 12) return { year: period.year + 1, month: 1 };
  return { year: period.year, month: period.month + 1 };
}

function getTargetPeriods(args) {
  if (args['this-year']) {
    const to = getTargetPeriod({});
    const from = { year: to.year, month: 1 };
    const periods = [];
    for (let p = from; comparePeriods(p, to) <= 0; p = addMonth(p)) {
      periods.push(p);
    }
    return periods;
  }
  if (args.from || args.to) {
    const from = parseYearMonth(args.from, '--from');
    const to = args.to ? parseYearMonth(args.to, '--to') : getTargetPeriod(args);
    if (comparePeriods(from, to) > 0) throw new Error('--from は --to 以前にしてください。');
    const periods = [];
    for (let p = from; comparePeriods(p, to) <= 0; p = addMonth(p)) {
      periods.push(p);
    }
    return periods;
  }
  return [getTargetPeriod(args)];
}

function parseStoreCodes(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function routeMonth(month) {
  return String(month).padStart(2, '0');
}

function storeSelectUrl(year, month) {
  const transitionUrl = `https://airregi.jp/CLP//view/salesList/#/year/${year}/month/${routeMonth(month)}`;
  return `https://airregi.jp/CLP//view/displayPlfSettingStoreSelect/?transitionUrl=${encodeURIComponent(transitionUrl)}`;
}

function salesListUrl(year, month) {
  return `https://airregi.jp/CLP//view/salesList/#/year/${year}/month/${routeMonth(month)}`;
}

function isSalesListPeriodUrl(url, year, month) {
  return /\/view\/salesList\//.test(String(url || ''))
    && String(url || '').includes(`/year/${year}/month/${routeMonth(month)}`);
}

function truthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function getAirregiLoginId() {
  return process.env.AIRREGI_LOGIN_ID
    || process.env.AIRREGI_USER
    || process.env.AIRREGI_EMAIL
    || process.env.AIRID_LOGIN_ID
    || process.env.AIRID_EMAIL
    || '';
}

function getAirregiPassword() {
  return process.env.AIRREGI_PASSWORD
    || process.env.AIRID_PASSWORD
    || '';
}

function shouldRunHeadless(args) {
  if (args.headed || args['login-only']) return false;
  if (args.headless) return true;
  if (process.env.AIRREGI_HEADLESS !== undefined) return truthyEnv(process.env.AIRREGI_HEADLESS);
  return Boolean(getAirregiPassword());
}

function shouldBlockAssets(args) {
  if (args['no-block-assets']) return false;
  if (process.env.AIRREGI_BLOCK_ASSETS !== undefined) return truthyEnv(process.env.AIRREGI_BLOCK_ASSETS);
  return true;
}

async function gotoAirregi(page, url, options = {}) {
  const waitUntil = options.waitUntil || 'commit';
  const timeout = options.timeout || 30000;
  const attempts = options.attempts || 3;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil, timeout });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(3000);

      const currentUrl = page.url();
      if (/airregi\.jp\/CLP/.test(currentUrl)) {
        return;
      }

      if (attempt < attempts) {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
  }

  throw lastError;
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

  const headless = shouldRunHeadless(args);
  args._headless = headless;

  return chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
}

async function configureBrowserContext(context, args) {
  if (!shouldBlockAssets(args)) return;
  await context.route('**/*', route => {
    const resourceType = route.request().resourceType();
    if (['image', 'font', 'media'].includes(resourceType)) {
      return route.abort().catch(() => {});
    }
    return route.continue().catch(() => {});
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

async function waitForStorePageReady(page, target, timeout = 8000) {
  await page.waitForFunction(({ candidates }) => {
    const body = document.body?.innerText || '';
    if (/AirID|ログイン|パスワード/.test(body)) return true;

    const normalize = value => String(value || '').replace(/\s+/g, '').toLowerCase();
    const candidateKeys = candidates.map(normalize);
    return [...document.querySelectorAll('a,button,label,li,div,span')].some(node => {
      const textKey = normalize(node.textContent || '');
      return candidateKeys.includes(textKey);
    });
  }, { candidates: target.airregiNameCandidates }, { timeout, polling: 250 }).catch(() => {});
}

async function waitForDailySalesRows(page, year, month, timeout = 12000) {
  await page.waitForFunction(({ year, month, monthPrefix }) => {
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
    const parseAmount = value => {
      const normalized = String(value || '').replace(/[¥￥,\s]/g, '');
      return /^-?\d+$/.test(normalized) ? Number(normalized) : null;
    };
    const rows = [...document.querySelectorAll('table tbody tr, table tr')];
    return rows.some(row => {
      const cells = [...row.querySelectorAll('td,th')].map(cell => String(cell.textContent || '').replace(/\s+/g, ' ').trim());
      if (cells.length < 2) return false;
      const date = parseDate(cells.slice(0, 3).join(' ') || row.textContent);
      if (!date.startsWith(monthPrefix)) return false;
      return cells.slice(1).some(text => /[¥￥,]\d|\d[,]\d|\d{4,}/.test(text) && parseAmount(text) !== null);
    });
  }, { year, month, monthPrefix: `${year}-${String(month).padStart(2, '0')}-` }, { timeout, polling: 250 }).catch(() => {});
}

async function clickDisplayButtonIfPresent(page) {
  return page.evaluate(() => {
    const visible = node => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
        && !node.disabled;
    };
    const nodes = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],a,[role="button"]')]
      .filter(visible)
      .map(node => ({
        node,
        text: String(node.innerText || node.value || node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter(choice => /^(表示する|表示|検索)$/.test(choice.text));
    const choice = nodes[0];
    if (!choice) return false;
    choice.node.click();
    return true;
  }).catch(() => false);
}

async function getLoginFormState(page) {
  return page.evaluate(() => {
    const visible = node => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
        && !node.disabled
        && node.type !== 'hidden';
    };
    const inputs = [...document.querySelectorAll('input')].filter(visible);
    const passwordInputs = inputs.filter(input => String(input.type || '').toLowerCase() === 'password');
    const loginInputs = inputs.filter(input => {
      const type = String(input.type || '').toLowerCase();
      if (type === 'password' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button') return false;
      const key = [
        input.name,
        input.id,
        input.placeholder,
        input.autocomplete,
        input.getAttribute('aria-label'),
      ].join(' ').toLowerCase();
      return type === 'email'
        || /mail|email|login|account|airid|user|id|アカウント|メール|ログイン|airid/i.test(key);
    });
    const submitNodes = [...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')].filter(visible);
    return {
      loginInputs: loginInputs.length,
      passwordInputs: passwordInputs.length,
      submitNodes: submitNodes.length,
      hasPrefilledLogin: loginInputs.some(input => String(input.value || '').trim()),
      hasPrefilledPassword: passwordInputs.some(input => String(input.value || '').trim()),
      url: location.href,
    };
  }).catch(() => ({
    loginInputs: 0,
    passwordInputs: 0,
    submitNodes: 0,
    hasPrefilledLogin: false,
    hasPrefilledPassword: false,
    url: page.url(),
  }));
}

async function fillLoginInput(page, value) {
  if (!value) return false;
  return page.evaluate(loginId => {
    const visible = node => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
        && !node.disabled
        && node.type !== 'hidden';
    };
    const setValue = (input, nextValue) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, nextValue);
      else input.value = nextValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const candidates = [...document.querySelectorAll('input')]
      .filter(visible)
      .filter(input => {
        const type = String(input.type || '').toLowerCase();
        return !['password', 'checkbox', 'radio', 'submit', 'button'].includes(type);
      })
      .map(input => {
        const type = String(input.type || '').toLowerCase();
        const key = [
          input.name,
          input.id,
          input.placeholder,
          input.autocomplete,
          input.getAttribute('aria-label'),
        ].join(' ').toLowerCase();
        let score = type === 'email' ? 0 : 20;
        if (/airid/.test(key)) score -= 10;
        if (/mail|email|メール/.test(key)) score -= 8;
        if (/login|ログイン/.test(key)) score -= 6;
        if (/account|アカウント|user|id/.test(key)) score -= 4;
        return { input, score };
      })
      .sort((a, b) => a.score - b.score);
    const choice = candidates[0]?.input;
    if (!choice) return false;
    choice.focus();
    setValue(choice, loginId);
    return true;
  }, value).catch(() => false);
}

async function fillPasswordInput(page, value) {
  if (!value) return false;
  return page.evaluate(password => {
    const visible = node => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
        && !node.disabled
        && node.type !== 'hidden';
    };
    const setValue = (input, nextValue) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, nextValue);
      else input.value = nextValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const input = [...document.querySelectorAll('input[type="password"]')].find(visible);
    if (!input) return false;
    input.focus();
    setValue(input, password);
    return true;
  }, value).catch(() => false);
}

async function clickLoginSubmit(page) {
  const clicked = await page.evaluate(() => {
    const visible = node => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
        && !node.disabled;
    };
    const nodes = [...document.querySelectorAll('button,input[type="submit"],a,[role="button"]')]
      .filter(visible)
      .map(node => {
        const text = String(node.innerText || node.value || node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const isSubmit = node.matches('input[type="submit"],button[type="submit"]');
        let score = isSubmit ? 20 : 80;
        if (/できない|忘れた|新規登録|help|forgot/i.test(text)) score += 100;
        if (/^(ログイン|login)$/i.test(text)) score = isSubmit ? 0 : 10;
        else if (/次へ|続ける|continue|next/i.test(text)) score = isSubmit ? 5 : 20;
        return { node, text, score };
      })
      .sort((a, b) => a.score - b.score);
    const choice = nodes[0];
    if (!choice) return false;
    choice.node.click();
    return true;
  }).catch(() => false);
  if (!clicked) {
    await page.keyboard.press('Enter').catch(() => {});
  }
  return clicked;
}

async function tryAutoLogin(page, args) {
  if (args['no-auto-login']) return false;
  const loginId = getAirregiLoginId();
  const password = getAirregiPassword();
  if (!loginId && !password) return false;

  for (let step = 0; step < 3; step += 1) {
    if (!(await looksLikeLoginPage(page))) return true;
    const state = await getLoginFormState(page);
    const filledLogin = loginId ? await fillLoginInput(page, loginId) : state.hasPrefilledLogin;
    const filledPassword = password ? await fillPasswordInput(page, password) : state.hasPrefilledPassword;

    if (!filledLogin && !filledPassword && !state.submitNodes) {
      return false;
    }

    await clickLoginSubmit(page);
    await Promise.race([
      page.waitForLoadState('domcontentloaded', { timeout: 10000 }),
      page.waitForFunction(() => !/login|airid|auth/i.test(location.href), {}, { timeout: 10000 }),
    ]).catch(() => {});
    await page.waitForTimeout(500);
  }

  return !(await looksLikeLoginPage(page));
}

async function ensureAirregiSession(page, year, month) {
  await gotoAirregi(page, salesListUrl(year, month));
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  if (await looksLikeLoginPage(page)) {
    if (await tryAutoLogin(page, page.context()._airregiArgs || {})) {
      await gotoAirregi(page, salesListUrl(year, month)).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      if (!(await looksLikeLoginPage(page))) return;
    }
    if (page.context()._airregiArgs?._headless) {
      throw new Error('Airレジ自動ログインに失敗しました。AIRREGI_LOGIN_ID/AIRREGI_PASSWORD またはChromeプロファイルのログイン状態を確認してください。');
    }
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
  await gotoAirregi(page, storeSelectUrl(year, month)).catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
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

async function getCurrentAirregiStoreName(page) {
  return page.evaluate(() => {
    const text = String(document.querySelector('.usingStore')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.replace(/^利用中の店舗\s*[:：]\s*/, '').trim();
  }).catch(() => '');
}

async function collectAirregiStoreChoices(page) {
  return page.evaluate(() => {
    const normalizeWhitespace = value => String(value || '').replace(/\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll('a,button,label,li,div,[role="button"]')];
    const choices = nodes
      .map((node, index) => {
        const rect = node.getBoundingClientRect();
        const text = normalizeWhitespace(node.textContent);
        const dataset = {};
        Object.keys(node.dataset || {}).forEach(key => {
          dataset[key] = node.dataset[key];
        });
        return {
          index,
          tag: node.tagName,
          text,
          href: node.getAttribute('href') || '',
          role: node.getAttribute('role') || '',
          id: node.id || '',
          className: normalizeWhitespace(node.className),
          dataset,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter(choice => choice.text.length >= 2 && choice.text.length <= 120)
      .filter(choice => choice.width > 0 && choice.height > 0);
    return {
      choices,
      mainBoxHtml: document.querySelector('.mainBox')?.outerHTML || '',
    };
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
      const matchedIndex = candidateKeys.findIndex(key => textKey === key);
      if (matchedIndex < 0) return;
      const clickable = node.closest('a,button,label,[role="button"],li,div') || node;
      const rect = clickable.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const tagPenalty = ['A', 'BUTTON', 'LABEL'].includes(clickable.tagName) ? 0 : 100;
      choices.push({
        node: clickable,
        text,
        matched: candidates[matchedIndex],
        href: clickable.href || clickable.getAttribute('href') || '',
        storeNo: clickable.getAttribute('data-storeno') || node.getAttribute('data-storeno') || '',
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
      href: choice.href,
      storeNo: choice.storeNo,
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
  const previousUrl = page.url();
  const requestSwitchStatus = await switchStoreByRequest(page, result).catch(() => null);
  const requestSwitchOk = requestSwitchStatus >= 200 && requestSwitchStatus < 400;
  if (!requestSwitchOk && result.storeNo) {
    await page.evaluate(marker => {
      const link = document.querySelector(`[data-airregi-sync-target="${marker}"]`);
      const form = document.getElementById('chooseStoreForm');
      if (!link || !form) return false;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'storeNo';
      input.value = link.getAttribute('data-storeno') || '';
      form.setAttribute('action', link.href);
      form.setAttribute('method', 'post');
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      return true;
    }, marker);
  } else {
    await targetLocator.click({ timeout: 10000, noWaitAfter: true }).catch(() => {});
  }
  await page.waitForFunction(url => location.href !== url, previousUrl, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => (
    /airregi\.jp\/CLP/.test(location.href)
    && !/displayPlfSettingStoreSelect/.test(location.href)
  ), {}, { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (/displayPlfSettingStoreSelect/.test(page.url())) {
    await targetLocator.click({ timeout: 1500, noWaitAfter: true }).catch(() => {});
    await page.waitForFunction(url => location.href !== url, previousUrl, { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => (
      /airregi\.jp\/CLP/.test(location.href)
      && !/displayPlfSettingStoreSelect/.test(location.href)
    ), {}, { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return result;
}

async function switchStoreByRequest(page, choice) {
  if (!choice?.href || !choice?.storeNo) return null;
  const csrf = await page.evaluate(() => (
    document.querySelector('#chooseStoreForm input[name="_csrf"]')?.value || ''
  )).catch(() => '');
  const form = { storeNo: choice.storeNo };
  if (csrf) form._csrf = csrf;
  const response = await page.context().request.post(choice.href, {
    form,
    timeout: 30000,
  });
  await response.text().catch(() => '');
  return response.status();
}

async function refreshCurrentStoreSession(page) {
  const backHref = await page.evaluate(() => (
    document.querySelector('.btnBack')?.href || ''
  )).catch(() => '');
  if (!backHref) return false;
  const response = await page.context().request.get(backHref, { timeout: 30000 });
  await response.text().catch(() => '');
  return true;
}

function matchesAirregiStoreName(pageStoreName, target) {
  const pageKey = normalizeText(pageStoreName);
  if (!pageKey) return false;
  return target.airregiNameCandidates.some(candidate => {
    const candidateKey = normalizeText(candidate);
    return pageKey === candidateKey;
  });
}

function parseApiAmount(value) {
  const normalized = String(value ?? '').replace(/[¥￥,\s]/g, '');
  if (!/^-?\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseApiStatsDate(value, year, month) {
  const raw = String(value || '').trim();
  let match = raw.match(/^(20\d{2})(\d{2})(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = raw.match(/^(\d{1,2})$/);
  if (match) return `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return '';
}

function parseApiResponseText(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const bodyText = String(text || '').replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    return JSON.parse(bodyText);
  }
}

async function fetchDailySalesFromApi(page, year, month) {
  const appState = await page.evaluate(() => ({
    storeName: String(
      document.querySelector('.header-store-name, [class*=storeName], [class*=store-name]')?.textContent
      || window.APP?.accountName
      || ''
    ).replace(/\s+/g, ' ').trim(),
    basepath: window.APP?.basepath || '',
    corClpKeyCd: window.APP?.corClpKeyCd || '',
    nativeAplicationVersion: window.APP?.nativeAplicationVersion || '',
  })).catch(() => ({}));

  const basepath = String(appState.basepath || 'https://airregi.jp/CLP/');
  const baseUrl = basepath.startsWith('http')
    ? basepath
    : new URL(basepath, 'https://airregi.jp').href;
  const apiUrl = `${baseUrl.replace(/\/+$/, '')}/api/searchUriageIndex/execute/`;
  const headers = {};
  if (appState.corClpKeyCd) headers.corClpKeyCd = appState.corClpKeyCd;
  if (appState.nativeAplicationVersion) {
    headers['Native-Application-Version'] = appState.nativeAplicationVersion;
  }
  const response = await page.context().request.post(apiUrl, {
    headers,
    form: {
      paramStr: JSON.stringify({
        termType: 'D',
        targetDateYear: String(year),
        targetDateMonth: String(month).padStart(2, '0'),
        targetDateDay: '01',
      }),
    },
    timeout: 20000,
  });
  const data = parseApiResponseText(await response.text());

  const results = data?.results || {};
  const apiData = results.resultsDataForRead
    || results.resultsDataForSearchByBarcode
    || results.resultsDataForUpdate
    || results.resultsData
    || {};
  const statsSalesList = Array.isArray(apiData.statsSalesList) ? apiData.statsSalesList : [];
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
  const rows = statsSalesList
    .map(item => ({
      date: parseApiStatsDate(item.statsDate, year, month),
      salesTotal: parseApiAmount(item.sales),
    }))
    .filter(row => row.date.startsWith(monthPrefix) && row.salesTotal !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    storeName: appState.storeName || '',
    rows,
    status: response.status(),
    returnCode: results.returnCode || '',
  };
}

async function extractDailySales(page, target, year, month, debugDir, options = {}) {
  const targetUrl = salesListUrl(year, month);
  if (!isSalesListPeriodUrl(page.url(), year, month)) {
    await gotoAirregi(page, targetUrl);
  }
  await Promise.race([
    waitForDailySalesRows(page, year, month, 2500),
    page.waitForLoadState('domcontentloaded', { timeout: 2500 }),
  ]).catch(() => {});

  const apiResult = await fetchDailySalesFromApi(page, year, month).catch(() => null);
  if (apiResult?.rows?.length) {
    return {
      storeName: apiResult.storeName,
      rows: apiResult.rows,
      title: await page.title().catch(() => ''),
      url: page.url(),
      apiStatus: apiResult.status,
      apiReturnCode: apiResult.returnCode,
    };
  }

  await clickDisplayButtonIfPresent(page);
  await waitForDailySalesRows(page, year, month, options.allowEmpty ? 7000 : 15000);

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

    const storeName = String(
      document.querySelector('.header-store-name, [class*=storeName], [class*=store-name]')?.textContent
      || window.APP?.accountName
      || ''
    ).replace(/\s+/g, ' ').trim();
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
    const retryCount = Number(options._retry || 0);
    if (retryCount < 2) {
      await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return extractDailySales(page, target, year, month, debugDir, {
        ...options,
        _retry: retryCount + 1,
      });
    }
    if (options.allowEmpty) {
      return {
        ...result,
        rows: [],
      };
    }
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

function parseExtractedRows(extractedRows, target, sourceName) {
  if (!extractedRows.length) return null;
  const parsed = parseAirregiSalesCsv(rowsToCsvText(extractedRows), {
    storeCode: target.code,
  });
  return {
    ...parsed,
    rows: parsed.rows.map(row => ({
      ...row,
      source: sourceName,
    })),
  };
}

async function selectStore(page, target, period, args, debugDir) {
  const { year, month } = period;
  let clickResult = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let storeSelectError = null;
    try {
      await gotoAirregi(page, storeSelectUrl(year, month));
      await waitForStorePageReady(page, target);
    } catch (error) {
      storeSelectError = error;
    }
    if (storeSelectError) {
      const extracted = await extractDailySales(page, target, year, month, debugDir, { allowEmpty: true });
      if (matchesAirregiStoreName(extracted.storeName, target)) {
        return {
          clickResult: { matched: extracted.storeName, alreadySelected: true },
          extracted,
        };
      }
      throw storeSelectError;
    }
    if (await looksLikeLoginPage(page)) {
      await ensureAirregiSession(page, year, month);
    }

    const currentStoreName = await getCurrentAirregiStoreName(page);
    if (matchesAirregiStoreName(currentStoreName, target)) {
      await refreshCurrentStoreSession(page).catch(() => {});
      const extracted = await extractDailySales(page, target, year, month, debugDir, { allowEmpty: true });
      extracted.storeName = currentStoreName;
      return {
        clickResult: { matched: currentStoreName, alreadySelected: true },
        extracted,
      };
    }

    try {
      clickResult = await clickStoreByCandidates(page, target);
    } catch (error) {
      const extracted = await extractDailySales(page, target, year, month, debugDir, { allowEmpty: true });
      if (matchesAirregiStoreName(extracted.storeName, target)) {
        extracted.storeName = extracted.storeName || target.airregiNameCandidates[0];
        return {
          clickResult: { matched: extracted.storeName || target.airregiNameCandidates[0], alreadySelected: true },
          extracted,
        };
      }
      throw error;
    }
    await refreshCurrentStoreSession(page).catch(() => {});
    const extracted = await extractDailySales(page, target, year, month, debugDir, { allowEmpty: true });
    if (matchesAirregiStoreName(extracted.storeName, target)) {
      extracted.storeName = extracted.storeName || clickResult.matched;
      return { clickResult, extracted };
    }
    if (attempt === 2) {
      await writeDebugArtifacts(page, debugDir, target);
      throw new Error(`${target.code} ${target.name} の店舗切替に失敗しました。clicked=${clickResult.matched}, page=${extracted.storeName || 'unknown'}, debug=${debugDir}`);
    }
  }
  return { clickResult, extracted: null };
}

async function syncStore(page, target, periods, args, debugDir) {
  const allowEmpty = Boolean(args['skip-empty'] || periods.length > 1);
  let clickResult = null;
  const summaries = [];
  const rows = [];

  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i];
    const { year, month } = period;
    let extracted = null;
    if (i === 0) {
      if (args['assume-current-store']) {
        extracted = await extractDailySales(page, target, year, month, debugDir, { allowEmpty });
        if (!matchesAirregiStoreName(extracted.storeName, target)) {
          await writeDebugArtifacts(page, debugDir, target);
          throw new Error(`${target.code} ${target.name} の現在店舗確認に失敗しました。page=${extracted.storeName || 'unknown'}, debug=${debugDir}`);
        }
        clickResult = { matched: extracted.storeName, assumedCurrent: true };
      } else {
        const selected = await selectStore(page, target, period, args, debugDir);
        clickResult = selected.clickResult;
        extracted = selected.extracted;
      }
      if (!allowEmpty && extracted.rows.length === 0) {
        await writeDebugArtifacts(page, debugDir, target);
        throw new Error(`${target.code} ${target.name} の日別売上が取得できませんでした。debug: ${debugDir}`);
      }
    } else {
      extracted = await extractDailySales(page, target, year, month, debugDir, { allowEmpty });
      if (!matchesAirregiStoreName(extracted.storeName, target)) {
        await writeDebugArtifacts(page, debugDir, target);
        throw new Error(`${target.code} ${target.name} の店舗確認に失敗しました。page=${extracted.storeName || 'unknown'}, debug=${debugDir}`);
      }
    }

    const sourceName = `airregi-browser:${clickResult.matched}:${formatYearMonth(period)}`;
    const parsed = parseExtractedRows(extracted.rows, target, sourceName);
    const summary = parsed
      ? {
          target,
          period: formatYearMonth(period),
          matchedName: clickResult.matched,
          pageStoreName: extracted.storeName,
          ...parsed,
        }
      : {
          target,
          period: formatYearMonth(period),
          matchedName: clickResult.matched,
          pageStoreName: extracted.storeName,
          rowCount: 0,
          dateFrom: '',
          dateTo: '',
          latestMonthlySales: 0,
          rows: [],
        };
    summaries.push(summary);
    rows.push(...summary.rows);
  }

  return {
    target,
    matchedName: clickResult.matched,
    pageStoreName: summaries.find(summary => summary.pageStoreName)?.pageStoreName || '',
    rowCount: rows.length,
    dateFrom: rows[0]?.date || '',
    dateTo: rows[rows.length - 1]?.date || '',
    latestMonthlySales: rows[rows.length - 1]?.monthlySales || 0,
    summaries,
    rows,
  };
}

function writeOutputJson(filePath, payload) {
  const outputPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  return outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const periods = getTargetPeriods(args);
  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const debugDir = path.resolve(args['debug-dir'] || DEFAULT_DEBUG_DIR);

  if (args['import-json']) {
    const importPath = path.resolve(args['import-json']);
    const payload = JSON.parse(fs.readFileSync(importPath, 'utf8'));
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) throw new Error(`取り込み対象のrowsがありません: ${importPath}`);
    const isDryRun = Boolean(args['dry-run'] || args['collect-only']);
    const importResult = await dataStore.importAirregiSalesRows(rows, {
      sourceName: 'airregi-browser',
      dryRun: isDryRun,
    });
    console.log(isDryRun ? 'JSON取り込み確認完了' : 'JSON取り込み完了');
    if (importResult.updatedRange) {
      console.log(`updated: ${importResult.updatedRange}`);
      console.log(`written_rows: ${importResult.rowCount}`);
    } else {
      console.log(`written_rows: ${importResult.rowCount}`);
    }
    (payload.summaries || []).forEach(summary => {
      console.log(`${summary.storeCode}\t${summary.storeName}\t${summary.rowCount}行\t${summary.latestMonthlySales}\t${summary.matchedName || ''}\t${summary.pageStoreName || ''}`);
    });
    return;
  }

  const context = await launchBrowser(args);
  context._airregiArgs = args;
  await configureBrowserContext(context, args);
  const page = await getPage(context);

  try {
    if (args['login-only']) {
      await page.goto('https://airregi.jp/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log(`Airレジログイン用Chromeを開きました: ${page.url()}`);
      console.log(`profile: ${path.resolve(args['profile-dir'] || process.env.AIRREGI_CHROME_PROFILE_DIR || DEFAULT_PROFILE_DIR)}`);
      await promptEnter('ログインできたらEnterを押してください。ログイン状態を保存して閉じます。');
      return;
    }

    await ensureAirregiSession(page, firstPeriod.year, firstPeriod.month);

    if (args['list-airregi-stores']) {
      await gotoAirregi(page, storeSelectUrl(firstPeriod.year, firstPeriod.month));
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      const storeList = await collectAirregiStoreChoices(page);
      const choices = storeList.choices;
      const cookies = await context.cookies(['https://airregi.jp', 'https://connect.airregi.jp']).catch(() => []);
      if (args['output-json']) {
        const outputPath = writeOutputJson(args['output-json'], {
          generatedAt: new Date().toISOString(),
          url: page.url(),
          choices,
          mainBoxHtml: storeList.mainBoxHtml,
          html: await page.content().catch(() => ''),
          cookies: cookies.map(cookie => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
          })),
        });
        console.log(`output-json: ${outputPath}`);
      }
      choices.forEach(choice => {
        console.log(`${choice.index}\t${choice.tag}\t${choice.text}\t${choice.href}\t${choice.x},${choice.y}\t${choice.className}`);
      });
      return;
    }

    const requestedStoreCodes = parseStoreCodes(args.stores);
    const stores = await configReader.getStores();
    const missing = getMissingStoreCodes(stores, requestedStoreCodes);
    if (missing.length) throw new Error(`店舗コードが見つかりません: ${missing.join(', ')}`);

    const targets = buildAirregiStoreTargets(stores, requestedStoreCodes);
    if (!targets.length) throw new Error('同期対象店舗がありません。');

    const periodLabel = periods.length === 1
      ? formatYearMonth(firstPeriod)
      : `${formatYearMonth(firstPeriod)}..${formatYearMonth(lastPeriod)}`;
    console.log(`period: ${periodLabel}`);
    console.log(`stores: ${targets.map(store => `${store.code}:${store.name}`).join(', ')}`);
    if (args['dry-run'] || args['collect-only']) console.log('dry-run: スプシには書き込みません');

    const summaries = [];
    const allRows = [];
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      process.stdout.write(`[${i + 1}/${targets.length}] ${target.code} ${target.name} ... `);
      const result = await syncStore(page, target, periods, args, debugDir);
      summaries.push(result);
      allRows.push(...result.rows);
      const pageStore = result.pageStoreName ? ` / page:${result.pageStoreName}` : '';
      console.log(`${result.rowCount}行 / ${result.dateFrom || '-'}..${result.dateTo || '-'} / ${result.latestMonthlySales.toLocaleString()}円 / clicked:${result.matchedName}${pageStore}`);
    }

    let importResult = null;
    if (args['output-json']) {
      const outputPath = writeOutputJson(args['output-json'], {
        generatedAt: new Date().toISOString(),
        period: periodLabel,
        stores: targets.map(target => ({ code: target.code, name: target.name })),
        summaries: summaries.map(summary => ({
          storeCode: summary.target.code,
          storeName: summary.target.name,
          rowCount: summary.rowCount,
          dateFrom: summary.dateFrom,
          dateTo: summary.dateTo,
          latestMonthlySales: summary.latestMonthlySales,
          matchedName: summary.matchedName,
          pageStoreName: summary.pageStoreName,
        })),
        rows: allRows,
      });
      console.log(`output-json: ${outputPath}`);
    }

    if (!args['dry-run'] && !args['collect-only']) {
      importResult = await dataStore.importAirregiSalesRows(allRows, {
        sourceName: 'airregi-browser',
      });
    }

    console.log('');
    console.log(args['dry-run'] || args['collect-only'] ? '確認完了' : '同期完了');
    if (importResult) {
      console.log(`updated: ${importResult.updatedRange}`);
      console.log(`written_rows: ${importResult.rowCount}`);
    }
    summaries.forEach(summary => {
      console.log(`${summary.target.code}\t${summary.target.name}\t${summary.rowCount}行\t${summary.latestMonthlySales}\t${summary.matchedName}\t${summary.pageStoreName || ''}`);
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
