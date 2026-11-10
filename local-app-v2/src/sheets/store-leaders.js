const crypto = require('crypto');
const {
  getRows,
  appendRows,
  updateRange,
  getSpreadsheetMetadata,
  batchUpdateSpreadsheet,
} = require('./sheets-client');

// =====================================================
// 店責・副店責の記録（store_leaders シート）
//
// 1行 = 1人が1店舗で、店責 or 副店責を担当した区間。
// 交代・終了は endAt を埋めるだけで、行は消さない（履歴として残す）。
// 取消（入力ミス）は deletedAt を埋める。
// =====================================================

const SHEET_NAME = 'store_leaders';
const HEADER = [
  'id', 'businessDate', 'storeCode', 'position', 'gmail', 'castName',
  'startAt', 'endAt', 'createdBy', 'createdAt', 'updatedAt', 'deletedAt',
  'updatedBy', 'note',
];
const RANGE = `${SHEET_NAME}!A2:N`;
const LAST_COL = 'N';
const POSITIONS = ['leader', 'sub'];

function spreadsheetId() {
  return process.env.DATA_SPREADSHEET_ID;
}

function nowISO() {
  return new Date().toISOString();
}

function newId() {
  return `SL-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function toRecord(values, index) {
  return {
    sheetRow: index + 2,
    id: values[0] || '',
    businessDate: values[1] || '',
    storeCode: values[2] || '',
    position: values[3] || '',
    gmail: normalizeEmail(values[4]),
    castName: values[5] || '',
    startAt: values[6] || '',
    endAt: values[7] || '',
    createdBy: values[8] || '',
    createdAt: values[9] || '',
    updatedAt: values[10] || '',
    deletedAt: values[11] || '',
    updatedBy: values[12] || '',
    note: values[13] || '',
  };
}

function toValues(r) {
  return [
    r.id, r.businessDate, r.storeCode, r.position, r.gmail, r.castName,
    r.startAt, r.endAt || '', r.createdBy || '', r.createdAt || '', r.updatedAt || '', r.deletedAt || '',
    r.updatedBy || '', r.note || '',
  ];
}

function publicRecord(r) {
  const { sheetRow, deletedAt, createdBy, createdAt, updatedAt, updatedBy, ...rest } = r;
  return rest;
}

function isActive(r, date) {
  return r.businessDate === date && !r.endAt && !r.deletedAt && Boolean(r.id);
}

let sheetChecked = false;

async function ensureSheet() {
  if (sheetChecked) return;
  const metadata = await getSpreadsheetMetadata(spreadsheetId());
  const exists = (metadata.sheets || []).some(s => s.properties?.title === SHEET_NAME);
  if (!exists) {
    try {
      await batchUpdateSpreadsheet(spreadsheetId(), [{ addSheet: { properties: { title: SHEET_NAME } } }]);
      await updateRange(spreadsheetId(), `${SHEET_NAME}!A1:${LAST_COL}1`, [HEADER]);
    } catch (error) {
      // 同時に別インスタンスが作成した場合は、読み直して存在すれば成功とみなす
      const refreshed = await getSpreadsheetMetadata(spreadsheetId());
      if (!(refreshed.sheets || []).some(s => s.properties?.title === SHEET_NAME)) throw error;
    }
  } else {
    // 列を追加したので、古い見出し行なら足りない列名を書き足す
    const header = (await getRows(spreadsheetId(), `${SHEET_NAME}!A1:${LAST_COL}1`))[0] || [];
    if (header.length < HEADER.length) {
      await updateRange(spreadsheetId(), `${SHEET_NAME}!A1:${LAST_COL}1`, [HEADER]);
    }
  }
  sheetChecked = true;
}

async function readAll() {
  try {
    const rows = await getRows(spreadsheetId(), RANGE);
    return rows.map(toRecord).filter(r => r.id);
  } catch (error) {
    if (String(error?.message || '').includes('Unable to parse range')) return [];
    throw error;
  }
}

async function writeRecord(r) {
  await updateRange(spreadsheetId(), `${SHEET_NAME}!A${r.sheetRow}:${LAST_COL}${r.sheetRow}`, [toValues(r)]);
}

async function closeRecords(records, at, editor = '') {
  for (const r of records) {
    r.endAt = at;
    r.updatedAt = at;
    r.updatedBy = editor;
    await writeRecord(r);
  }
}

/**
 * その営業日の記録（取消済みを除く）
 */
async function getStoreLeaders(date) {
  const all = await readAll();
  return all.filter(r => r.businessDate === date && !r.deletedAt).map(publicRecord);
}

/**
 * 店責 or 副店責として入る（兼任店舗もまとめて）。
 * 各店舗で、同じ役割の今の担当者と、自分の別役割の担当は終了にする。
 */
async function enterStoreLeader({ date, storeCodes, position, gmail, castName, editorEmail }) {
  if (!POSITIONS.includes(position)) throw new Error('役割を選んでください');
  const codes = [...new Set((storeCodes || []).filter(Boolean))];
  if (!codes.length) throw new Error('店舗を選んでください');
  const me = normalizeEmail(gmail);
  if (!me) throw new Error('ログイン情報を確認してください');

  await ensureSheet();
  const all = await readAll();
  const at = nowISO();
  const toClose = [];
  const toAppend = [];

  codes.forEach(storeCode => {
    const active = all.filter(r => isActive(r, date) && r.storeCode === storeCode);
    if (active.some(r => r.position === position && r.gmail === me)) return; // すでに担当中
    active
      .filter(r => r.position === position || r.gmail === me)
      .forEach(r => toClose.push(r));
    toAppend.push({
      id: newId(), businessDate: date, storeCode, position, gmail: me, castName: castName || '',
      startAt: at, endAt: '', createdBy: normalizeEmail(editorEmail), createdAt: at, updatedAt: at, deletedAt: '',
    });
  });

  await closeRecords(toClose, at, normalizeEmail(editorEmail));
  if (toAppend.length) await appendRows(spreadsheetId(), `${SHEET_NAME}!A:${LAST_COL}`, toAppend.map(toValues));
  return { added: toAppend.length, closed: toClose.length };
}

/**
 * 自分の担当を、次の人へ交代する。
 */
async function handoverStoreLeader({ date, id, toGmail, toCastName, editorEmail }) {
  const editor = normalizeEmail(editorEmail);
  const target = normalizeEmail(toGmail);
  if (!target) throw new Error('次の担当を選んでください');
  if (target === editor) throw new Error('自分以外を選んでください');

  await ensureSheet();
  const all = await readAll();
  const current = all.find(r => r.id === id);
  if (!current || !isActive(current, date)) throw new Error('この担当はすでに終了しています。画面を再読み込みしてください');
  if (current.gmail !== editor) throw new Error('自分の担当だけ交代できます');

  const at = nowISO();
  // 次の人がこの店舗で別の役割をしていれば、それも終了する
  const targetActive = all.filter(r => isActive(r, date) && r.storeCode === current.storeCode && r.gmail === target);
  await closeRecords([current, ...targetActive], at, editor);
  await appendRows(spreadsheetId(), `${SHEET_NAME}!A:${LAST_COL}`, [toValues({
    id: newId(), businessDate: date, storeCode: current.storeCode, position: current.position,
    gmail: target, castName: toCastName || '', startAt: at, endAt: '',
    createdBy: editor, createdAt: at, updatedAt: at, deletedAt: '',
  })]);
}

/**
 * 自分の担当を終える（退勤・中抜け）。
 */
async function endStoreLeaders({ date, ids, editorEmail }) {
  const editor = normalizeEmail(editorEmail);
  const all = await readAll();
  const targets = all.filter(r => (ids || []).includes(r.id) && isActive(r, date) && r.gmail === editor);
  if (!targets.length) throw new Error('終了できる担当がありません。画面を再読み込みしてください');
  await closeRecords(targets, nowISO(), editor);
  return { closed: targets.length };
}

/**
 * 入力ミスの取消（自分の記録だけ）。
 */
async function deleteStoreLeader({ date, id, editorEmail }) {
  const editor = normalizeEmail(editorEmail);
  const all = await readAll();
  const r = all.find(x => x.id === id);
  if (!r || r.deletedAt || r.businessDate !== date) throw new Error('この記録は取り消せません');
  if (r.gmail !== editor && r.createdBy !== editor) throw new Error('自分の記録だけ取り消せます');
  const at = nowISO();
  r.deletedAt = at;
  r.updatedAt = at;
  r.updatedBy = editor;
  await writeRecord(r);
}

// ---- 本部による修正（記録漏れ・終了押し忘れなど） ----

function validIso(value) {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

/**
 * 本部が記録を追加・修正する。id があれば修正、なければ追加。
 * 同じ店舗・同じ役割で時間が重なる記録があればエラー（店責・副店責はそれぞれ1人）。
 */
async function saveStoreLeaderByAdmin({ id, businessDate, storeCode, position, gmail, castName, startAt, endAt, note, editorEmail, now = Date.now() }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || ''))) throw new Error('営業日を確認してください');
  if (!storeCode) throw new Error('店舗を選んでください');
  if (!POSITIONS.includes(position)) throw new Error('役割を選んでください');
  const person = normalizeEmail(gmail);
  if (!person) throw new Error('担当者を選んでください');
  if (!validIso(startAt)) throw new Error('開始時刻を確認してください');
  if (endAt && !validIso(endAt)) throw new Error('終了時刻を確認してください');
  if (endAt && Date.parse(endAt) <= Date.parse(startAt)) throw new Error('終了は開始より後にしてください');

  await ensureSheet();
  const all = await readAll();
  const editor = normalizeEmail(editorEmail);
  const target = id ? all.find(r => r.id === id && !r.deletedAt) : null;
  if (id && !target) throw new Error('この記録は見つかりません。画面を再読み込みしてください');

  const start = Date.parse(startAt);
  const end = endAt ? Date.parse(endAt) : effectiveEnd({ businessDate, endAt: '' }, now);
  const overlap = all.find(r => r.id !== id && !r.deletedAt && r.businessDate === businessDate
    && r.storeCode === storeCode && r.position === position
    && Date.parse(r.startAt) < end && start < effectiveEnd(r, now));
  if (overlap) {
    throw new Error(`同じ時間帯に${overlap.castName || overlap.gmail}さんの記録があります。先にそちらを直してください`);
  }

  const at = nowISO();
  const fields = {
    businessDate, storeCode, position, gmail: person, castName: castName || '',
    startAt: new Date(start).toISOString(), endAt: endAt ? new Date(Date.parse(endAt)).toISOString() : '',
    note: String(note || '').slice(0, 200), updatedAt: at, updatedBy: editor,
  };
  if (target) {
    Object.assign(target, fields);
    await writeRecord(target);
    return { id: target.id };
  }
  const record = { id: newId(), ...fields, createdBy: editor, createdAt: at, deletedAt: '' };
  await appendRows(spreadsheetId(), `${SHEET_NAME}!A:${LAST_COL}`, [toValues(record)]);
  return { id: record.id };
}

async function deleteStoreLeaderByAdmin({ id, editorEmail }) {
  const all = await readAll();
  const r = all.find(x => x.id === id && !x.deletedAt);
  if (!r) throw new Error('この記録は見つかりません。画面を再読み込みしてください');
  const at = nowISO();
  r.deletedAt = at;
  r.updatedAt = at;
  r.updatedBy = normalizeEmail(editorEmail);
  await writeRecord(r);
}

// ---- 月間集計 ----

function nextDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function effectiveEnd(r, now) {
  if (r.endAt) return Date.parse(r.endAt);
  // 終了を押し忘れた過去の記録は、その営業日の締め（翌朝5時）で打ち切る
  const close = Date.parse(`${nextDate(r.businessDate)}T05:00:00+09:00`);
  return Math.min(now, close);
}

/**
 * 月間の人別集計
 * leaderDays / subDays: 店責・副店責をした日数
 * kenninDays: 同じ日に2店舗以上を担当した日数
 * maxStores: 1日に担当した最大店舗数
 * hours: 担当時間の合計
 */
function summarize(records, { month, storeCode, today = '', now = Date.now() }) {
  const people = new Map();
  records
    .filter(r => !r.deletedAt && r.businessDate.startsWith(month))
    .forEach(r => {
      const key = r.gmail || r.castName;
      if (!people.has(key)) people.set(key, { gmail: r.gmail, castName: r.castName, days: new Map(), ms: 0, touchesStore: false, storeDays: new Set(), unfinished: 0 });
      const p = people.get(key);
      if (r.castName) p.castName = r.castName;
      if (!p.days.has(r.businessDate)) p.days.set(r.businessDate, { leader: false, sub: false, stores: new Set() });
      const d = p.days.get(r.businessDate);
      d.stores.add(r.storeCode);
      if (!storeCode || storeCode === 'all' || r.storeCode === storeCode) {
        p.touchesStore = true;
        if (r.position === 'leader') d.leader = true;
        if (r.position === 'sub') d.sub = true;
        p.storeDays.add(`${r.businessDate}|${r.storeCode}`);
        if (!r.endAt && today && r.businessDate < today) p.unfinished += 1;
        const start = Date.parse(r.startAt);
        const end = effectiveEnd(r, now);
        if (start && end > start) p.ms += end - start;
      }
    });

  return [...people.values()]
    .filter(p => p.touchesStore)
    .map(p => {
      const days = [...p.days.values()];
      return {
        gmail: p.gmail,
        castName: p.castName,
        leaderDays: days.filter(d => d.leader).length,
        subDays: days.filter(d => d.sub).length,
        kenninDays: days.filter(d => d.stores.size > 1).length,
        maxStores: days.reduce((m, d) => Math.max(m, d.stores.size), 0),
        storeDays: p.storeDays.size,
        unfinished: p.unfinished,
        hours: Math.round(p.ms / 900000) / 4, // 15分単位
      };
    })
    .sort((a, b) => (b.leaderDays - a.leaderDays) || (b.subDays - a.subDays) || (b.hours - a.hours));
}

async function getStoreLeaderSummary({ month, storeCode }) {
  const all = await readAll();
  return summarize(all, { month, storeCode });
}

/**
 * 月の記録一覧と人別集計。gmail を渡すとその人の記録だけにする（店責本人が見る場合）。
 */
async function getStoreLeaderHistory({ month, storeCode = 'all', gmail = '', today = '' }) {
  const all = await readAll();
  const person = normalizeEmail(gmail);
  const mine = person ? all.filter(r => r.gmail === person) : all;
  const records = mine
    .filter(r => !r.deletedAt && r.businessDate.startsWith(month)
      && (storeCode === 'all' || !storeCode || r.storeCode === storeCode))
    .sort((a, b) => (b.businessDate.localeCompare(a.businessDate)) || a.storeCode.localeCompare(b.storeCode)
      || a.position.localeCompare(b.position) || a.startAt.localeCompare(b.startAt))
    .map(r => ({ ...publicRecord(r), updatedBy: r.updatedBy, createdBy: r.createdBy }));
  return { records, summary: summarize(mine, { month, storeCode, today }) };
}

module.exports = {
  getStoreLeaders,
  enterStoreLeader,
  handoverStoreLeader,
  endStoreLeaders,
  deleteStoreLeader,
  getStoreLeaderSummary,
  getStoreLeaderHistory,
  saveStoreLeaderByAdmin,
  deleteStoreLeaderByAdmin,
  summarize,
  SHEET_NAME,
  HEADER,
};
