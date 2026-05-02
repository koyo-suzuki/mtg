const { google } = require('googleapis');

let sheetsClient = null;
let lastRequestAt = 0;
let requestQueue = Promise.resolve();

const MIN_REQUEST_INTERVAL_MS = parseInt(process.env.SHEETS_MIN_REQUEST_INTERVAL_MS || '250', 10);
const MAX_RETRIES = parseInt(process.env.SHEETS_API_MAX_RETRIES || '3', 10);

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (keyJson) {
    const key = JSON.parse(keyJson);
    return new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  // Fallback: Application Default Credentials (for local dev with gcloud auth)
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheets() {
  if (!sheetsClient) {
    sheetsClient = google.sheets({ version: 'v4', auth: getAuth() });
  }
  return sheetsClient;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableSheetsError(error) {
  const status = error?.code || error?.response?.status;
  const reason = error?.errors?.[0]?.reason || error?.response?.data?.error?.status || '';
  const message = String(error?.message || '').toLowerCase();

  return status === 429 ||
    status === 500 ||
    status === 503 ||
    reason.toLowerCase().includes('quota') ||
    reason.toLowerCase().includes('ratelimit') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('resource has been exhausted');
}

function withRequestQueue(operation) {
  const run = requestQueue.then(async () => {
    const waitMs = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (waitMs > 0) await sleep(waitMs);
    lastRequestAt = Date.now();
    return operation();
  });
  requestQueue = run.catch(() => {});
  return run;
}

async function callSheets(operation, label) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await withRequestQueue(operation);
    } catch (error) {
      lastError = error;
      if (!isRetryableSheetsError(error) || attempt === MAX_RETRIES) break;

      const backoffMs = Math.min(30000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 500);
      console.warn(`Sheets API retry ${attempt + 1}/${MAX_RETRIES} for ${label}: ${error.message}`);
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

/**
 * Read rows from a sheet range
 */
async function getRows(spreadsheetId, range) {
  const sheets = getSheets();
  const res = await callSheets(
    () => sheets.spreadsheets.values.get({ spreadsheetId, range }),
    `get ${range}`
  );
  return res.data.values || [];
}

/**
 * Append rows to a sheet
 */
async function appendRows(spreadsheetId, range, values) {
  const sheets = getSheets();
  await callSheets(
    () => sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    }),
    `append ${range}`
  );
}

/**
 * Update (overwrite) a specific range
 */
async function updateRange(spreadsheetId, range, values) {
  const sheets = getSheets();
  await callSheets(
    () => sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values },
    }),
    `update ${range}`
  );
}

/**
 * Clear a range
 */
async function clearRange(spreadsheetId, range) {
  const sheets = getSheets();
  await callSheets(
    () => sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
      requestBody: {},
    }),
    `clear ${range}`
  );
}

/**
 * Batch get multiple ranges
 */
async function batchGet(spreadsheetId, ranges) {
  const sheets = getSheets();
  const res = await callSheets(
    () => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }),
    `batchGet ${ranges.join(',')}`
  );
  return res.data.valueRanges || [];
}

module.exports = { getRows, appendRows, updateRange, clearRange, batchGet };
