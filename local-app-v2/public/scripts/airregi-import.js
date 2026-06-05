const SESSION_KEY = 'mtg_session';
const ALLOWED_ROLES = ['senior_manager', 'manager', 'executive'];

let session = null;
let csvText = '';
let csvFileName = '';

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  elements.importAlert = document.getElementById('importAlert');
  elements.loginRequired = document.getElementById('loginRequired');
  elements.importForm = document.getElementById('importForm');
  elements.storeSelect = document.getElementById('storeSelect');
  elements.fixedDateInput = document.getElementById('fixedDateInput');
  elements.csvFileInput = document.getElementById('csvFileInput');
  elements.fileStatus = document.getElementById('fileStatus');
  elements.previewButton = document.getElementById('previewButton');
  elements.importButton = document.getElementById('importButton');
  elements.resultSection = document.getElementById('resultSection');
  elements.resultSummary = document.getElementById('resultSummary');

  elements.csvFileInput.addEventListener('change', handleFileSelect);
  elements.previewButton.addEventListener('click', () => submitCsv(true));
  elements.importButton.addEventListener('click', () => submitCsv(false));

  init();
});

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

async function init() {
  session = loadSession();
  if (!session || !session.idToken) {
    elements.loginRequired.classList.remove('hidden');
    return;
  }
  if (!ALLOWED_ROLES.includes(session.role)) {
    showAlert('error', '権限がありません');
    return;
  }

  elements.importForm.classList.remove('hidden');
  await loadStores();
}

async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (session?.idToken) headers.Authorization = `Bearer ${session.idToken}`;
  const res = await fetch(endpoint, { ...options, headers });
  if (res.status === 401) {
    sessionStorage.removeItem(SESSION_KEY);
    elements.importForm.classList.add('hidden');
    elements.loginRequired.classList.remove('hidden');
    return { success: false, error: 'セッションが切れました' };
  }
  return res.json();
}

async function loadStores() {
  const result = await api('/api/stores');
  if (!result.success) {
    showAlert('error', result.error || '店舗を読み込めませんでした');
    return;
  }

  elements.storeSelect.innerHTML = result.stores
    .map(store => `<option value="${escapeHtml(store.code)}">${escapeHtml(store.name)}</option>`)
    .join('');

  const preferred = session.dashStoreCode || session.storeCode || '';
  if (preferred && result.stores.some(store => store.code === preferred)) {
    elements.storeSelect.value = preferred;
  }
}

async function handleFileSelect() {
  const file = elements.csvFileInput.files[0];
  csvText = '';
  csvFileName = '';
  elements.fileStatus.classList.add('hidden');
  elements.resultSection.classList.add('hidden');

  if (!file) return;

  try {
    csvText = decodeCsvBuffer(await file.arrayBuffer());
    csvFileName = file.name;
    elements.fileStatus.textContent = `${file.name} / ${csvText.length.toLocaleString()}文字`;
    elements.fileStatus.classList.remove('hidden');
  } catch (error) {
    showAlert('error', 'CSVを読み込めませんでした');
  }
}

function decodeCsvBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = new TextDecoder('utf-8').decode(bytes);
  const sample = text.slice(0, 3000);
  if (text.includes('\uFFFD') || !/(集計期間|売上|date|sales)/i.test(sample)) {
    try {
      text = new TextDecoder('shift_jis').decode(bytes);
    } catch (error) {
      // Keep UTF-8 text when the browser cannot decode Shift_JIS.
    }
  }
  return text.replace(/^\uFEFF/, '');
}

async function submitCsv(dryRun) {
  if (!elements.storeSelect.value) {
    showAlert('error', '店舗を選択してください');
    return;
  }
  if (!csvText) {
    showAlert('error', 'CSVファイルを選択してください');
    return;
  }

  setButtonsBusy(true);
  showAlert('info', dryRun ? '確認中...' : '取り込み中...');
  try {
    const result = await api('/api/airregi-sales/import-csv', {
      method: 'POST',
      body: JSON.stringify({
        storeCode: elements.storeSelect.value,
        csvText,
        sourceName: csvFileName || 'browser-upload.csv',
        date: elements.fixedDateInput.value,
        dryRun,
      }),
    });

    if (!result.success) {
      showAlert('error', result.error || '処理に失敗しました');
      return;
    }

    renderResult(result);
    showAlert('success', dryRun ? '確認しました' : '取り込みました');
  } catch (error) {
    showAlert('error', '通信エラーが発生しました');
  } finally {
    setButtonsBusy(false);
  }
}

function renderResult(result) {
  const warnings = result.warnings || [];
  const rows = result.rows || [];
  const warningHtml = warnings.length
    ? `<div class="airregi-warning">${warnings.map(w => escapeHtml(w.message)).join('<br>')}</div>`
    : '';
  const tableRows = rows.slice(0, 40).map(row => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td class="text-right">${formatYen(row.salesTotal)}</td>
      <td class="text-right">${formatYen(row.monthlySales)}</td>
    </tr>
  `).join('');
  const moreText = rows.length > 40 ? `<div class="airregi-more">ほか ${rows.length - 40} 行</div>` : '';

  elements.resultSummary.innerHTML = `
    <div class="airregi-summary-grid">
      <div><span>行数</span><strong>${Number(result.rowCount || 0).toLocaleString()}</strong></div>
      <div><span>期間</span><strong>${escapeHtml(result.dateFrom || '')} - ${escapeHtml(result.dateTo || '')}</strong></div>
      <div><span>月累計</span><strong>${formatYen(result.latestMonthlySales)}</strong></div>
    </div>
    ${warningHtml}
    <div class="airregi-table-wrap">
      <table class="airregi-table">
        <thead><tr><th>日付</th><th>売上</th><th>月累計</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${moreText}
  `;
  elements.resultSection.classList.remove('hidden');
}

function setButtonsBusy(isBusy) {
  elements.previewButton.disabled = isBusy;
  elements.importButton.disabled = isBusy;
}

function showAlert(type, message) {
  elements.importAlert.textContent = message;
  elements.importAlert.className = `alert alert-${type} ${message ? '' : 'hidden'}`;
}

function formatYen(value) {
  return `¥${Number(value || 0).toLocaleString()}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
