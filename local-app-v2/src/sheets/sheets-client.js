const { google } = require('googleapis');

let sheetsClient = null;

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

/**
 * Read rows from a sheet range
 */
async function getRows(spreadsheetId, range) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

/**
 * Append rows to a sheet
 */
async function appendRows(spreadsheetId, range, values) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

/**
 * Update (overwrite) a specific range
 */
async function updateRange(spreadsheetId, range, values) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

/**
 * Clear a range
 */
async function clearRange(spreadsheetId, range) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range,
    requestBody: {},
  });
}

/**
 * Batch get multiple ranges
 */
async function batchGet(spreadsheetId, ranges) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  return res.data.valueRanges || [];
}

module.exports = { getRows, appendRows, updateRange, clearRange, batchGet };
