/**
 * クライアント側スクリプト
 * 朝礼・終礼シートシステム
 */

// APIベースURL
const API_BASE = '';

// =====================================================
// アプリケーション状態
// =====================================================

const AppState = {
  role: null,
  storeName: null,
  businessDate: null,
  casts: [],
  shureiCasts: [],
  showOtherCasts: true
};

// =====================================================
// 初期化
// =====================================================

document.addEventListener('DOMContentLoaded', function() {
  loadStores();
  setupEventListeners();
  loadBusinessDate();
});

function setupEventListeners() {
  document.getElementById('roleSelect').addEventListener('change', onRoleChange);
  document.getElementById('loginButton').addEventListener('click', onStart);

  document.getElementById('managerBackButton').addEventListener('click', onBack);
  document.getElementById('addCastButton').addEventListener('click', onAddCast);
  document.getElementById('saveChoreiButton').addEventListener('click', onSaveChorei);
  document.getElementById('saveShureiButton').addEventListener('click', onSaveShurei);
  document.getElementById('addIssueButton').addEventListener('click', onAddIssue);
  document.getElementById('saveSettingsButton').addEventListener('click', onSaveSettings);

  document.getElementById('castBackButton').addEventListener('click', onBack);
  document.getElementById('saveGoalButton').addEventListener('click', onSaveGoalInput);
  document.getElementById('loadPerformanceButton').addEventListener('click', onLoadPerformance);
  document.getElementById('pickupToggle').addEventListener('change', onPickupToggle);
  document.getElementById('savePickupButton').addEventListener('click', onSavePickupInfo);
  document.getElementById('loadHistoryButton').addEventListener('click', onLoadHistory);

  document.getElementById('adminBackButton').addEventListener('click', onBack);
  document.getElementById('loadSummaryButton').addEventListener('click', onLoadSummary);

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', onTabChange);
  });

  // 自己採点モーダル関連
  document.getElementById('closeModalButton').addEventListener('click', onCloseModal);
  document.getElementById('submitSelfEvaluationButton').addEventListener('click', onSubmitSelfEvaluation);
  document.querySelectorAll('.score-btn').forEach(btn => {
    btn.addEventListener('click', onScoreSelect);
  });

  // URLからモーダルを開く判定
  checkOpenModalFromURL();
}

// =====================================================
// APIヘルパー
// =====================================================

async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
}

// =====================================================
// ロール選択・開始
// =====================================================

function onRoleChange(e) {
  const role = e.target.value;
  const storeGroup = document.getElementById('storeGroup');

  if (role === 'manager' || role === 'cast') {
    storeGroup.style.display = 'block';
  } else {
    storeGroup.style.display = 'none';
  }
}

async function loadStores() {
  try {
    const result = await apiRequest('/api/stores');
    if (result.success) {
      const select = document.getElementById('storeSelect');
      select.innerHTML = '<option value="">選択してください</option>';
      result.stores.forEach(store => {
        const option = document.createElement('option');
        option.value = store.name;
        option.textContent = store.name;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Failed to load stores:', error);
  }
}

function onStart() {
  const role = document.getElementById('roleSelect').value;
  const storeName = document.getElementById('storeSelect').value;

  if (!role) {
    alert('ロールを選択してください');
    return;
  }

  if ((role === 'manager' || role === 'cast') && !storeName) {
    alert('店舗を選択してください');
    return;
  }

  AppState.role = role;
  AppState.storeName = storeName;

  showScreen(role);
}

function onBack() {
  showLoginScreen();
}

// =====================================================
// 画面切り替え
// =====================================================

async function showScreen(role) {
  hideAllScreens();
  await loadBusinessDate();

  if (role === 'manager') {
    document.getElementById('managerScreen').classList.remove('hidden');
    document.getElementById('managerStoreName').textContent = AppState.storeName;
    await loadChoreiData();
    await loadIssues('未対応');
    await loadSettings();
  } else if (role === 'cast') {
    document.getElementById('castScreen').classList.remove('hidden');
    document.getElementById('castStoreName').textContent = AppState.storeName;
  } else if (role === 'admin') {
    document.getElementById('adminScreen').classList.remove('hidden');
    await loadDashboard();
    await loadAdminIssues('未対応');
    await loadStoresForAdmin();
  }
}

function showLoginScreen() {
  hideAllScreens();
  document.getElementById('loginScreen').classList.remove('hidden');
}

function hideAllScreens() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('managerScreen').classList.add('hidden');
  document.getElementById('castScreen').classList.add('hidden');
  document.getElementById('adminScreen').classList.add('hidden');
}

function onTabChange(e) {
  const tab = e.currentTarget;
  const tabName = tab.dataset.tab;

  // 同じタブグループ内の全タブのactiveを解除
  const tabsContainer = tab.closest('.tabs');
  tabsContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');

  if (tabName) {
    // 同じ画面内のタブコンテンツからactiveを解除
    const screen = tabsContainer.closest('#managerScreen, #castScreen, #adminScreen');
    if (screen) {
      screen.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
    }

    // 対象のタブコンテンツをactiveに
    const targetContent = document.getElementById(tabName + 'Tab');
    if (targetContent) {
      targetContent.classList.add('active');
    }

    // タブ切り替え時のデータ読み込み
    if (tabName === 'shurei') {
      loadShureiData();
    } else if (tabName === 'choreiView') {
      loadChoreiView();
    } else if (tabName === 'shureiView') {
      loadShureiView();
    } else if (tabName === 'settings') {
      loadSettings();
    }
  } else if (tab.dataset.issueTab) {
    loadIssues(tab.dataset.issueTab);
  } else if (tab.dataset.adminIssueTab) {
    loadAdminIssues(tab.dataset.adminIssueTab);
  }
}

// =====================================================
// 営業日
// =====================================================

async function loadBusinessDate() {
  try {
    const result = await apiRequest('/api/business-date');
    if (result.success) {
      AppState.businessDate = result.date;
      if (document.getElementById('managerBusinessDate')) {
        document.getElementById('managerBusinessDate').textContent = result.date;
      }
      if (document.getElementById('castBusinessDate')) {
        document.getElementById('castBusinessDate').textContent = result.date;
      }
      if (document.getElementById('adminBusinessDate')) {
        document.getElementById('adminBusinessDate').textContent = result.date;
      }
    }
  } catch (error) {
    console.error('Failed to load business date:', error);
  }
}

// =====================================================
// 店責用：朝礼
// =====================================================

async function loadChoreiData() {
  try {
    const result = await apiRequest(`/api/chorei/${encodeURIComponent(AppState.storeName)}`);
    if (result.success) {
      AppState.casts = result.casts || [];
      renderCastList();
    }
  } catch (error) {
    console.error('Failed to load chorei data:', error);
  }
}

function renderCastList() {
  const container = document.getElementById('castList');
  container.innerHTML = '';

  if (AppState.casts.length === 0) {
    container.innerHTML = '<p class="text-center text-light">スタッフがいません。「+ 追加」ボタンで追加してください。</p>';
    return;
  }

  AppState.casts.forEach((cast, index) => {
    const row = document.createElement('div');
    row.className = 'cast-row';
    row.innerHTML = `
      <div class="cast-row-header">
        <span class="cast-row-title">スタッフ ${index + 1}</span>
        <button class="btn btn-sm btn-outline" onclick="window.removeCast && window.removeCast(${index})">削除</button>
      </div>
      <div class="row">
        <div class="col">
          <div class="form-group mb-10">
            <label class="required">名前</label>
            <input type="text" class="form-control cast-name" value="${cast.castName || ''}" data-index="${index}">
          </div>
        </div>
        <div class="col">
          <div class="form-group mb-10">
            <label>売上</label>
            <input type="number" class="form-control cast-current-sales" value="${cast.currentSales || 0}" data-index="${index}" placeholder="0">
          </div>
        </div>
        <div class="col">
          <div class="form-group mb-10">
            <label>ドリンク数</label>
            <input type="number" class="form-control cast-current-drinks" value="${cast.currentDrinks || 0}" data-index="${index}" placeholder="0">
          </div>
        </div>
      </div>
      <div class="form-group mb-10">
        <label>自分の目標</label>
        <div class="cast-goal-display" style="background: #f0f0f0; padding: 10px; border-radius: 4px; min-height: 40px;">
          ${cast.castGoalInput || cast.goalMemo || '<span class="text-light">まだ書いてない</span>'}
        </div>
      </div>
      <div class="form-group mb-0">
        <label>メモ</label>
        <textarea class="form-control cast-manager-memo" data-index="${index}" placeholder="メモを書いてね">${cast.managerMemo || ''}</textarea>
      </div>
    `;
    container.appendChild(row);
  });

  // グローバル関数として登録
  window.removeCast = removeCast;
}

function onAddCast() {
  AppState.casts.push({
    castName: '',
    currentSales: 0,
    currentDrinks: 0,
    managerMemo: '',
    // 既存データ用のフィールド（初期値）
    contractTime: '',
    pickup: false,
    pickupLocation: '',
    goalMemo: '',
    castGoalInput: ''
  });
  renderCastList();
}

function removeCast(index) {
  AppState.casts.splice(index, 1);
  renderCastList();
}

async function onSaveChorei() {
  const nameInputs = document.querySelectorAll('.cast-name');
  const currentSalesInputs = document.querySelectorAll('.cast-current-sales');
  const currentDrinksInputs = document.querySelectorAll('.cast-current-drinks');
  const managerMemoInputs = document.querySelectorAll('.cast-manager-memo');

  const casts = [];
  for (let i = 0; i < nameInputs.length; i++) {
    const castName = nameInputs[i].value.trim();
    if (!castName) {
      showAlert('choreiAlert', 'error', '名前を入力してください');
      return;
    }
    casts.push({
      castName: castName,
      currentSales: parseInt(currentSalesInputs[i].value) || 0,
      currentDrinks: parseInt(currentDrinksInputs[i].value) || 0,
      managerMemo: managerMemoInputs[i].value,
      // 既存データを保持
      contractTime: AppState.casts[i]?.contractTime || '',
      pickup: AppState.casts[i]?.pickup || false,
      pickupLocation: AppState.casts[i]?.pickupLocation || '',
      goalMemo: AppState.casts[i]?.goalMemo || '',
      castGoalInput: AppState.casts[i]?.castGoalInput || ''
    });
  }

  const data = {
    storeName: AppState.storeName,
    casts: casts,
    storeNews: '',
    personalNews: ''
  };

  try {
    const result = await apiRequest('/api/chorei', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    if (result.success) {
      showAlert('choreiAlert', 'success', '保存しました');
      await loadChoreiData();
    } else {
      showAlert('choreiAlert', 'error', result.error || '保存できませんでした');
    }
  } catch (error) {
    showAlert('choreiAlert', 'error', 'エラー: ' + error.message);
  }
}

// =====================================================
// 店責用：終礼
// =====================================================

async function loadShureiData() {
  try {
    const result = await apiRequest(`/api/shurei/${encodeURIComponent(AppState.storeName)}`);
    if (result.success) {
      document.getElementById('totalSalesInput').value = result.totalSales || '';
      if (result.casts && result.casts.length > 0) {
        AppState.shureiCasts = result.casts;
      } else {
        // 終礼データがなければ朝礼のキャスト一覧で初期化
        const choreiResult = await apiRequest(`/api/chorei/${encodeURIComponent(AppState.storeName)}`);
        if (choreiResult.success && choreiResult.casts && choreiResult.casts.length > 0) {
          AppState.shureiCasts = choreiResult.casts.map(cast => ({
            castName: cast.castName,
            drinkCount: 0,
            sales: 0,
            goalAchieved: false
          }));
        } else {
          AppState.shureiCasts = [];
        }
      }
      renderShureiCastList();
    }
  } catch (error) {
    console.error('Failed to load shurei data:', error);
  }
}

function renderShureiCastList() {
  const container = document.getElementById('shureiCastList');
  container.innerHTML = '';

  if (AppState.shureiCasts.length === 0) {
    container.innerHTML = '<p class="text-center text-light">スタッフがいません。先に朝礼を保存してください。</p>';
    return;
  }

  AppState.shureiCasts.forEach((cast, index) => {
    const row = document.createElement('div');
    row.className = 'cast-row';
    row.innerHTML = `
      <div class="cast-row-header">
        <span class="cast-row-title">${cast.castName}</span>
      </div>
      <div class="row">
        <div class="col">
          <div class="form-group mb-10">
            <label>ドリンク数</label>
            <input type="number" class="form-control shurei-drink" value="${cast.drinkCount || 0}" data-index="${index}">
          </div>
        </div>
        <div class="col">
          <div class="form-group mb-10">
            <label>売上</label>
            <input type="number" class="form-control shurei-sales" value="${cast.sales || 0}" data-index="${index}">
          </div>
        </div>
        <div class="col">
          <div class="form-group mb-10">
            <label>目標達成</label>
            <label class="toggle">
              <input type="checkbox" class="shurei-achieved" data-index="${index}" ${cast.goalAchieved ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>
    `;
    container.appendChild(row);
  });
}

async function onSaveShurei() {
  const drinkInputs = document.querySelectorAll('.shurei-drink');
  const salesInputs = document.querySelectorAll('.shurei-sales');
  const achievedInputs = document.querySelectorAll('.shurei-achieved');

  const casts = [];
  for (let i = 0; i < AppState.shureiCasts.length; i++) {
    casts.push({
      castName: AppState.shureiCasts[i].castName,
      drinkCount: parseInt(drinkInputs[i].value) || 0,
      sales: parseInt(salesInputs[i].value) || 0,
      goalAchieved: achievedInputs[i].checked
    });
  }

  const data = {
    storeName: AppState.storeName,
    casts: casts,
    totalSales: parseInt(document.getElementById('totalSalesInput').value) || 0
  };

  try {
    const result = await apiRequest('/api/shurei', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    if (result.success) {
      showAlert('shureiAlert', 'success', '保存しました');
    } else {
      showAlert('shureiAlert', 'error', result.error || '保存に失敗しました');
    }
  } catch (error) {
    showAlert('shureiAlert', 'error', 'エラーが発生しました: ' + error.message);
  }
}

// =====================================================
// 課題管理
// =====================================================

async function loadIssues(status) {
  try {
    const queryString = status ? `?status=${encodeURIComponent(status)}` : '';
    const result = await apiRequest(`/api/issues${queryString}`);
    if (result.success) {
      renderIssues(result.issues, 'issuesList');
    }
  } catch (error) {
    console.error('Failed to load issues:', error);
  }
}

function renderIssues(issues, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (issues.length === 0) {
    container.innerHTML = '<p class="text-center text-light">課題はありません</p>';
    return;
  }

  issues.forEach(issue => {
    const row = document.createElement('div');
    row.className = 'card mb-10 issue-card';

    let statusClass = 'badge-info';
    if (issue.status === '未対応') statusClass = 'badge-error';
    if (issue.status === '対応中') statusClass = 'badge-warning';
    if (issue.status === '完了') statusClass = 'badge-success';

    row.innerHTML = `
      <div class="row" style="align-items: flex-start;">
        <div class="col">
          <div class="mb-10">
            <span class="badge ${statusClass}">${issue.status}</span>
            <span style="margin-left: 10px; font-size: 0.875rem; color: #666;">${issue.date}</span>
          </div>
          <div style="font-weight: 500;">${issue.store_name} / ${issue.reporter}</div>
        </div>
        <div class="col">
          <div>${issue.content}</div>
          ${issue.feedback ? `<div style="margin-top: 8px; padding: 8px; background: #E8F5E9; border-radius: 4px; font-size: 0.875rem;">FB: ${issue.feedback}</div>` : ''}
        </div>
      </div>
    `;
    container.appendChild(row);
  });
}

async function onAddIssue() {
  const content = document.getElementById('issueContentInput').value.trim();
  const reporter = document.getElementById('issueReporterInput').value.trim();

  if (!content) {
    showAlert('shureiAlert', 'error', '内容を入力してください');
    return;
  }

  if (!reporter) {
    showAlert('shureiAlert', 'error', '起票者を入力してください');
    return;
  }

  try {
    const result = await apiRequest('/api/issues', {
      method: 'POST',
      body: JSON.stringify({
        storeName: AppState.storeName,
        reporter,
        content
      })
    });

    if (result.success) {
      showAlert('shureiAlert', 'success', '課題を追加しました');
      document.getElementById('issueContentInput').value = '';
      document.getElementById('issueReporterInput').value = '';
      await loadIssues('未対応');
    } else {
      showAlert('shureiAlert', 'error', result.error || '追加に失敗しました');
    }
  } catch (error) {
    showAlert('shureiAlert', 'error', 'エラーが発生しました: ' + error.message);
  }
}

// =====================================================
// キャスト用：目標入力
// =====================================================

async function onSaveGoal() {
  const castName = document.getElementById('castNameInput').value.trim();
  const goal = document.getElementById('goalInput').value.trim();

  if (!castName) {
    showAlert('goalAlert', 'error', '名前を入力してください');
    return;
  }

  if (!goal) {
    showAlert('goalAlert', 'error', '目標を入力してください');
    return;
  }

  try {
    const result = await apiRequest('/api/cast-goal', {
      method: 'POST',
      body: JSON.stringify({
        storeName: AppState.storeName,
        castName,
        goal
      })
    });

    if (result.success) {
      showAlert('goalAlert', 'success', '目標を保存しました');
    } else {
      showAlert('goalAlert', 'error', result.error || '保存に失敗しました');
    }
  } catch (error) {
    showAlert('goalAlert', 'error', 'エラーが発生しました: ' + error.message);
  }
}

// =====================================================
// キャスト用：朝礼閲覧
// =====================================================

async function loadChoreiView() {
  const container = document.getElementById('choreiViewContent');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const result = await apiRequest(`/api/chorei/${encodeURIComponent(AppState.storeName)}`);

    if (result.success) {
      renderChoreiView(result);
    } else {
      container.innerHTML = '<div class="alert alert-error">' + (result.error || '読み込みに失敗しました') + '</div>';
    }
  } catch (error) {
    container.innerHTML = '<div class="alert alert-error">エラーが発生しました: ' + error.message + '</div>';
  }
}

function renderChoreiView(result) {
  const container = document.getElementById('choreiViewContent');

  let html = '<div class="card"><div class="card-title">スタッフ一覧</div>';
  html += '<div class="table-wrapper">';
  html += '<table class="table">';
  html += '<thead><tr><th>名前</th><th>売上</th><th>ドリンク数</th><th>目標</th></tr></thead>';
  html += '<tbody>';

  if (result.casts && result.casts.length > 0) {
    result.casts.forEach(cast => {
      html += `
        <tr>
          <td>${cast.castName}</td>
          <td>¥${(cast.currentSales || 0).toLocaleString()}</td>
          <td>${cast.currentDrinks || 0}杯</td>
          <td>${cast.castGoalInput || cast.goalMemo || cast.managerMemo || '-'}</td>
        </tr>
      `;
    });
  } else {
    html += '<tr><td colspan="4" class="text-center text-light">データがありません</td></tr>';
  }

  html += '</tbody></table></div></div>';
  container.innerHTML = html;
}

// =====================================================
// キャスト用：終礼閲覧
// =====================================================

async function loadShureiView() {
  const container = document.getElementById('shureiViewContent');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const result = await apiRequest(`/api/shurei/${encodeURIComponent(AppState.storeName)}`);

    if (result.success) {
      renderShureiView(result);
    } else {
      container.innerHTML = '<div class="alert alert-error">' + (result.error || '読み込みに失敗しました') + '</div>';
    }
  } catch (error) {
    container.innerHTML = '<div class="alert alert-error">エラーが発生しました: ' + error.message + '</div>';
  }
}

function renderShureiView(result) {
  const container = document.getElementById('shureiViewContent');

  let html = '<div class="card mb-10"><div class="card-title">今日の売上合計</div><div class="info-value">¥' + (result.totalSales || 0).toLocaleString() + '</div></div>';

  html += '<div class="card"><div class="card-title">スタッフの結果</div>';
  html += '<div class="table-wrapper">';
  html += '<table class="table">';
  html += '<thead><tr><th>名前</th><th>ドリンク数</th><th>売上</th><th>目標</th></tr></thead>';
  html += '<tbody>';

  if (result.casts && result.casts.length > 0) {
    result.casts.forEach(cast => {
      html += `
        <tr>
          <td>${cast.castName}</td>
          <td>${cast.drinkCount || 0}杯</td>
          <td>¥${(cast.sales || 0).toLocaleString()}</td>
          <td><span class="badge ${cast.goalAchieved ? 'badge-success' : 'badge-error'}">${cast.goalAchieved ? '達成' : '未達成'}</span></td>
        </tr>
      `;
    });
  } else {
    html += '<tr><td colspan="4" class="text-center text-light">データがありません</td></tr>';
  }

  html += '</tbody></table></div></div>';
  container.innerHTML = html;
}

// =====================================================
// キャスト用：実績閲覧
// =====================================================

async function onLoadPerformance() {
  const castName = document.getElementById('performanceCastNameInput').value.trim();

  if (!castName) {
    showAlert('performanceAlert', 'error', '名前を入力してください');
    return;
  }

  document.getElementById('performanceLoading').classList.remove('hidden');
  document.getElementById('performanceResult').innerHTML = '';

  try {
    const result = await apiRequest(`/api/cast-performance/${encodeURIComponent(AppState.storeName)}/${encodeURIComponent(castName)}`);

    document.getElementById('performanceLoading').classList.add('hidden');
    if (result.success) {
      renderPerformance(result);
    } else {
      showAlert('performanceAlert', 'error', result.error || 'データを取得できませんでした');
    }
  } catch (error) {
    document.getElementById('performanceLoading').classList.add('hidden');
    showAlert('performanceAlert', 'error', 'エラー: ' + error.message);
  }
}

function renderPerformance(result) {
  const container = document.getElementById('performanceResult');

  if (!result.today) {
    container.innerHTML = '<div class="alert alert-info">今日のデータがまだありません</div>';
    return;
  }

  container.innerHTML = `
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">今日の売上</div>
        <div class="info-value">¥${result.today.sales.toLocaleString()}</div>
      </div>
      <div class="info-item">
        <div class="info-label">今日のドリンク数</div>
        <div class="info-value">${result.today.drinkCount}杯</div>
      </div>
      <div class="info-item">
        <div class="info-label">目標達成</div>
        <div class="info-value">
          <span class="badge ${result.today.goalAchieved ? 'badge-success' : 'badge-error'}">
            ${result.today.goalAchieved ? '達成' : '未達成'}
          </span>
        </div>
      </div>
    </div>

    <h3 class="mt-20 mb-10">今月の合計</h3>
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">売上合計</div>
        <div class="info-value">¥${result.monthly.totalSales.toLocaleString()}</div>
      </div>
      <div class="info-item">
        <div class="info-label">ドリンク合計</div>
        <div class="info-value">${result.monthly.totalDrinks}杯</div>
      </div>
    </div>
  `;
}

// =====================================================
// 管理者用：ダッシュボード
// =====================================================

async function loadDashboard() {
  document.getElementById('dashboardLoading').classList.remove('hidden');
  document.getElementById('dashboardContent').innerHTML = '';

  try {
    const result = await apiRequest('/api/dashboard/all-stores');

    document.getElementById('dashboardLoading').classList.add('hidden');
    if (result.success) {
      renderDashboard(result.data);
    }
  } catch (error) {
    console.error('Failed to load dashboard:', error);
  }
}

function renderDashboard(data) {
  const container = document.getElementById('dashboardContent');

  let html = '<div class="table-wrapper">';
  html += '<table class="table">';
  html += '<thead><tr><th>お店</th><th>スタッフ数</th><th>売上合計</th></tr></thead>';
  html += '<tbody>';

  data.forEach(store => {
    html += `
      <tr>
        <td>${store.storeName}</td>
        <td>${store.castCount}人</td>
        <td>¥${store.totalSales.toLocaleString()}</td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function loadAdminIssues(status) {
  try {
    const queryString = status ? `?status=${encodeURIComponent(status)}` : '';
    const result = await apiRequest(`/api/issues${queryString}`);
    if (result.success) {
      renderAdminIssues(result.issues);
    }
  } catch (error) {
    console.error('Failed to load admin issues:', error);
  }
}

function renderAdminIssues(issues) {
  renderIssues(issues, 'adminIssuesList');
}

async function loadStoresForAdmin() {
  try {
    const result = await apiRequest('/api/stores');
    if (result.success) {
      const select = document.getElementById('summaryStoreSelect');
      select.innerHTML = '<option value="">全店舗</option>';
      result.stores.forEach(store => {
        const option = document.createElement('option');
        option.value = store.name;
        option.textContent = store.name;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Failed to load stores:', error);
  }
}

async function onLoadSummary() {
  const storeName = document.getElementById('summaryStoreSelect').value;

  document.getElementById('summaryResult').innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const queryString = storeName ? `?storeName=${encodeURIComponent(storeName)}` : '';
    const result = await apiRequest(`/api/dashboard/summary${queryString}`);

    if (result.success) {
      renderSummary(result.summary);
    }
  } catch (error) {
    console.error('Failed to load summary:', error);
  }
}

function renderSummary(summary) {
  const container = document.getElementById('summaryResult');

  container.innerHTML = `
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">月</div>
        <div class="info-value" style="font-size: 1.25rem;">${summary.month}</div>
      </div>
      <div class="info-item">
        <div class="info-label">売上合計</div>
        <div class="info-value">¥${summary.totalSales.toLocaleString()}</div>
      </div>
      <div class="info-item">
        <div class="info-label">ドリンク合計</div>
        <div class="info-value">${summary.totalDrinks}杯</div>
      </div>
      <div class="info-item">
        <div class="info-label">目標達成率</div>
        <div class="info-value">${summary.achievementRate}%</div>
      </div>
      <div class="info-item">
        <div class="info-label">達成した数</div>
        <div class="info-value" style="font-size: 1.25rem;">${summary.achievedCount} / ${summary.totalCount}</div>
      </div>
    </div>
  `;
}

// =====================================================
// ユーティリティ
// =====================================================

function showAlert(elementId, type, message) {
  const alert = document.getElementById(elementId);
  alert.className = 'alert alert-' + type;
  alert.textContent = message;
  alert.classList.remove('hidden');

  setTimeout(() => {
    alert.classList.add('hidden');
  }, 5000);
}

// =====================================================
// キャスト用：目標入力（更新版）
// =====================================================

async function onSaveGoalInput() {
  const castName = document.getElementById('castNameInput').value.trim();
  const goal = document.getElementById('goalInput').value.trim();

  if (!castName) {
    showAlert('goalAlert', 'error', '名前を入力してください');
    return;
  }

  if (!goal) {
    showAlert('goalAlert', 'error', '目標を書いてください');
    return;
  }

  try {
    const result = await apiRequest('/api/cast-goal-input', {
      method: 'POST',
      body: JSON.stringify({
        storeName: AppState.storeName,
        castName,
        goal
      })
    });

    if (result.success) {
      showAlert('goalAlert', 'success', '保存しました！');
    } else {
      showAlert('goalAlert', 'error', result.error || '保存できませんでした');
    }
  } catch (error) {
    showAlert('goalAlert', 'error', 'エラー: ' + error.message);
  }
}

// =====================================================
// キャスト用：送迎情報入力
// =====================================================

function onPickupToggle(e) {
  const pickupLocationGroup = document.getElementById('pickupLocationGroup');
  pickupLocationGroup.style.display = e.target.checked ? 'block' : 'none';
}

async function onSavePickupInfo() {
  const castName = document.getElementById('castNameInput').value.trim();
  const pickup = document.getElementById('pickupToggle').checked;
  const pickupLocation = document.getElementById('pickupLocationInput').value.trim();

  if (!castName) {
    showAlert('pickupAlert', 'error', '名前を入力してください');
    return;
  }

  if (pickup && !pickupLocation) {
    showAlert('pickupAlert', 'error', '送ってほしい場所を書いてください');
    return;
  }

  try {
    const result = await apiRequest('/api/pickup-info', {
      method: 'POST',
      body: JSON.stringify({
        storeName: AppState.storeName,
        castName,
        pickup,
        pickupLocation
      })
    });

    if (result.success) {
      showAlert('pickupAlert', 'success', '保存しました！');
    } else {
      showAlert('pickupAlert', 'error', result.error || '保存できませんでした');
    }
  } catch (error) {
    showAlert('pickupAlert', 'error', 'エラー: ' + error.message);
  }
}

// =====================================================
// 時系列実績
// =====================================================

async function onLoadHistory() {
  const castName = document.getElementById('historyCastNameInput').value.trim();
  const limit = document.getElementById('historyLimitSelect').value;

  if (!castName) {
    document.getElementById('historyResult').innerHTML = '<div class="alert alert-error">名前を入力してください</div>';
    return;
  }

  document.getElementById('historyLoading').classList.remove('hidden');
  document.getElementById('historyResult').innerHTML = '';

  try {
    const result = await apiRequest(`/api/cast-history/${encodeURIComponent(AppState.storeName)}/${encodeURIComponent(castName)}?limit=${limit}`);

    document.getElementById('historyLoading').classList.add('hidden');
    if (result.success) {
      renderHistory(result.history);
    } else {
      document.getElementById('historyResult').innerHTML =
        '<div class="alert alert-error">' + (result.error || 'データを取得できませんでした') + '</div>';
    }
  } catch (error) {
    document.getElementById('historyLoading').classList.add('hidden');
    document.getElementById('historyResult').innerHTML =
      '<div class="alert alert-error">エラー: ' + error.message + '</div>';
  }
}

function renderHistory(history) {
  const container = document.getElementById('historyResult');

  if (history.length === 0) {
    container.innerHTML = '<div class="alert alert-info">まだデータがありません</div>';
    return;
  }

  let html = '<div class="card"><div class="table-wrapper">';
  html += '<table class="table">';
  html += '<thead><tr><th>日付</th><th>売上</th><th>ドリンク数</th><th>目標</th></tr></thead>';
  html += '<tbody>';

  history.forEach(item => {
    html += `
      <tr>
        <td>${item.date}</td>
        <td>¥${(item.sales || 0).toLocaleString()}</td>
        <td>${item.drinkCount || 0}杯</td>
        <td><span class="badge ${item.goalAchieved ? 'badge-success' : 'badge-error'}">${item.goalAchieved ? '達成' : '未達成'}</span></td>
      </tr>
    `;
  });

  html += '</tbody></table></div></div>';
  container.innerHTML = html;
}

// =====================================================
// 表示設定
// =====================================================

async function loadSettings() {
  try {
    const result = await apiRequest(`/api/settings/${encodeURIComponent(AppState.storeName)}`);
    if (result.success) {
      AppState.showOtherCasts = result.showOtherCasts;
      document.getElementById('showOtherCastsToggle').checked = result.showOtherCasts;
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

async function onSaveSettings() {
  const showOtherCasts = document.getElementById('showOtherCastsToggle').checked;

  try {
    const result = await apiRequest(`/api/settings/${encodeURIComponent(AppState.storeName)}`, {
      method: 'PUT',
      body: JSON.stringify({ showOtherCasts })
    });

    if (result.success) {
      showAlert('settingsAlert', 'success', '保存しました');
      AppState.showOtherCasts = showOtherCasts;
    } else {
      showAlert('settingsAlert', 'error', result.error || '保存できませんでした');
    }
  } catch (error) {
    showAlert('settingsAlert', 'error', 'エラー: ' + error.message);
  }
}

// =====================================================
// 自己採点モーダル
// =====================================================

function checkOpenModalFromURL() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('modal') === 'self-evaluation') {
    openSelfEvaluationModal(params.get('store') || '');
  }
}

function openSelfEvaluationModal(storeName) {
  document.getElementById('selfEvaluationModal').classList.remove('hidden');
  if (storeName) {
    // 店舗名が指定されている場合は、店舗名を記憶
    AppState.storeName = storeName;
  }
}

function onCloseModal() {
  document.getElementById('selfEvaluationModal').classList.add('hidden');
  // URLからパラメータを削除
  const url = new URL(window.location.href);
  url.searchParams.delete('modal');
  url.searchParams.delete('store');
  window.history.replaceState({}, '', url.toString());
}

function onScoreSelect(e) {
  document.querySelectorAll('.score-btn').forEach(btn => btn.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById('selfScoreInput').value = e.target.dataset.score;
}

async function onSubmitSelfEvaluation() {
  const castName = document.getElementById('modalCastNameInput').value.trim();
  const selfScore = parseInt(document.getElementById('selfScoreInput').value);
  const reason = document.getElementById('reasonInput').value.trim();

  if (!castName) {
    showAlert('modalAlert', 'error', '名前を入力してください');
    return;
  }

  if (!selfScore) {
    showAlert('modalAlert', 'error', '採点を選んでください');
    return;
  }

  try {
    const result = await apiRequest('/api/early-leave', {
      method: 'POST',
      body: JSON.stringify({
        storeName: AppState.storeName,
        castName,
        selfScore,
        reason
      })
    });

    if (result.success) {
      showAlert('modalAlert', 'success', '送信しました！');
      setTimeout(() => {
        onCloseModal();
      }, 1500);
    } else {
      showAlert('modalAlert', 'error', result.error || '送信できませんでした');
    }
  } catch (error) {
    showAlert('modalAlert', 'error', 'エラー: ' + error.message);
  }
}
