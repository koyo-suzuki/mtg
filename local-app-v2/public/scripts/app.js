// =====================================================
// アプリケーション状態
// =====================================================

const State = {
  gmail: null,
  displayName: null,
  role: null,       // 'cast_manager', 'cast', 'admin'
  isManager: false, // 店責権限
  storeId: null,
  storeName: null,
  businessDate: null,
  castMaster: [],
  choreiCasts: [],
  selectedScore: null,
  managerSelectedScore: null,
  issueFilter: 'all'
};

// =====================================================
// 初期化
// =====================================================

document.addEventListener('DOMContentLoaded', () => {
  loadAccounts();
  setupEvents();
});

function setupEvents() {
  document.getElementById('castStoreBack').addEventListener('click', showLogin);
  document.getElementById('managerBack').addEventListener('click', showLogin);
  document.getElementById('saveChoreiBtn').addEventListener('click', onSaveChorei);

  // キャスト検索
  document.getElementById('castSearchInput').addEventListener('input', onCastSearch);
  document.getElementById('castSearchInput').addEventListener('focus', onCastSearch);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cast-search-wrapper')) {
      document.getElementById('castSearchResults').classList.add('hidden');
    }
  });

  // 終礼
  document.getElementById('saveShureiBtn').addEventListener('click', onSaveShurei);

  // 店責伝言板
  document.getElementById('postManagerIssue').addEventListener('click', () => onPostIssue('manager'));
  document.querySelectorAll('.issue-filter').forEach(btn => {
    btn.addEventListener('click', onIssueFilterClick);
  });

  // キャスト画面
  document.getElementById('castBack').addEventListener('click', showLogin);
  document.getElementById('saveCastGoal').addEventListener('click', onSaveCastGoal);

  // キャスト振り返り
  document.getElementById('saveEvalBtn').addEventListener('click', onSaveEval);
  document.querySelectorAll('.score-btn').forEach(btn => {
    btn.addEventListener('click', onScoreSelect);
  });

  // 店責振り返り
  document.getElementById('saveManagerEvalBtn').addEventListener('click', onSaveManagerEval);
  document.querySelectorAll('.manager-score-btn').forEach(btn => {
    btn.addEventListener('click', onManagerScoreSelect);
  });

  // 専任画面
  document.getElementById('adminBack').addEventListener('click', showLogin);
  document.getElementById('adminStoreSelect').addEventListener('change', onAdminStoreSelect);

  // タブ
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', onTabChange);
  });
}

// =====================================================
// API
// =====================================================

async function api(endpoint, options = {}) {
  const res = await fetch(endpoint, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  return res.json();
}

// =====================================================
// ログイン画面
// =====================================================

async function loadAccounts() {
  const result = await api('/api/accounts');
  if (!result.success) return;

  const container = document.getElementById('accountList');
  container.innerHTML = '';

  // グループ分け
  const managers = result.accounts.filter(a => a.role === 'cast_manager');
  const casts = result.accounts.filter(a => a.role === 'cast');
  const admins = result.accounts.filter(a => a.role === 'admin');

  function renderGroup(label, accounts, avatarClass, badgeClass) {
    if (accounts.length === 0) return;
    const groupLabel = document.createElement('div');
    groupLabel.className = 'account-group-label';
    groupLabel.textContent = label;
    container.appendChild(groupLabel);

    accounts.forEach(account => {
      const el = document.createElement('div');
      el.className = 'account-item';

      const initial = account.displayName.charAt(0);

      el.innerHTML = `
        <div class="account-avatar ${avatarClass}">${initial}</div>
        <div class="account-info">
          <div class="account-name">${account.displayName}</div>
          <div class="account-detail">${account.gmail}</div>
        </div>
        <span class="role-badge ${badgeClass}">${account.type}</span>
      `;

      el.addEventListener('click', () => onLogin(account.gmail));
      container.appendChild(el);
    });
  }

  renderGroup('店責権限あり', managers, 'avatar-manager', 'role-manager');
  renderGroup('キャスト', casts, 'avatar-cast', 'role-cast');
  renderGroup('専任', admins, 'avatar-admin', 'role-admin');
}

async function onLogin(gmail) {
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ gmail })
  });

  if (!result.success) {
    alert(result.error);
    return;
  }

  State.gmail = result.gmail;
  State.displayName = result.displayName;
  State.role = result.role;
  State.isManager = result.isManager;

  const dateResult = await api('/api/business-date');
  State.businessDate = dateResult.date;

  if (result.role === 'admin') {
    // 専任 → 店舗選択してから店責画面（自分はキャスト一覧に入らない）
    await showAdminScreen();
  } else {
    // cast_manager or cast → まず店舗選択
    await showStoreSelection();
  }
}

// =====================================================
// 画面切り替え
// =====================================================

function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
}

function showLogin() {
  hideAllScreens();
  document.getElementById('loginScreen').classList.remove('hidden');
  State.gmail = null;
  State.displayName = null;
  State.role = null;
  State.isManager = false;
  State.storeId = null;
  State.storeName = null;
}

// =====================================================
// 店舗選択（キャスト・店責共通）
// =====================================================

async function showStoreSelection() {
  hideAllScreens();
  document.getElementById('castStoreScreen').classList.remove('hidden');

  const greeting = State.isManager
    ? `${State.displayName} さん（店責）`
    : `${State.displayName} さん、こんにちは`;
  document.getElementById('castStoreGreeting').textContent = greeting;

  // 全店舗一覧
  const result = await api('/api/stores');
  const container = document.getElementById('castStoreList');
  container.innerHTML = '';

  if (!result.success) return;

  result.stores.forEach(store => {
    const el = document.createElement('div');
    el.className = 'store-item';
    el.innerHTML = `
      <span class="store-item-name">${store.name}</span>
      <span class="store-item-arrow">→</span>
    `;
    el.addEventListener('click', async () => {
      State.storeId = store.id;
      State.storeName = store.name;

      if (State.isManager) {
        await showManagerScreen();
      } else {
        await showCastScreen();
      }
    });
    container.appendChild(el);
  });
}

// =====================================================
// 店責画面
// =====================================================

async function showManagerScreen() {
  hideAllScreens();
  document.getElementById('managerScreen').classList.remove('hidden');
  document.getElementById('managerStoreName').textContent = State.storeName;
  document.getElementById('managerDate').textContent = State.businessDate;

  await loadCastMaster();
  await loadChoreiData();

  // 店責（cast_manager）は自分を自動追加
  if (State.role === 'cast_manager') {
    autoAddSelf();
  }
}

async function loadCastMaster() {
  const result = await api('/api/cast-master');
  if (result.success) {
    State.castMaster = result.casts;
  }
}

function autoAddSelf() {
  // すでに追加済みならスキップ
  if (State.choreiCasts.find(c => c.gmail === State.gmail)) return;

  const master = State.castMaster.find(c => c.gmail === State.gmail);
  if (!master) return;

  State.choreiCasts.unshift({
    castName: master.cast_name,
    gmail: master.gmail,
    monthlySales: 0,
    monthlyDrinks: 0,
    expectedVisitors: 0,
    castGoal: '',
    managerMemo: '',
    isSelf: true
  });

  renderChoreiCastList();
}

// ---- キャスト検索 ----

function onCastSearch() {
  const query = document.getElementById('castSearchInput').value.trim().toLowerCase();
  const container = document.getElementById('castSearchResults');

  if (query === '') {
    container.classList.add('hidden');
    return;
  }

  const addedGmails = State.choreiCasts.map(c => c.gmail);

  const matches = State.castMaster
    .filter(c => c.cast_name.toLowerCase().includes(query))
    .slice(0, 20);

  if (matches.length === 0) {
    container.innerHTML = '<div class="cast-search-empty">見つかりません</div>';
    container.classList.remove('hidden');
    return;
  }

  container.innerHTML = '';
  matches.forEach(cast => {
    const isAdded = addedGmails.includes(cast.gmail);
    const el = document.createElement('div');
    el.className = 'cast-search-item' + (isAdded ? ' already-added' : '');
    el.innerHTML = `<span class="cast-search-name">${escapeHtml(cast.cast_name)}</span>`;

    if (!isAdded) {
      el.addEventListener('click', () => {
        addCastToChorei(cast);
        document.getElementById('castSearchInput').value = '';
        container.classList.add('hidden');
      });
    }

    container.appendChild(el);
  });

  container.classList.remove('hidden');
}

function addCastToChorei(masterCast) {
  if (State.choreiCasts.find(c => c.gmail === masterCast.gmail)) return;

  State.choreiCasts.push({
    castName: masterCast.cast_name,
    gmail: masterCast.gmail,
    monthlySales: 0,
    monthlyDrinks: 0,
    expectedVisitors: 0,
    castGoal: '',
    managerMemo: ''
  });

  renderChoreiCastList();
}

// ---- 朝礼データ ----

async function loadChoreiData() {
  const result = await api(`/api/chorei/${State.storeId}`);
  if (result.success) {
    State.choreiCasts = result.casts;
    renderChoreiCastList();
  }
}

function renderChoreiCastList() {
  const container = document.getElementById('choreiCastList');
  container.innerHTML = '';

  if (State.choreiCasts.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding:20px">キャストを追加してください</p>';
    return;
  }

  State.choreiCasts.forEach((cast, i) => {
    const isSelf = cast.gmail === State.gmail;
    const goalHtml = cast.castGoal
      ? `<div class="cast-goal-display goal-scroll">${escapeHtml(cast.castGoal)}</div>`
      : `<div class="cast-goal-display empty">まだ書いてない</div>`;

    const selfBadge = isSelf ? '<span class="badge badge-self">自分</span>' : '';

    const row = document.createElement('div');
    row.className = 'cast-row' + (isSelf ? ' cast-row-self' : '');
    row.innerHTML = `
      <div class="cast-row-header">
        <div>
          <span class="cast-row-name">${escapeHtml(cast.castName)}</span>
          ${selfBadge}
        </div>
        <button class="btn btn-outline btn-sm" data-remove="${i}">外す</button>
      </div>
      <div class="row">
        <div class="col">
          <div class="form-group">
            <label>売上</label>
            <input type="number" class="form-control chorei-monthly-sales" data-index="${i}" value="${cast.monthlySales || 0}">
          </div>
        </div>
        <div class="col">
          <div class="form-group">
            <label>ドリンク</label>
            <input type="number" class="form-control chorei-monthly-drinks" data-index="${i}" value="${cast.monthlyDrinks || 0}">
          </div>
        </div>
        <div class="col">
          <div class="form-group">
            <label>来店予定</label>
            <div class="cast-visitors-display">${cast.expectedVisitors || 0}組</div>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>キャスト目標</label>
        ${goalHtml}
      </div>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.remove);
      State.choreiCasts.splice(idx, 1);
      renderChoreiCastList();
    });
  });
}

async function onSaveChorei() {
  const salesInputs = document.querySelectorAll('.chorei-monthly-sales');
  const drinksInputs = document.querySelectorAll('.chorei-monthly-drinks');

  const casts = State.choreiCasts.map((cast, i) => ({
    castName: cast.castName,
    gmail: cast.gmail,
    monthlySales: parseInt(salesInputs[i]?.value) || 0,
    monthlyDrinks: parseInt(drinksInputs[i]?.value) || 0,
    expectedVisitors: cast.expectedVisitors || 0,
    managerMemo: ''
  }));

  const result = await api('/api/chorei', {
    method: 'POST',
    body: JSON.stringify({ storeId: State.storeId, casts })
  });

  const alertEl = document.getElementById('choreiAlert');
  if (result.success) {
    alertEl.className = 'alert alert-success';
    alertEl.textContent = '保存しました';
    await loadChoreiData();
    // 自動追加の再チェック
    if (State.role === 'cast_manager') autoAddSelf();
  } else {
    alertEl.className = 'alert alert-error';
    alertEl.textContent = result.error || '保存できませんでした';
  }
  alertEl.classList.remove('hidden');
  setTimeout(() => alertEl.classList.add('hidden'), 3000);
}

// =====================================================
// キャスト画面
// =====================================================

async function showCastScreen() {
  hideAllScreens();
  document.getElementById('castScreen').classList.remove('hidden');
  document.getElementById('castScreenName').textContent = State.displayName || State.gmail;
  document.getElementById('castScreenStore').textContent = State.storeName;
  document.getElementById('castDate').textContent = State.businessDate;

  await loadCastData();
}

async function loadCastData() {
  const result = await api(`/api/chorei/${State.storeId}`);
  if (!result.success) return;

  const myData = result.casts.find(c => c.gmail === State.gmail);
  if (myData) {
    document.getElementById('castGoalInput').value = myData.castGoal || '';
    document.getElementById('castVisitorsInput').value = myData.expectedVisitors || 0;
  }

  const castGoalAlert = document.getElementById('castGoalAlert');
  if (!myData) {
    castGoalAlert.className = 'alert alert-info';
    castGoalAlert.textContent = 'この店舗の朝礼にまだ追加されていません。店責に確認してね。';
    castGoalAlert.classList.remove('hidden');
    document.getElementById('saveCastGoal').disabled = true;
  } else {
    castGoalAlert.classList.add('hidden');
    document.getElementById('saveCastGoal').disabled = false;
  }

  renderCastChoreiView(result.casts);
}

function renderCastChoreiView(casts) {
  const container = document.getElementById('castChoreiViewContent');

  if (casts.length === 0) {
    container.innerHTML = '<p class="text-muted">まだデータがありません</p>';
    return;
  }

  let html = '<div class="table-wrapper"><table class="table"><thead><tr>';
  html += '<th>名前</th><th>売上</th><th>ドリンク</th><th>来店予定</th><th>目標</th>';
  html += '</tr></thead><tbody>';

  casts.forEach(cast => {
    const isSelf = cast.gmail === State.gmail;
    const nameStyle = isSelf ? 'font-weight:700; color:#9C27B0;' : '';
    html += `<tr>
      <td style="${nameStyle}">${escapeHtml(cast.castName)}${isSelf ? '（自分）' : ''}</td>
      <td>¥${(cast.monthlySales || 0).toLocaleString()}</td>
      <td>${cast.monthlyDrinks || 0}杯</td>
      <td>${cast.expectedVisitors || 0}組</td>
      <td><div class="goal-scroll">${cast.castGoal ? escapeHtml(cast.castGoal) : '<span class="text-muted">-</span>'}</div></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function onSaveCastGoal() {
  const goal = document.getElementById('castGoalInput').value.trim();
  const expectedVisitors = parseInt(document.getElementById('castVisitorsInput').value) || 0;
  const result = await api('/api/cast-goal', {
    method: 'POST',
    body: JSON.stringify({ storeId: State.storeId, gmail: State.gmail, goal, expectedVisitors })
  });

  showAlert('castGoalAlert', result.success ? 'success' : 'error',
    result.success ? '保存しました' : (result.error || '保存できませんでした'));

  if (result.success) {
    await loadCastData();
  }
}

// =====================================================
// 専任画面（店責代行）
// =====================================================

async function showAdminScreen() {
  hideAllScreens();
  document.getElementById('adminScreen').classList.remove('hidden');
  document.getElementById('adminName').textContent = State.displayName;

  // 店舗プルダウン読み込み
  const result = await api('/api/stores');
  if (!result.success) return;

  const select = document.getElementById('adminStoreSelect');
  select.innerHTML = '<option value="">店舗を選択...</option>';
  result.stores.forEach(store => {
    const opt = document.createElement('option');
    opt.value = store.id;
    opt.textContent = store.name;
    select.appendChild(opt);
  });
}

async function onAdminStoreSelect() {
  const select = document.getElementById('adminStoreSelect');
  const storeId = parseInt(select.value);
  if (!storeId) return;

  State.storeId = storeId;
  State.storeName = select.options[select.selectedIndex].textContent;

  // 店責画面に遷移（ただし自分はキャスト一覧に入らない）
  await showManagerScreen();
}

// =====================================================
// タブ切り替え
// =====================================================

function onTabChange(e) {
  const tab = e.currentTarget;
  const tabName = tab.dataset.tab;
  if (!tabName) return;

  const tabsContainer = tab.closest('.tabs');
  tabsContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');

  const screen = tabsContainer.closest('.screen');
  screen.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const target = document.getElementById(tabName + 'Tab');
  if (target) target.classList.add('active');

  // タブ切り替え時のデータ読み込み
  if (tabName === 'castChoreiView') loadCastData();
  if (tabName === 'shurei') { loadShureiData(); loadManagerEvalData(); loadManagerOwnEval(); }
  if (tabName === 'managerIssues') loadIssues('manager');
  if (tabName === 'castShureiView') loadCastShureiView();
  if (tabName === 'castEval') loadCastEvalData();
  if (tabName === 'castIssues') loadIssues('cast');
}

// =====================================================
// 終礼（店責）
// =====================================================

async function loadShureiData() {
  const result = await api(`/api/shurei/${State.storeId}`);
  if (!result.success) return;

  if (result.data) {
    document.getElementById('shureiSalesTotal').value = result.data.sales_total || 0;
    document.getElementById('shureiMonthlySales').value = result.data.monthly_sales || 0;
  }
}

async function onSaveShurei() {
  const result = await api('/api/shurei', {
    method: 'POST',
    body: JSON.stringify({
      storeId: State.storeId,
      salesToday: parseInt(document.getElementById('shureiSalesTotal').value) || 0,
      monthlySales: parseInt(document.getElementById('shureiMonthlySales').value) || 0
    })
  });

  showAlert('shureiAlert', result.success ? 'success' : 'error',
    result.success ? '保存しました' : (result.error || '保存できませんでした'));
}

// =====================================================
// 終礼閲覧（キャスト用）
// =====================================================

async function loadCastShureiView() {
  const result = await api(`/api/shurei/${State.storeId}`);
  const container = document.getElementById('castShureiViewContent');

  if (!result.success || !result.data) {
    container.innerHTML = '<p class="text-muted">まだデータがありません</p>';
    return;
  }

  const d = result.data;
  container.innerHTML = `
    <div class="shurei-total-row">
      <span class="shurei-total-label">本日の売上</span>
      <span class="shurei-total-value">¥${(d.sales_total || 0).toLocaleString()}</span>
    </div>
    <div class="shurei-monthly-row">
      <span>今月の店舗売上</span>
      <span class="shurei-monthly-value">¥${(d.monthly_sales || 0).toLocaleString()}</span>
    </div>
  `;
}

// =====================================================
// 自己採点（キャスト用）
// =====================================================

function onScoreSelect(e) {
  const score = parseInt(e.currentTarget.dataset.score);
  State.selectedScore = score;
  document.querySelectorAll('.score-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.score) === score);
  });
}

async function loadCastEvalData() {
  const result = await api(`/api/self-evaluation/${State.storeId}`);
  if (!result.success) return;

  const myEval = result.evaluations.find(e => e.gmail === State.gmail);
  if (myEval) {
    State.selectedScore = myEval.score;
    document.getElementById('evalComment').value = myEval.comment || '';
    document.querySelectorAll('.score-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.score) === myEval.score);
    });
  }
}

async function onSaveEval() {
  if (!State.selectedScore) {
    showAlert('castEvalAlert', 'error', '点数を選んでね');
    return;
  }

  const result = await api('/api/self-evaluation', {
    method: 'POST',
    body: JSON.stringify({
      storeId: State.storeId,
      gmail: State.gmail,
      castName: State.displayName,
      score: State.selectedScore,
      comment: document.getElementById('evalComment').value.trim(),
      isEarlyLeave: false
    })
  });

  showAlert('castEvalAlert', result.success ? 'success' : 'error',
    result.success ? '保存しました' : (result.error || '保存できませんでした'));
}

// =====================================================
// 自己採点一覧（店責用）
// =====================================================

async function loadManagerEvalData() {
  // 朝礼に登録されているキャスト一覧を取得
  const choreiResult = await api(`/api/chorei/${State.storeId}`);
  const evalResult = await api(`/api/self-evaluation/${State.storeId}`);
  const container = document.getElementById('managerEvalContent');

  if (!evalResult.success) {
    container.innerHTML = '<p class="text-muted">読み込みに失敗しました</p>';
    return;
  }

  const choreiCasts = choreiResult.success ? choreiResult.casts : [];
  const evals = evalResult.evaluations;

  if (choreiCasts.length === 0) {
    container.innerHTML = '<p class="text-muted">出勤キャストがまだ登録されていません</p>';
    return;
  }

  let html = '<div class="eval-list">';
  choreiCasts.forEach(cast => {
    const ev = evals.find(e => e.gmail === cast.gmail);
    const statusClass = ev ? 'eval-done' : 'eval-pending';
    const statusLabel = ev ? `${ev.score}点` : '未記入';

    html += `<div class="eval-item ${statusClass}">
      <div class="eval-item-header">
        <span class="eval-item-name">${escapeHtml(cast.castName)}</span>
        <span class="eval-item-score ${statusClass}">${statusLabel}</span>
      </div>`;

    // 今日の目標を表示
    if (cast.castGoal) {
      html += `<div class="eval-item-goal"><strong>目標:</strong> ${escapeHtml(cast.castGoal)}</div>`;
    } else {
      html += `<div class="eval-item-goal text-muted">目標未設定</div>`;
    }

    if (ev) {
      html += `<div class="eval-item-comment">${ev.comment ? escapeHtml(ev.comment) : '<span class="text-muted">コメントなし</span>'}</div>`;
    }

    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

// 店責自身の振り返りデータ読み込み
async function loadManagerOwnEval() {
  const result = await api(`/api/self-evaluation/${State.storeId}`);
  if (!result.success) return;

  const myEval = result.evaluations.find(e => e.gmail === State.gmail);
  if (myEval) {
    State.managerSelectedScore = myEval.score;
    document.getElementById('managerEvalComment').value = myEval.comment || '';
    document.querySelectorAll('.manager-score-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.score) === myEval.score);
    });
  }
}

function onManagerScoreSelect(e) {
  const score = parseInt(e.currentTarget.dataset.score);
  State.managerSelectedScore = score;
  document.querySelectorAll('.manager-score-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.score) === score);
  });
}

async function onSaveManagerEval() {
  if (!State.managerSelectedScore) {
    showAlert('managerEvalAlert', 'error', '点数を選んでください');
    return;
  }

  const result = await api('/api/self-evaluation', {
    method: 'POST',
    body: JSON.stringify({
      storeId: State.storeId,
      gmail: State.gmail,
      castName: State.displayName,
      score: State.managerSelectedScore,
      comment: document.getElementById('managerEvalComment').value.trim(),
      isEarlyLeave: false
    })
  });

  showAlert('managerEvalAlert', result.success ? 'success' : 'error',
    result.success ? '保存しました' : (result.error || '保存できませんでした'));

  if (result.success) {
    await loadManagerEvalData();
  }
}

// =====================================================
// 伝言板（共通）
// =====================================================

async function loadIssues(context) {
  const result = await api(`/api/issues/${State.storeId}`);
  const listId = context === 'manager' ? 'managerIssuesList' : 'castIssuesList';
  const container = document.getElementById(listId);

  if (!result.success) {
    container.innerHTML = '<p class="text-muted">読み込みに失敗しました</p>';
    return;
  }

  let issues = result.issues;

  // フィルタ適用（店責画面のみ）
  if (context === 'manager' && State.issueFilter !== 'all') {
    issues = issues.filter(i => i.status === State.issueFilter);
  }

  if (issues.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding:12px 0">投稿がありません</p>';
    return;
  }

  let html = '';
  issues.forEach(issue => {
    const statusClass = issue.status === '完了' ? 'status-done'
      : issue.status === '対応中' ? 'status-progress' : 'status-pending';

    html += `<div class="issue-item">
      <div class="issue-item-header">
        <span class="issue-item-reporter">${escapeHtml(issue.reporter)}</span>
        <span class="issue-item-date">${issue.date}</span>
      </div>
      <div class="issue-item-content">${escapeHtml(issue.content)}</div>
      <div class="issue-item-footer">
        <span class="issue-status ${statusClass}">${escapeHtml(issue.status)}</span>`;

    // 店責・専任はステータス変更可能
    if (context === 'manager') {
      html += `<select class="issue-status-select" data-issue-id="${issue.id}" onchange="onIssueStatusChange(this)">
        <option value="未対応" ${issue.status === '未対応' ? 'selected' : ''}>未対応</option>
        <option value="対応中" ${issue.status === '対応中' ? 'selected' : ''}>対応中</option>
        <option value="完了" ${issue.status === '完了' ? 'selected' : ''}>完了</option>
      </select>`;
    }

    html += '</div>';

    if (issue.feedback) {
      html += `<div class="issue-feedback"><strong>対応:</strong> ${escapeHtml(issue.feedback)}</div>`;
    }

    // 店責用のフィードバック入力
    if (context === 'manager') {
      html += `<div class="issue-feedback-input">
        <input type="text" class="form-control" placeholder="対応コメント..." value="${escapeHtml(issue.feedback || '')}" data-issue-id="${issue.id}" data-field="feedback">
      </div>`;
    }

    html += '</div>';
  });

  container.innerHTML = html;
}

function onIssueFilterClick(e) {
  const filter = e.currentTarget.dataset.filter;
  State.issueFilter = filter;
  document.querySelectorAll('.issue-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  loadIssues('manager');
}

async function onPostIssue(context) {
  const inputId = context === 'manager' ? 'managerIssueContent' : 'castIssueContent';
  const alertId = context === 'manager' ? 'managerIssuesAlert' : 'castIssuesAlert';
  const content = document.getElementById(inputId).value.trim();

  if (!content) {
    showAlert(alertId, 'error', '内容を入力してください');
    return;
  }

  const result = await api('/api/issues', {
    method: 'POST',
    body: JSON.stringify({
      storeId: State.storeId,
      reporter: State.displayName,
      content
    })
  });

  if (result.success) {
    document.getElementById(inputId).value = '';
    showAlert(alertId, 'success', '投稿しました');
    await loadIssues(context);
  } else {
    showAlert(alertId, 'error', result.error || '投稿できませんでした');
  }
}

async function onIssueStatusChange(selectEl) {
  const issueId = selectEl.dataset.issueId;
  const status = selectEl.value;

  // 同じissueのfeedback inputを取得
  const feedbackInput = document.querySelector(`input[data-issue-id="${issueId}"][data-field="feedback"]`);
  const feedback = feedbackInput ? feedbackInput.value : '';

  await api(`/api/issues/${issueId}`, {
    method: 'PUT',
    body: JSON.stringify({ status, feedback })
  });

  await loadIssues('manager');
}

// =====================================================
// ユーティリティ
// =====================================================

function showAlert(id, type, message) {
  const el = document.getElementById(id);
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
