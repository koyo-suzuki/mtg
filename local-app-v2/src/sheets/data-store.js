const { getRows, appendRows, updateRange, clearRange } = require('./sheets-client');

const DATA_SPREADSHEET_ID = process.env.DATA_SPREADSHEET_ID;

// =====================================================
// Helpers
// =====================================================

function nowISO() {
  return new Date().toISOString();
}

/**
 * Find row indices matching a filter in a sheet.
 * Returns array of { index (0-based from data start), row }
 */
function findRows(rows, filters) {
  return rows
    .map((row, index) => ({ index, row }))
    .filter(({ row }) =>
      Object.entries(filters).every(([colIdx, val]) => (row[colIdx] || '') === val)
    );
}

// =====================================================
// Chorei (朝礼)
// =====================================================

/**
 * Get chorei data for a specific date and store
 */
async function getChoreiByDateStore(date, storeCode) {
  const rows = await getRows(DATA_SPREADSHEET_ID, 'chorei!A2:L5000');
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
  // Read all rows to find and remove existing entries for this date+store
  const allRows = await getRows(DATA_SPREADSHEET_ID, 'chorei!A2:L5000');
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

  // Clear and rewrite (atomic-ish operation)
  if (allData.length > 0) {
    await updateRange(DATA_SPREADSHEET_ID, `chorei!A2:L${allData.length + 1}`, allData);
    // Clear any remaining old rows below
    if (allRows.length > allData.length) {
      await clearRange(DATA_SPREADSHEET_ID, `chorei!A${allData.length + 2}:L${allRows.length + 1}`);
    }
  } else {
    await clearRange(DATA_SPREADSHEET_ID, 'chorei!A2:L5000');
  }
}

/**
 * Update a single cast's goal in chorei
 */
async function saveCastGoal(date, storeCode, gmail, goalData) {
  const allRows = await getRows(DATA_SPREADSHEET_ID, 'chorei!A2:L5000');
  const rowIndex = allRows.findIndex(r => r[0] === date && r[1] === storeCode && r[3] === gmail);

  if (rowIndex === -1) {
    return false;
  }

  const row = allRows[rowIndex];
  // Update: expectedVisitors (col 6), castGoal (col 7), needsPickup (col 9), pickupDestination (col 10)
  row[6] = String(goalData.expectedVisitors || 0);
  row[7] = goalData.goal || '';
  row[9] = goalData.needsPickup ? '1' : '0';
  row[10] = goalData.pickupDestination || '';
  row[11] = nowISO();

  const sheetRow = rowIndex + 2; // +2 because header is row 1, data starts at row 2
  await updateRange(DATA_SPREADSHEET_ID, `chorei!A${sheetRow}:L${sheetRow}`, [row]);
  return true;
}

/**
 * Get stores where a cast member is scheduled today
 */
async function getCastStores(date, gmail) {
  const rows = await getRows(DATA_SPREADSHEET_ID, 'chorei!A2:L5000');
  return rows
    .filter(r => r[0] === date && r[3] === gmail)
    .map(r => ({ storeCode: r[1] }));
}

/**
 * Get pickup list for today (all stores)
 */
async function getPickupList(date) {
  const rows = await getRows(DATA_SPREADSHEET_ID, 'chorei!A2:L5000');
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
  const rows = await getRows(DATA_SPREADSHEET_ID, 'shurei!A2:E5000');
  const row = rows.find(r => r[0] === date && r[1] === storeCode);
  if (!row) return null;
  return {
    salesToday: parseInt(row[2]) || 0,
    monthlySales: parseInt(row[3]) || 0,
  };
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
}

// =====================================================
// Self Evaluation (自己採点)
// =====================================================

async function getSelfEvalByDateStore(date, storeCode) {
  const rows = await getRows(DATA_SPREADSHEET_ID, 'self_evaluation!A2:H5000');
  return rows
    .filter(r => r[0] === date && r[1] === storeCode)
    .map(r => ({
      castName: r[2] || '',
      gmail: r[3] || '',
      score: parseInt(r[4]) || 0,
      comment: r[5] || '',
      isEarlyLeave: r[6] === '1' || r[6] === 'true',
    }));
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
}

// =====================================================
// Issues (伝言板)
// =====================================================

async function getIssuesByStore(storeCode) {
  const rows = await getRows(DATA_SPREADSHEET_ID, 'issues!A2:I5000');
  return rows
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
}

async function createIssue(date, storeCode, reporter, content) {
  const rows = await getRows(DATA_SPREADSHEET_ID, 'issues!A2:A5000');
  const maxId = rows.reduce((max, r) => Math.max(max, parseInt(r[0]) || 0), 0);
  const newId = String(maxId + 1);

  await appendRows(DATA_SPREADSHEET_ID, 'issues!A:I', [[
    newId, date, storeCode, reporter, content, '', '', '', nowISO(),
  ]]);

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
  return true;
}

module.exports = {
  getChoreiByDateStore, saveChoreiCasts, saveCastGoal, getCastStores, getPickupList,
  getShureiByDateStore, saveShurei,
  getSelfEvalByDateStore, saveSelfEval,
  getIssuesByStore, createIssue, updateIssue,
};
