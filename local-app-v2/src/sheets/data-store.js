const { getRows, appendRows, updateRange, clearRange, batchGet } = require('./sheets-client');
const {
  AIRREGI_SALES_SHEET_NAME,
  AIRREGI_SALES_HEADER,
  parseAirregiSalesCsv,
} = require('../airregi/sales-csv');

const DATA_SPREADSHEET_ID = process.env.DATA_SPREADSHEET_ID;
const AIRREGI_SALES_RANGE = `${AIRREGI_SALES_SHEET_NAME}!A2:G100000`;

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

function parseSheetNumber(value) {
  if (value === null || value === undefined) return 0;
  const normalized = String(value).replace(/[¥￥,\s]/g, '');
  return parseInt(normalized || '0', 10) || 0;
}

function parseSheetBoolean(value) {
  if (value === true) return true;
  return ['true', '1', 'yes', 'checked'].includes(String(value || '').trim().toLowerCase());
}

async function getOptionalRows(spreadsheetId, range) {
  try {
    return await getRows(spreadsheetId, range);
  } catch (error) {
    if (String(error?.message || '').includes('Unable to parse range')) {
      return [];
    }
    throw error;
  }
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

  if (rowIndex === -1) {
    // 朝礼に未追加 → 自分の行を自動作成
    const newRow = [
      date, storeCode, goalData.castName || '', gmail,
      '0', '0',
      String(goalData.expectedVisitors || 0),
      goalData.goal || '',
      '',
      goalData.needsPickup ? '1' : '0',
      goalData.pickupDestination || '',
      nowISO(),
    ];
    await appendRows(DATA_SPREADSHEET_ID, 'chorei!A:L', [newRow]);
    invalidateCache('chorei');
    return true;
  }

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

// =====================================================
// Manager Feedback (店責フィードバック)
// =====================================================

async function createManagerFeedback(date, storeCode, reporterEmail, reporterName, targetName, content) {
  const rows = await getRows(DATA_SPREADSHEET_ID, 'manager_feedback!A2:A5000');
  const maxId = rows.reduce((max, r) => Math.max(max, parseInt(r[0]) || 0), 0);
  const newId = String(maxId + 1);

  await appendRows(DATA_SPREADSHEET_ID, 'manager_feedback!A:I', [[
    newId,
    date,
    storeCode,
    targetName || '',
    content,
    reporterEmail,
    reporterName || '',
    '未確認',
    nowISO(),
  ]]);

  invalidateCache('manager_feedback');
  return newId;
}

// =====================================================
// Remote orders (遠隔注文)
// =====================================================

function mapRemoteOrderItem(row) {
  return {
    slipKey: row[0] || '',
    wixOrderId: row[1] || '',
    orderNumber: row[2] || '',
    lineItemId: row[3] || '',
    lineNo: parseInt(row[4], 10) || 0,
    businessDate: row[5] || '',
    orderedAt: row[6] || '',
    storeCode: row[7] || '',
    storeRaw: row[8] || '',
    productName: row[9] || '',
    variantName: row[10] || '',
    castName: row[11] || '',
    quantity: parseSheetNumber(row[12]),
    unitPrice: parseSheetNumber(row[13]),
    lineSubtotal: parseSheetNumber(row[14]),
    currency: row[15] || 'JPY',
    customerComment: row[16] || '',
    mappingStatus: row[17] || '',
  };
}

function mapRemoteStoreSlip(row) {
  return {
    slipKey: row[0] || '',
    wixOrderId: row[1] || '',
    orderNumber: row[2] || '',
    businessDate: row[3] || '',
    orderedAt: row[4] || '',
    storeCode: row[5] || '',
    storeRaw: row[6] || '',
    itemCount: parseSheetNumber(row[7]),
    itemTotal: parseSheetNumber(row[8]),
    currency: row[9] || 'JPY',
    paymentStatus: row[10] || '',
    paymentVerified: parseSheetBoolean(row[11]),
    displayOk: parseSheetBoolean(row[12]),
    assignmentStatus: row[13] || '',
    confirmedBy: row[14] || '',
    confirmedAt: row[15] || '',
    cancelStatus: row[16] || '',
    sharedToStore: parseSheetBoolean(row[17]),
    wixUpdatedAt: row[18] || '',
    receivedAt: row[19] || '',
  };
}

async function getRemoteOrderData() {
  const ranges = [
    'remote_order_items!A2:U10000',
    'remote_store_slips!A2:T10000',
  ];
  const results = await batchGet(DATA_SPREADSHEET_ID, ranges);
  const items = (results[0]?.values || []).map(mapRemoteOrderItem);
  const slips = (results[1]?.values || []).map(mapRemoteStoreSlip);
  const itemsBySlip = items.reduce((grouped, item) => {
    if (!grouped[item.slipKey]) grouped[item.slipKey] = [];
    grouped[item.slipKey].push(item);
    return grouped;
  }, {});

  return slips.map(slip => ({
    ...slip,
    items: (itemsBySlip[slip.slipKey] || [])
      .sort((a, b) => a.lineNo - b.lineNo),
  }));
}

async function getRemoteOrdersForReview(businessDate) {
  const orders = await getRemoteOrderData();
  return orders
    .filter(order => !businessDate || order.businessDate === businessDate)
    .sort((a, b) => String(b.orderedAt).localeCompare(String(a.orderedAt)));
}

async function getPublishedRemoteOrders(businessDate, storeCode) {
  const orders = await getRemoteOrderData();
  return orders
    .filter(order =>
      order.businessDate === businessDate &&
      order.storeCode === storeCode &&
      order.paymentVerified &&
      order.displayOk &&
      !order.cancelStatus
    )
    .sort((a, b) => String(b.orderedAt).localeCompare(String(a.orderedAt)));
}

async function updateRemoteOrderReview(slipKey, review) {
  const [slipRows, itemRows] = await Promise.all([
    getRows(DATA_SPREADSHEET_ID, 'remote_store_slips!A2:T10000'),
    getRows(DATA_SPREADSHEET_ID, 'remote_order_items!A2:U10000'),
  ]);
  const slipIndex = slipRows.findIndex(row => row[0] === slipKey);
  if (slipIndex === -1) throw new Error('対象の遠隔注文が見つかりません');

  const storeCode = String(review.storeCode || '').trim();
  const paymentVerified = Boolean(review.paymentVerified);
  const displayOk = Boolean(review.displayOk);
  if (displayOk && !storeCode) {
    throw new Error('店舗を選択してから表示OKにしてください');
  }
  if (displayOk && !paymentVerified) {
    throw new Error('入金確認後に表示OKにしてください');
  }

  const slipRow = slipRows[slipIndex];
  slipRow[5] = storeCode;
  slipRow[11] = paymentVerified;
  slipRow[12] = displayOk;
  slipRow[13] = displayOk ? '公開済み' : (storeCode ? '確認中' : '確認待ち');
  slipRow[14] = displayOk ? String(review.confirmedBy || '') : '';
  slipRow[15] = displayOk ? nowISO() : '';

  const writes = [
    updateRange(
      DATA_SPREADSHEET_ID,
      `remote_store_slips!A${slipIndex + 2}:T${slipIndex + 2}`,
      [slipRow]
    ),
  ];

  itemRows.forEach((row, index) => {
    if (row[0] !== slipKey) return;
    row[7] = storeCode;
    row[17] = storeCode ? '手動割当済み' : '確認待ち';
    writes.push(
      updateRange(
        DATA_SPREADSHEET_ID,
        `remote_order_items!A${index + 2}:U${index + 2}`,
        [row]
      )
    );
  });

  await Promise.all(writes);
  return {
    ...mapRemoteStoreSlip(slipRow),
    itemsUpdated: Math.max(0, writes.length - 1),
  };
}

// =====================================================
// Dashboard (ダッシュボード)
// =====================================================

const dashboardCache = {};
const DASH_CACHE_TTL = 5 * 60 * 1000;           // 5 min (includes today)
const DASH_HISTORICAL_CACHE_TTL = 30 * 60 * 1000; // 30 min (past-only ranges)

function invalidateDashboardCache() {
  Object.keys(dashboardCache).forEach(k => delete dashboardCache[k]);
}

function getDashCached(key, toDate) {
  const entry = dashboardCache[key];
  if (!entry) return null;
  const today = new Date().toISOString().slice(0, 10);
  const ttl = toDate < today ? DASH_HISTORICAL_CACHE_TTL : DASH_CACHE_TTL;
  if (Date.now() - entry.time < ttl) return entry.data;
  return null;
}

function setDashCache(key, data) {
  dashboardCache[key] = { data, time: Date.now() };
}

function summarizeAirregiRows(rows) {
  const sortedRows = [...rows].sort((a, b) => {
    return String(a.date).localeCompare(String(b.date)) || String(a.storeCode).localeCompare(String(b.storeCode));
  });
  const first = sortedRows[0] || null;
  const last = sortedRows[sortedRows.length - 1] || null;
  return {
    rowCount: sortedRows.length,
    dateFrom: first ? first.date : '',
    dateTo: last ? last.date : '',
    storeCount: new Set(sortedRows.map(row => row.storeCode)).size,
    latestMonthlySales: last ? Number(last.monthlySales || 0) : 0,
  };
}

function toAirregiSheetRows(rows, source, syncedAt) {
  return rows.map(row => [
    row.date,
    row.storeCode,
    String(row.salesTotal),
    String(row.monthlySales),
    String(row.source || source),
    syncedAt,
    row.sourceUpdatedAt || '',
  ]);
}

async function importAirregiSalesRows(rows, options = {}) {
  if (!DATA_SPREADSHEET_ID) throw new Error('DATA_SPREADSHEET_ID is not set.');

  const parsedRows = (rows || [])
    .map(row => ({
      date: String(row.date || '').trim(),
      storeCode: String(row.storeCode || '').trim(),
      salesTotal: parseSheetNumber(row.salesTotal),
      monthlySales: parseSheetNumber(row.monthlySales),
      source: String(row.source || '').trim(),
      sourceUpdatedAt: String(row.sourceUpdatedAt || '').trim(),
    }))
    .filter(row => row.date && row.storeCode);
  const summary = summarizeAirregiRows(parsedRows);
  if (options.dryRun) return summary;

  const syncedAt = nowISO();
  const source = String(options.sourceName || 'csv-upload').trim();
  const importedKeys = new Set(parsedRows.map(row => `${row.date}\t${row.storeCode}`));
  const existingRows = await getRows(DATA_SPREADSHEET_ID, AIRREGI_SALES_RANGE);
  const keptRows = existingRows.filter(row => !importedKeys.has(`${row[0]}\t${row[1]}`));
  const nextRows = [
    AIRREGI_SALES_HEADER,
    ...keptRows,
    ...toAirregiSheetRows(parsedRows, source, syncedAt),
  ].sort((a, b) => {
    if (a === AIRREGI_SALES_HEADER) return -1;
    if (b === AIRREGI_SALES_HEADER) return 1;
    return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]));
  });
  const updatedRange = `${AIRREGI_SALES_SHEET_NAME}!A1:G${nextRows.length}`;

  await updateRange(DATA_SPREADSHEET_ID, updatedRange, nextRows);
  if (existingRows.length + 1 > nextRows.length) {
    await clearRange(DATA_SPREADSHEET_ID, `${AIRREGI_SALES_SHEET_NAME}!A${nextRows.length + 1}:G${existingRows.length + 1}`);
  }

  invalidateDashboardCache();
  return { ...summary, updatedRange, syncedAt };
}

async function importAirregiSalesCsv(options = {}) {
  const parsed = parseAirregiSalesCsv(options.csvText || '', {
    storeCode: options.storeCode,
    fixedDate: options.fixedDate,
  });
  const result = await importAirregiSalesRows(parsed.rows, {
    sourceName: options.sourceName,
    dryRun: options.dryRun,
  });
  return { ...parsed, ...result };
}

async function getDashboardSummary(from, to, storeCode, options = {}) {
  const includeManagerFeedback = Boolean(options.includeManagerFeedback);
  const cacheKey = `dash_${from}_${to}_${storeCode}_${includeManagerFeedback ? 'with_feedback' : 'base'}`;
  const cached = getDashCached(cacheKey, to);
  if (cached) return cached;

  const ranges = [
    'shurei!A2:E5000',
    'chorei!A2:L10000',
    'self_evaluation!A2:H5000',
    'issues!A2:I5000',
  ];
  if (includeManagerFeedback) {
    ranges.push('manager_feedback!A2:I5000');
  }
  const [results, airregiRows] = await Promise.all([
    batchGet(DATA_SPREADSHEET_ID, ranges),
    getOptionalRows(DATA_SPREADSHEET_ID, AIRREGI_SALES_RANGE),
  ]);

  const inRange = (d) => d >= from && d <= to;
  const matchStore = (s) => storeCode === 'all' || s === storeCode;

  // Sales (shurei)
  const shureiSales = (results[0].values || [])
    .filter(r => inRange(r[0]) && matchStore(r[1]))
    .map(r => ({
      date: r[0],
      storeCode: r[1],
      salesToday: parseSheetNumber(r[2]),
      monthlySales: parseSheetNumber(r[3]),
      source: 'shurei',
    }));

  const airregiSales = (airregiRows || [])
    .filter(r => inRange(r[0]) && matchStore(r[1]))
    .map(r => ({
      date: r[0],
      storeCode: r[1],
      salesToday: parseSheetNumber(r[2]),
      monthlySales: parseSheetNumber(r[3]),
      source: 'airregi_sales_daily',
      syncedAt: r[5] || '',
      sourceUpdatedAt: r[6] || '',
    }));

  const airregiKeys = new Set(airregiSales.map(r => `${r.date}\t${r.storeCode}`));
  const shureiFallbackSales = shureiSales.filter(r => !airregiKeys.has(`${r.date}\t${r.storeCode}`));
  const sales = airregiSales.length > 0
    ? [...airregiSales, ...shureiFallbackSales]
    : shureiSales;
  const salesSource = airregiSales.length > 0
    ? (shureiFallbackSales.length > 0 ? 'mixed_airregi_shurei' : 'airregi_sales_daily')
    : 'shurei';

  // Attendance (chorei)
  const attendance = (results[1].values || [])
    .filter(r => inRange(r[0]) && matchStore(r[1]))
    .map(r => ({
      date: r[0],
      storeCode: r[1],
      castName: r[2] || '',
      gmail: r[3] || '',
      monthlySales: parseInt(r[4]) || 0,
      monthlyDrinks: parseInt(r[5]) || 0,
      expectedVisitors: parseInt(r[6]) || 0,
      castGoal: r[7] || '',
      needsPickup: r[9] === '1' || r[9] === 'true',
    }));

  // Evaluations (self_evaluation)
  const evaluations = (results[2].values || [])
    .filter(r => inRange(r[0]) && matchStore(r[1]))
    .map(r => ({
      date: r[0],
      storeCode: r[1],
      castName: r[2] || '',
      gmail: r[3] || '',
      score: parseInt(r[4]) || 0,
      comment: r[5] || '',
      isEarlyLeave: r[6] === '1' || r[6] === 'true',
    }));

  // Issues
  const issues = (results[3].values || [])
    .filter(r => inRange(r[1]) && matchStore(r[2]))
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
    }));

  const managerFeedback = includeManagerFeedback
    ? (results[4].values || [])
      .filter(r => inRange(r[1]) && matchStore(r[2]))
      .map(r => ({
        id: r[0] || '',
        date: r[1] || '',
        storeCode: r[2] || '',
        targetName: r[3] || '',
        content: r[4] || '',
        reporterEmail: r[5] || '',
        reporterName: r[6] || '',
        status: r[7] || '',
        createdAt: r[8] || '',
      }))
    : [];

  const data = { sales, salesSource, attendance, evaluations, issues, managerFeedback };
  setDashCache(cacheKey, data);
  return data;
}

module.exports = {
  getChoreiByDateStore, saveChoreiCasts, saveCastGoal, getCastStores, getPickupList,
  getShureiByDateStore, saveShurei,
  getSelfEvalByDateStore, saveSelfEval,
  getIssuesByStore, createIssue, updateIssue,
  createManagerFeedback,
  getRemoteOrdersForReview, getPublishedRemoteOrders, updateRemoteOrderReview,
  getDashboardSummary, importAirregiSalesCsv, importAirregiSalesRows, invalidateDashboardCache,
};
