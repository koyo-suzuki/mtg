const { getRows, appendRows, updateRange, clearRange } = require('./sheets-client');

const DATA_SPREADSHEET_ID = process.env.DATA_SPREADSHEET_ID;

// =====================================================
// In-memory cache (short TTL for operational data)
// =====================================================

const cache = {};
const CACHE_TTL = 30 * 1000; // 30 seconds

function getCached(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.time < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCache(key, data) {
  cache[key] = { data, time: Date.now() };
}

function invalidateCache(prefix) {
  Object.keys(cache).forEach(k => {
    if (k.startsWith(prefix)) delete cache[k];
  });
}

// =====================================================
// Helpers
// =====================================================

function nowISO() {
  return new Date().toISOString();
}

async function getChoreiRows() {
  const cached = getCached('chorei_all');
  if (cached) return cached;
  const rows = await getRows(DATA_SPREADSHEET_ID, 'chorei!A2:L10000');
  setCache('chorei_all', rows);
  return rows;
}

// =====================================================
// Chorei (朝礼)
// =====================================================

async function getChoreiByDateStore(date, storeCode) {
  const rows = await getChoreiRows();
  return rows
    .filter(r => r[0] === date && r[1] === storeCode)
    .map(r => ({
      castName: r[2] || '',
      gmail: r[3] || '',
      monthlySales: parseInt(r[4]) || 0,
      monthlyDrinks: parseInt(r[5]) || 0,
      expectedVisitors: parseInt(r[6]) || 0,
      castGoal: r[7] || '',
      managerMemo: r[8] || '',
      needsPickup: r[9] === '1' || r[9] === 'true',
      pickupDestination: r[10] || '',
    }));
}

/**
 * Save chorei casts (replaces all entries for date+store)
 */
async function saveChoreiCasts(date, storeCode, casts) {
  const allRows = await getRows(DATA_SPREADSHEET_ID, 'chorei!A2:L10000');
  const otherRows = allRows.filter(r => !(r[0] === date && r[1] === storeCode));

  const newRows = casts.map(c => [
    date,
    storeCode,
    c.castName || '',
    c.gmail || '',
    String(c.monthlySales || 0),
    String(c.monthlyDrinks || 0),
    String(c.expectedVisitors || 0),
    c.castGoal || '',
    c.managerMemo || '',
    c.needsPickup ? '1' : '0',
    c.pickupDestination || '',
    nowISO(),
  ]);

  const allData = [...otherRows, ...newRows];

  // Write all at once, then clear leftover rows if needed
  const writes = [];
  if (allData.length > 0) {
    writes.push(updateRange(DATA_SPREADSHEET_ID, `chorei!A2:L${allData.length + 1}`, allData));
  }
  if (allRows.length > allData.length) {
    writes.push(clearRange(DATA_SPREADSHEET_ID, `chorei!A${allData.length + 2}:L${allRows.length + 1}`));
  }
  await Promise.all(writes);

  invalidateCache('chorei');
}

/**
 * Update a single cast's goal in chorei
 */
async function saveCastGoal(date, storeCode, gmail, goalData) {
  const allRows = await getRows(DATA_SPREADSHEET_ID, 'chorei!A2:L10000');
  const rowIndex = allRows.findIndex(r => r[0] === date && r[1] === storeCode && r[3] === gmail);

  if (rowIndex === -1) return false;

  const row = allRows[rowIndex];
  row[6] = String(goalData.expectedVisitors || 0);
  row[7] = goalData.goal || '';
  row[9] = goalData.needsPickup ? '1' : '0';
  row[10] = goalData.pickupDestination || '';
  row[11] = nowISO();

  const sheetRow = rowIndex + 2;
  await updateRange(DATA_SPREADSHEET_ID, `chorei!A${sheetRow}:L${sheetRow}`, [row]);
  invalidateCache('chorei');
  return true;
}

/**
 * Get stores where a cast member is scheduled today
 */
async function getCastStores(date, gmail) {
  const rows = await getChoreiRows();
  return rows
    .filter(r => r[0] === date && r[3] === gmail)
    .map(r => ({ storeCode: r[1] }));
}

/**
 * Get pickup list for today (all stores)
 */
async function getPickupList(date) {
  const rows = await getChoreiRows();
  return rows
    .filter(r => r[0] === date && (r[9] === '1' || r[9] === 'true'))
    .map(r => ({
      castName: r[2] || '',
      pickupDestination: r[10] || '',
      storeCode: r[1] || '',
    }));
}

// =====================================================
// Shurei (終礼)
// =====================================================

async function getShureiByDateStore(date, storeCode) {
  const cacheKey = `shurei_${date}_${storeCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const rows = await getRows(DATA_SPREADSHEET_ID, 'shurei!A2:E5000');
  const row = rows.find(r => r[0] === date && r[1] === storeCode);
  if (!row) return null;
  const result = {
    salesToday: parseInt(row[2]) || 0,
    monthlySales: parseInt(row[3]) || 0,
  };
  setCache(cacheKey, result);
  return result;
}

async function saveShurei(date, storeCode, data) {
  const allRows = await getRows(DATA_SPREADSHEET_ID, 'shurei!A2:E5000');
  const rowIndex = allRows.findIndex(r => r[0] === date && r[1] === storeCode);

  const newRow = [date, storeCode, String(data.salesToday || 0), String(data.monthlySales || 0), nowISO()];

  if (rowIndex >= 0) {
    const sheetRow = rowIndex + 2;
    await updateRange(DATA_SPREADSHEET_ID, `shurei!A${sheetRow}:E${sheetRow}`, [newRow]);
  } else {
    await appendRows(DATA_SPREADSHEET_ID, 'shurei!A:E', [newRow]);
  }
  invalidateCache('shurei');
}

// =====================================================
// Self Evaluation (自己採点)
// =====================================================

async function getSelfEvalByDateStore(date, storeCode) {
  const cacheKey = `eval_${date}_${storeCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const rows = await getRows(DATA_SPREADSHEET_ID, 'self_evaluation!A2:H5000');
  const result = rows
    .filter(r => r[0] === date && r[1] === storeCode)
    .map(r => ({
      castName: r[2] || '',
      gmail: r[3] || '',
      score: parseInt(r[4]) || 0,
      comment: r[5] || '',
      isEarlyLeave: r[6] === '1' || r[6] === 'true',
    }));
  setCache(cacheKey, result);
  return result;
}

async function saveSelfEval(date, storeCode, gmail, castName, data) {
  const allRows = await getRows(DATA_SPREADSHEET_ID, 'self_evaluation!A2:H5000');
  const rowIndex = allRows.findIndex(r => r[0] === date && r[1] === storeCode && r[3] === gmail);

  const newRow = [
    date, storeCode, castName, gmail,
    String(data.score || 0),
    data.comment || '',
    data.isEarlyLeave ? '1' : '0',
    nowISO(),
  ];

  if (rowIndex >= 0) {
    const sheetRow = rowIndex + 2;
    await updateRange(DATA_SPREADSHEET_ID, `self_evaluation!A${sheetRow}:H${sheetRow}`, [newRow]);
  } else {
    await appendRows(DATA_SPREADSHEET_ID, 'self_evaluation!A:H', [newRow]);
  }
  invalidateCache('eval');
}

// =====================================================
// Issues (伝言板)
// =====================================================

async function getIssuesByStore(storeCode) {
  const cacheKey = `issues_${storeCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const rows = await getRows(DATA_SPREADSHEET_ID, 'issues!A2:I5000');
  const result = rows
    .filter(r => r[2] === storeCode)
    .map(r => ({
      id: r[0] || '',
      date: r[1] || '',
      storeCode: r[2] || '',
      reporter: r[3] || '',
      content: r[4] || '',
      status: r[5] || '',
      feedback: r[6] || '',
      completedAt: r[7] || '',
      createdAt: r[8] || '',
    }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 50);
  setCache(cacheKey, result);
  return result;
}

async function createIssue(date, storeCode, reporter, content) {
  const rows = await getRows(DATA_SPREADSHEET_ID, 'issues!A2:A5000');
  const maxId = rows.reduce((max, r) => Math.max(max, parseInt(r[0]) || 0), 0);
  const newId = String(maxId + 1);

  await appendRows(DATA_SPREADSHEET_ID, 'issues!A:I', [[
    newId, date, storeCode, reporter, content, '', '', '', nowISO(),
  ]]);

  invalidateCache('issues');
  return newId;
}

async function updateIssue(id, status, feedback) {
  const allRows = await getRows(DATA_SPREADSHEET_ID, 'issues!A2:I5000');
  const rowIndex = allRows.findIndex(r => r[0] === String(id));

  if (rowIndex === -1) return false;

  const row = allRows[rowIndex];
  row[5] = status || '';
  row[6] = feedback || '';
  row[7] = status === '完了' ? nowISO() : (row[7] || '');

  const sheetRow = rowIndex + 2;
  await updateRange(DATA_SPREADSHEET_ID, `issues!A${sheetRow}:I${sheetRow}`, [row]);
  invalidateCache('issues');
  return true;
}

module.exports = {
  getChoreiByDateStore, saveChoreiCasts, saveCastGoal, getCastStores, getPickupList,
  getShureiByDateStore, saveShurei,
  getSelfEvalByDateStore, saveSelfEval,
  getIssuesByStore, createIssue, updateIssue,
};
