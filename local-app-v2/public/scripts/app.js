// =====================================================
// アプリケーション状態
// =====================================================

const State = {
  gmail: null,
  displayName: null,
  castName: null,
  role: null,       // 'cast_manager', 'cast', 'admin'
  isManager: false, // 店責権限で入っているか
  storeCode: null,
  storeName: null,
  businessDate: null,
  castMaster: [],
  choreiCasts: [],
  selectedScore: null,
  managerSelectedScore: null,
  issueFilter: 'all',
  idToken: null,    // Google ID Token
  googleClientId: null,
  // Dashboard
  dashStoreCode: null,
  dashDateRange: '7',  // preset name
  dashDateFrom: null,
  dashDateTo: null,
  dashData: null,
  dashCharts: {},
};

// =====================================================
// ロール定義
// =====================================================

const HQ_ROLES = ['senior_manager', 'manager', 'executive'];       // 本部系（店責代行可能）
const DASHBOARD_ROLES = ['senior_manager', 'manager', 'executive']; // ダッシュボード閲覧可能

// =====================================================
// セッション保持
// =====================================================

const SESSION_KEY = 'mtg_session';

function saveSession(screen) {
  const data = {
    gmail: State.gmail,
    displayName: State.displayName,
    castName: State.castName,
    role: State.role,
    isManager: State.isManager,
    storeCode: State.storeCode,
    storeName: State.storeName,
    businessDate: State.businessDate,
    idToken: State.idToken,
    screen: screen || 'login',
    dashStoreCode: State.dashStoreCode,
    dashDateRange: State.dashDateRange,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// =====================================================
// 初期化
// =====================================================

// ページ離脱時に未保存のdebounceをflush
window.addEventListener('beforeunload', () => flushAllAutoSaves());
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAllAutoSaves();
});

document.addEventListener('DOMContentLoaded', async () => {
  setupEvents();

  // セッション復元を試みる
  const session = loadSession();
  if (session && session.idToken && session.gmail) {
    // 状態を復元
    State.idToken = session.idToken;
    State.gmail = session.gmail;
    State.displayName = session.displayName;
    State.castName = session.castName;
    State.role = session.role;
    State.isManager = session.isManager;
    State.storeCode = session.storeCode;
    State.storeName = session.storeName;
    State.businessDate = session.businessDate;
    State.dashStoreCode = session.dashStoreCode || null;
    State.dashDateRange = session.dashDateRange || '7';

    // 営業日を最新に更新
    try {
      const dateResult = await api('/api/business-date');
      if (dateResult.success) State.businessDate = dateResult.date;
    } catch (e) { /* ignore */ }

    // 保存されていた画面を復元
    try {
      await restoreScreen(session.screen);
    } catch (e) {
      console.error('Session restore failed:', e);
      clearSession();
      await initGoogleSignIn();
    }
  } else {
    await initGoogleSignIn();
  }
});

async function restoreScreen(screen) {
  switch (screen) {
    case 'manager':
      await showManagerScreen();
      break;
    case 'cast':
      await showCastScreen();
      break;
    case 'admin':
      await showAdminScreen();
      break;
    case 'dashboard':
      await showDashboardScreen();
      break;
    case 'storeSelect':
      await showStoreSelection();
      break;
    case 'roleSelect':
      showRoleSelectScreen();
      break;
    default:
      clearSession();
      await initGoogleSignIn();
  }
}

async function initGoogleSignIn() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    State.googleClientId = config.googleClientId;

    // Wait for the Google Identity Services library to load
    if (typeof google === 'undefined' || !google.accounts) {
      // Library not loaded yet, wait for it
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (typeof google !== 'undefined' && google.accounts) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        // Timeout after 5 seconds
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });
    }

    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.initialize({
        client_id: State.googleClientId,
        callback: handleGoogleCredentialResponse,
      });
      google.accounts.id.renderButton(
        document.getElementById('googleSignInBtn'),
        { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja', width: 280 }
      );
    }
  } catch (e) {
    console.error('Google Sign-In init error:', e);
  }
}

async function handleGoogleCredentialResponse(response) {
  const loginError = document.getElementById('loginError');
  loginError.classList.add('hidden');

  try {
    const result = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: response.credential }),
    }).then(r => r.json());

    if (!result.success) {
      loginError.textContent = result.error;
      loginError.classList.remove('hidden');
      return;
    }

    State.idToken = response.credential;
    State.gmail = result.gmail;
    State.displayName = result.displayName;
    State.castName = result.castName || result.displayName;
    State.role = result.role;
    State.isManager = false; // Will be set when choosing mode

    const dateResult = await api('/api/business-date');
    State.businessDate = dateResult.date;

    if (HQ_ROLES.includes(result.role)) {
      await showAdminScreen();
    } else if (result.role === 'cast_manager') {
      showRoleSelectScreen();
    } else {
      // cast
      State.isManager = false;
      await showStoreSelection();
    }
  } catch (e) {
    loginError.textContent = '通信エラーが発生しました';
    loginError.classList.remove('hidden');
  }
}

function setupEvents() {
  // ロール選択
  document.getElementById('roleSelectManager').addEventListener('click', async () => {
    State.isManager = true;
    await showStoreSelection();
  });
  document.getElementById('roleSelectCast').addEventListener('click', async () => {
    State.isManager = false;
    await showStoreSelection();
  });
  document.getElementById('roleSelectBack').addEventListener('click', showLogin);

  document.getElementById('castStoreBack').addEventListener('click', () => {
    if (State.role === 'cast_manager') {
      showRoleSelectScreen();
    } else {
      showLogin();
    }
  });
  document.getElementById('managerBack').addEventListener('click', () => {
    showStoreSelection();
  });

  // キャスト検索
  document.getElementById('castSearchInput').addEventListener('input', onCastSearch);
  document.getElementById('castSearchInput').addEventListener('focus', onCastSearch);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cast-search-wrapper')) {
      document.getElementById('castSearchResults').classList.add('hidden');
    }
  });

  // 終礼（自動保存）
  document.getElementById('shureiSalesTotal').addEventListener('input', autoSaveShurei);
  document.getElementById('shureiMonthlySales').addEventListener('input', autoSaveShurei);

  // 店責伝言板
  document.getElementById('postManagerIssue').addEventListener('click', () => onPostIssue('manager'));
  document.querySelectorAll('.issue-filter').forEach(btn => {
    btn.addEventListener('click', onIssueFilterClick);
  });

  // キャスト画面
  document.getElementById('castBack').addEventListener('click', () => {
    showStoreSelection();
  });
  // キャスト目標（自動保存）
  document.getElementById('castGoalInput').addEventListener('input', autoSaveCastGoal);
  document.getElementById('castVisitorsInput').addEventListener('input', autoSaveCastGoal);
  document.getElementById('castPickupCheck').addEventListener('change', autoSaveCastGoal);
  document.getElementById('castPickupDest').addEventListener('input', autoSaveCastGoal);

  // キャスト送迎トグル
  document.getElementById('castPickupCheck').addEventListener('change', (e) => {
    document.getElementById('castPickupDestGroup').classList.toggle('hidden', !e.target.checked);
  });

  // 郵便番号検索
  document.getElementById('castPickupZipBtn').addEventListener('click', onZipSearch);
  document.getElementById('castPickupZip').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onZipSearch(); }
  });

  // 送迎コピー
  document.getElementById('copyPickupBtn').addEventListener('click', onCopyPickup);

  // キャスト振り返り（自動保存）
  document.getElementById('evalComment').addEventListener('input', autoSaveCastEval);
  document.querySelectorAll('#scoreSelector .score-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      onScoreSelect(e);
      doSaveCastEval(); // スコア選択時は即保存
    });
  });

  // 店責振り返り（自動保存）
  document.getElementById('managerEvalComment').addEventListener('input', autoSaveManagerEval);
  document.querySelectorAll('.manager-score-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      onManagerScoreSelect(e);
      doSaveManagerEval(); // スコア選択時は即保存
    });
  });

  // ダッシュボード導線（本部画面から）
  document.getElementById('adminDashboard').addEventListener('click', () => showDashboardScreen());
  document.getElementById('dashBack').addEventListener('click', () => {
    // Destroy charts on leave
    Object.values(State.dashCharts).forEach(c => c.destroy());
    State.dashCharts = {};
    if (HQ_ROLES.includes(State.role)) showAdminScreen();
    else showRoleSelectScreen();
  });
  document.getElementById('dashStoreSelect').addEventListener('change', (e) => {
    State.dashStoreCode = e.target.value;
    loadDashboardData();
  });
  document.querySelectorAll('.dash-date-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.dash-date-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      State.dashDateRange = e.currentTarget.dataset.range;
      computeDashDates();
      loadDashboardData();
    });
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
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (State.idToken) {
    headers['Authorization'] = `Bearer ${State.idToken}`;
  }
  const res = await fetch(endpoint, { ...options, headers });
  if (res.status === 401) {
    clearSession();
    showLogin();
    return { success: false, error: 'セッションが切れました。再度ログインしてください。' };
  }
  return res.json();
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
  State.castName = null;
  State.role = null;
  State.isManager = false;
  State.storeCode = null;
  State.storeName = null;
  State.idToken = null;
  clearSession();
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
}

function showRoleSelectScreen() {
  hideAllScreens();
  document.getElementById('roleSelectScreen').classList.remove('hidden');
  document.getElementById('roleSelectGreeting').textContent = `${State.displayName} さん`;
  saveSession('roleSelect');
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
      <span class="store-item-arrow">&rarr;</span>
    `;
    el.addEventListener('click', async () => {
      State.storeCode = store.code;
      State.storeName = store.name;

      if (State.isManager) {
        await showManagerScreen();
      } else {
        await showCastScreen();
      }
    });
    container.appendChild(el);
  });

  saveSession('storeSelect');
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

  saveSession('manager');
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
    castName: master.castName,
    gmail: master.gmail,
    monthlySales: 0,
    monthlyDrinks: 0,
    expectedVisitors: 0,
    castGoal: '',
    managerMemo: '',
    needsPickup: false,
    pickupDestination: '',
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
    .filter(c => (c.castName || '').toLowerCase().includes(query))
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
    el.innerHTML = `<span class="cast-search-name">${escapeHtml(cast.castName || '')}</span>`;

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
    castName: masterCast.castName,
    gmail: masterCast.gmail,
    monthlySales: 0,
    monthlyDrinks: 0,
    expectedVisitors: 0,
    castGoal: '',
    managerMemo: '',
    needsPickup: false,
    pickupDestination: ''
  });

  renderChoreiCastList();
  doSaveChorei(); // キャスト追加時は即保存
}

// ---- 朝礼データ ----

async function loadChoreiData() {
  const result = await api(`/api/chorei/${State.storeCode}`);
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
    const selfBadge = isSelf ? '<span class="badge badge-self">自分</span>' : '';

    // 自分の行は目標・送迎を入力可能に
    let goalSection = '';
    let pickupSection = '';

    if (isSelf) {
      goalSection = `
        <div class="form-group">
          <label>自分の目標</label>
          <textarea class="form-control manager-self-goal" data-index="${i}" rows="2" placeholder="今日の目標を書いてね">${escapeHtml(cast.castGoal || '')}</textarea>
        </div>`;
      const checked = cast.needsPickup ? 'checked' : '';
      const destHidden = cast.needsPickup ? '' : 'hidden';
      pickupSection = `
        <div class="form-group">
          <label>送迎</label>
          <label class="switch-label">
            <div class="switch">
              <input type="checkbox" class="manager-self-pickup-check" data-index="${i}" ${checked}>
              <span class="switch-slider"></span>
            </div>
            <span>送迎を使う</span>
          </label>
          <div class="manager-self-pickup-dest ${destHidden}" style="margin-top:8px;">
            <div class="pickup-zip-row">
              <input type="text" class="form-control manager-self-zip" placeholder="郵便番号（7桁）" maxlength="8" style="width:140px; flex:none;">
              <button type="button" class="btn btn-secondary btn-sm manager-self-zip-btn">検索</button>
            </div>
            <div class="form-group" style="margin-top:6px;">
              <input type="text" class="form-control manager-self-pickup-input" data-index="${i}" placeholder="住所を入力 or 郵便番号で検索" value="${escapeHtml(cast.pickupDestination || '')}">
            </div>
          </div>
        </div>`;
    } else {
      const goalHtml = cast.castGoal
        ? `<div class="cast-goal-display goal-scroll">${escapeHtml(cast.castGoal)}</div>`
        : `<div class="cast-goal-display empty">まだ書いてない</div>`;
      goalSection = `
        <div class="form-group">
          <label>キャスト目標</label>
          ${goalHtml}
        </div>`;
    }

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
            ${isSelf
              ? `<input type="number" class="form-control chorei-self-visitors" data-index="${i}" value="${cast.expectedVisitors || 0}" min="0">`
              : `<div class="cast-visitors-display">${cast.expectedVisitors || 0}組</div>`
            }
          </div>
        </div>
      </div>
      ${goalSection}
      ${pickupSection}
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.remove);
      State.choreiCasts.splice(idx, 1);
      renderChoreiCastList();
      doSaveChorei(); // キャスト削除時は即保存
    });
  });

  // 店責自身の送迎トグル
  container.querySelectorAll('.manager-self-pickup-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index);
      State.choreiCasts[idx].needsPickup = e.target.checked;
      const destDiv = e.target.closest('.form-group').querySelector('.manager-self-pickup-dest');
      if (destDiv) destDiv.classList.toggle('hidden', !e.target.checked);
    });
  });

  // 店責自身の郵便番号検索
  container.querySelectorAll('.manager-self-zip-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.manager-self-pickup-dest');
      const zipInput = row.querySelector('.manager-self-zip');
      const destInput = row.querySelector('.manager-self-pickup-input');
      const raw = zipInput.value.replace(/[^0-9]/g, '');
      if (raw.length !== 7) {
        showAlert('choreiAlert', 'error', '郵便番号は7桁で入力してください');
        return;
      }
      try {
        const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${raw}`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const r = data.results[0];
          destInput.value = r.address1 + r.address2 + r.address3;
        } else {
          showAlert('choreiAlert', 'error', '該当する住所が見つかりません');
        }
      } catch (e) {
        showAlert('choreiAlert', 'error', '検索に失敗しました');
      }
    });
  });

  // 朝礼入力フィールドに自動保存リスナー（動的要素なのでここで設定）
  container.querySelectorAll('.chorei-monthly-sales, .chorei-monthly-drinks, .chorei-self-visitors, .manager-self-goal, .manager-self-pickup-input').forEach(input => {
    input.addEventListener('input', autoSaveChorei);
  });
  container.querySelectorAll('.manager-self-pickup-check').forEach(cb => {
    cb.addEventListener('change', autoSaveChorei);
  });
}

async function onSaveChorei() {
  const btn = document.getElementById('saveChoreiBtn');
  startSaving(btn);

  const salesInputs = document.querySelectorAll('.chorei-monthly-sales');
  const drinksInputs = document.querySelectorAll('.chorei-monthly-drinks');
  const selfVisitorsInput = document.querySelector('.chorei-self-visitors');
  const selfGoalInput = document.querySelector('.manager-self-goal');
  const selfPickupCheck = document.querySelector('.manager-self-pickup-check');
  const selfPickupInput = document.querySelector('.manager-self-pickup-input');

  const casts = State.choreiCasts.map((cast, i) => {
    const isSelf = cast.gmail === State.gmail;
    return {
      castName: cast.castName,
      gmail: cast.gmail,
      monthlySales: parseInt(salesInputs[i]?.value) || 0,
      monthlyDrinks: parseInt(drinksInputs[i]?.value) || 0,
      expectedVisitors: isSelf && selfVisitorsInput ? (parseInt(selfVisitorsInput.value) || 0) : (cast.expectedVisitors || 0),
      managerMemo: '',
      castGoal: isSelf && selfGoalInput ? selfGoalInput.value.trim() : (cast.castGoal || ''),
      needsPickup: isSelf && selfPickupCheck ? selfPickupCheck.checked : (cast.needsPickup || false),
      pickupDestination: isSelf && selfPickupInput ? selfPickupInput.value.trim() : (cast.pickupDestination || '')
    };
  });

  const result = await api('/api/chorei', {
    method: 'POST',
    body: JSON.stringify({ storeCode: State.storeCode, casts })
  });

  stopSaving(btn);

  if (result.success) {
    await loadChoreiData();
    if (State.role === 'cast_manager') autoAddSelf();
    showAlert('choreiAlert', 'success', '保存しました');
  } else {
    showAlert('choreiAlert', 'error', result.error || '保存できませんでした');
  }
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

  saveSession('cast');
}

async function loadCastData() {
  const result = await api(`/api/chorei/${State.storeCode}`);
  if (!result.success) return;

  const myData = result.casts.find(c => c.gmail === State.gmail);
  if (myData) {
    document.getElementById('castGoalInput').value = myData.castGoal || '';
    document.getElementById('castVisitorsInput').value = myData.expectedVisitors || 0;
    document.getElementById('castPickupCheck').checked = myData.needsPickup;
    document.getElementById('castPickupDest').value = myData.pickupDestination || '';
    document.getElementById('castPickupDestGroup').classList.toggle('hidden', !myData.needsPickup);
  }

  const castGoalAlert = document.getElementById('castGoalAlert');
  castGoalAlert.classList.add('hidden');

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
      <td>&yen;${(cast.monthlySales || 0).toLocaleString()}</td>
      <td>${cast.monthlyDrinks || 0}杯</td>
      <td>${cast.expectedVisitors || 0}組</td>
      <td><div class="goal-scroll">${cast.castGoal ? escapeHtml(cast.castGoal) : '<span class="text-muted">-</span>'}</div></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function onSaveCastGoal() {
  const btn = document.getElementById('saveCastGoal');
  startSaving(btn);

  const goal = document.getElementById('castGoalInput').value.trim();
  const expectedVisitors = parseInt(document.getElementById('castVisitorsInput').value) || 0;
  const needsPickup = document.getElementById('castPickupCheck').checked;
  const pickupDestination = document.getElementById('castPickupDest').value.trim();
  const result = await api('/api/cast-goal', {
    method: 'POST',
    body: JSON.stringify({ storeCode: State.storeCode, gmail: State.gmail, goal, expectedVisitors, needsPickup, pickupDestination })
  });

  stopSaving(btn);

  if (result.success) {
    await loadCastData();
    showAlert('castGoalAlert', 'success', '保存しました');
  } else {
    showAlert('castGoalAlert', 'error', result.error || '保存できませんでした');
  }
}

// =====================================================
// 郵便番号検索
// =====================================================

async function onZipSearch() {
  const raw = document.getElementById('castPickupZip').value.replace(/[^0-9]/g, '');
  if (raw.length !== 7) {
    showAlert('castGoalAlert', 'error', '郵便番号は7桁で入力してね');
    return;
  }

  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${raw}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const r = data.results[0];
      const address = r.address1 + r.address2 + r.address3;
      document.getElementById('castPickupDest').value = address;
    } else {
      showAlert('castGoalAlert', 'error', '該当する住所が見つかりません');
    }
  } catch (e) {
    showAlert('castGoalAlert', 'error', '検索に失敗しました');
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
    opt.value = store.code;
    opt.textContent = store.name;
    select.appendChild(opt);
  });

  saveSession('admin');
}

async function onAdminStoreSelect() {
  const select = document.getElementById('adminStoreSelect');
  const storeCode = select.value;
  if (!storeCode) return;

  State.storeCode = storeCode;
  State.storeName = select.options[select.selectedIndex].textContent;
  State.isManager = true;

  // 店責画面に遷移（ただし自分はキャスト一覧に入らない）
  await showManagerScreen();
}

// =====================================================
// タブ切り替え
// =====================================================

function flushAllAutoSaves() {
  autoSaveChorei.flush();
  autoSaveShurei.flush();
  autoSaveCastGoal.flush();
  autoSaveCastEval.flush();
  autoSaveManagerEval.flush();
}

function onTabChange(e) {
  flushAllAutoSaves();
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
  if (tabName === 'managerPickup') loadPickupList();
  if (tabName === 'managerIssues') loadIssues('manager');
  if (tabName === 'castShureiView') loadCastShureiView();
  if (tabName === 'castEval') loadCastEvalData();
  if (tabName === 'castIssues') loadIssues('cast');
  // Dashboard tabs
  if (tabName === 'dashSales') renderDashSalesTab();
  if (tabName === 'dashAttendance') renderDashAttendanceTab();
  if (tabName === 'dashCast') renderDashCastTab();
  if (tabName === 'dashIssues') renderDashIssuesTab();
}

// =====================================================
// 終礼（店責）
// =====================================================

async function loadShureiData() {
  const result = await api(`/api/shurei/${State.storeCode}`);
  if (!result.success) return;

  if (result.data) {
    document.getElementById('shureiSalesTotal').value = result.data.salesToday || 0;
    document.getElementById('shureiMonthlySales').value = result.data.monthlySales || 0;
  }
}

async function onSaveShurei() {
  const btn = document.getElementById('saveShureiBtn');
  startSaving(btn);

  const result = await api('/api/shurei', {
    method: 'POST',
    body: JSON.stringify({
      storeCode: State.storeCode,
      salesToday: parseInt(document.getElementById('shureiSalesTotal').value) || 0,
      monthlySales: parseInt(document.getElementById('shureiMonthlySales').value) || 0
    })
  });

  stopSaving(btn);

  showAlert('shureiAlert', result.success ? 'success' : 'error',
    result.success ? '保存しました' : (result.error || '保存できませんでした'));
}

// =====================================================
// 終礼閲覧（キャスト用）
// =====================================================

async function loadCastShureiView() {
  const result = await api(`/api/shurei/${State.storeCode}`);
  const container = document.getElementById('castShureiViewContent');

  if (!result.success || !result.data) {
    container.innerHTML = '<p class="text-muted">まだデータがありません</p>';
    return;
  }

  const d = result.data;
  container.innerHTML = `
    <div class="shurei-total-row">
      <span class="shurei-total-label">本日の売上</span>
      <span class="shurei-total-value">&yen;${(d.salesToday || 0).toLocaleString()}</span>
    </div>
    <div class="shurei-monthly-row">
      <span>今月の店舗売上</span>
      <span class="shurei-monthly-value">&yen;${(d.monthlySales || 0).toLocaleString()}</span>
    </div>
  `;
}

// =====================================================
// 自己採点（キャスト用）
// =====================================================

function onScoreSelect(e) {
  const score = parseInt(e.currentTarget.dataset.score);
  State.selectedScore = score;
  document.querySelectorAll('#scoreSelector .score-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.score) === score);
  });
}

async function loadCastEvalData() {
  const result = await api(`/api/self-evaluation/${State.storeCode}`);
  if (!result.success) return;

  const myEval = result.evaluations.find(e => e.gmail === State.gmail);
  if (myEval) {
    State.selectedScore = myEval.score;
    document.getElementById('evalComment').value = myEval.comment || '';
    document.querySelectorAll('#scoreSelector .score-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.score) === myEval.score);
    });
  }
}

async function onSaveEval() {
  if (!State.selectedScore) {
    showAlert('castEvalAlert', 'error', '点数を選んでね');
    return;
  }

  const btn = document.getElementById('saveEvalBtn');
  startSaving(btn);

  const result = await api('/api/self-evaluation', {
    method: 'POST',
    body: JSON.stringify({
      storeCode: State.storeCode,
      gmail: State.gmail,
      castName: State.castName || State.displayName,
      score: State.selectedScore,
      comment: document.getElementById('evalComment').value.trim(),
      isEarlyLeave: false
    })
  });

  stopSaving(btn);

  showAlert('castEvalAlert', result.success ? 'success' : 'error',
    result.success ? '保存しました' : (result.error || '保存できませんでした'));
}

// =====================================================
// 自己採点一覧（店責用）
// =====================================================

async function loadManagerEvalData() {
  const choreiResult = await api(`/api/chorei/${State.storeCode}`);
  const evalResult = await api(`/api/self-evaluation/${State.storeCode}`);
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
  const result = await api(`/api/self-evaluation/${State.storeCode}`);
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

  const btn = document.getElementById('saveManagerEvalBtn');
  startSaving(btn);

  const result = await api('/api/self-evaluation', {
    method: 'POST',
    body: JSON.stringify({
      storeCode: State.storeCode,
      gmail: State.gmail,
      castName: State.castName || State.displayName,
      score: State.managerSelectedScore,
      comment: document.getElementById('managerEvalComment').value.trim(),
      isEarlyLeave: false
    })
  });

  stopSaving(btn);

  showAlert('managerEvalAlert', result.success ? 'success' : 'error',
    result.success ? '保存しました' : (result.error || '保存できませんでした'));

  if (result.success) {
    await loadManagerEvalData();
  }
}

// =====================================================
// 送迎一覧（店責用）
// =====================================================

async function loadPickupList() {
  const result = await api('/api/pickup-list');
  const container = document.getElementById('pickupContent');

  if (!result.success) {
    container.innerHTML = '<p class="text-muted">読み込みに失敗しました</p>';
    return;
  }

  const pickups = result.pickups;

  if (pickups.length === 0) {
    container.innerHTML = '<p class="text-muted">送迎の登録はありません</p>';
    document.getElementById('copyPickupBtn').classList.add('hidden');
    return;
  }

  document.getElementById('copyPickupBtn').classList.remove('hidden');

  // 店舗ごとにグルーピング
  const byStore = {};
  pickups.forEach(p => {
    if (!byStore[p.storeName]) byStore[p.storeName] = [];
    byStore[p.storeName].push(p);
  });

  // 日付フォーマット (M/D)
  const dateParts = result.date.split('-');
  const dateStr = `${parseInt(dateParts[1])}/${parseInt(dateParts[2])}`;

  let html = '';
  for (const [storeName, members] of Object.entries(byStore)) {
    html += `<div class="pickup-store-block" data-store="${escapeHtml(storeName)}" data-date="${dateStr}">`;
    html += `<div class="pickup-store-header">${escapeHtml(storeName)} ${dateStr} 送迎一覧</div>`;
    members.forEach(m => {
      html += `<div class="pickup-member">`;
      html += `<div class="pickup-member-name">&middot;${escapeHtml(m.castName)}</div>`;
      html += `<div class="pickup-member-dest">&middot;${escapeHtml(m.pickupDestination || '未入力')}</div>`;
      html += `</div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

function onCopyPickup() {
  const container = document.getElementById('pickupContent');
  const blocks = container.querySelectorAll('.pickup-store-block');
  let text = '';

  blocks.forEach(block => {
    const storeName = block.dataset.store;
    const dateStr = block.dataset.date;
    text += `${storeName} ${dateStr} 送迎一覧\n`;
    const members = block.querySelectorAll('.pickup-member');
    members.forEach((m, i) => {
      const name = m.querySelector('.pickup-member-name').textContent;
      const dest = m.querySelector('.pickup-member-dest').textContent;
      text += `${name}\n${dest}\n`;
      if (i < members.length - 1) text += '\n';
    });
    text += '\n';
  });

  const copyText = text.trim();

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(copyText).then(() => {
      showAlert('pickupCopyAlert', 'success', 'コピーしました');
    }).catch(() => {
      fallbackCopy(copyText);
    });
  } else {
    fallbackCopy(copyText);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showAlert('pickupCopyAlert', 'success', 'コピーしました');
  } catch (e) {
    showAlert('pickupCopyAlert', 'error', 'コピーに失敗しました');
  }
  document.body.removeChild(textarea);
}

// =====================================================
// 伝言板（共通）
// =====================================================

async function loadIssues(context) {
  const result = await api(`/api/issues/${State.storeCode}`);
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
        <span class="issue-status ${statusClass}">${escapeHtml(issue.status || '未対応')}</span>`;

    if (context === 'manager') {
      html += `<select class="issue-status-select" data-issue-id="${issue.id}" onchange="onIssueStatusChange(this)">
        <option value="未対応" ${issue.status === '未対応' || !issue.status ? 'selected' : ''}>未対応</option>
        <option value="対応中" ${issue.status === '対応中' ? 'selected' : ''}>対応中</option>
        <option value="完了" ${issue.status === '完了' ? 'selected' : ''}>完了</option>
      </select>`;
    }

    html += '</div>';

    if (issue.feedback) {
      html += `<div class="issue-feedback"><strong>対応:</strong> ${escapeHtml(issue.feedback)}</div>`;
    }

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
  const btnId = context === 'manager' ? 'postManagerIssue' : 'postCastIssue';
  const content = document.getElementById(inputId).value.trim();

  if (!content) {
    showAlert(alertId, 'error', '内容を入力してください');
    return;
  }

  const btn = document.getElementById(btnId);
  startSaving(btn);

  const result = await api('/api/issues', {
    method: 'POST',
    body: JSON.stringify({
      storeCode: State.storeCode,
      reporter: State.displayName,
      content
    })
  });

  stopSaving(btn);

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

  const feedbackInput = document.querySelector(`input[data-issue-id="${issueId}"][data-field="feedback"]`);
  const feedback = feedbackInput ? feedbackInput.value : '';

  await api(`/api/issues/${issueId}`, {
    method: 'PUT',
    body: JSON.stringify({ status, feedback })
  });

  await loadIssues('manager');
}

// =====================================================
// ダッシュボード
// =====================================================

function computeDashDates() {
  const today = State.businessDate || new Date().toISOString().slice(0, 10);
  State.dashDateTo = today;
  if (State.dashDateRange === 'all') {
    State.dashDateFrom = '2020-01-01';
  } else {
    const days = parseInt(State.dashDateRange) || 7;
    const d = new Date(today);
    d.setDate(d.getDate() - days + 1);
    State.dashDateFrom = d.toISOString().slice(0, 10);
  }
}

async function showDashboardScreen() {
  hideAllScreens();
  document.getElementById('dashboardScreen').classList.remove('hidden');

  // Load stores for selector
  const result = await api('/api/stores');
  if (!result.success) return;

  const select = document.getElementById('dashStoreSelect');
  select.innerHTML = '<option value="all">全店舗</option>';
  result.stores.forEach(store => {
    const opt = document.createElement('option');
    opt.value = store.code;
    opt.textContent = store.name;
    select.appendChild(opt);
  });

  // Restore or default store selection
  if (State.dashStoreCode) {
    select.value = State.dashStoreCode;
  } else if (State.role === 'cast_manager' && State.storeCode) {
    State.dashStoreCode = State.storeCode;
    select.value = State.storeCode;
  } else {
    State.dashStoreCode = 'all';
  }

  // Restore date range preset button
  document.querySelectorAll('.dash-date-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === State.dashDateRange);
  });

  computeDashDates();
  await loadDashboardData();
  saveSession('dashboard');
}

async function loadDashboardData() {
  const loading = document.getElementById('dashLoading');
  const tabs = document.getElementById('dashTabs');
  loading.classList.remove('hidden');
  tabs.style.opacity = '0.5';

  const params = new URLSearchParams({
    storeCode: State.dashStoreCode || 'all',
    from: State.dashDateFrom,
    to: State.dashDateTo,
  });

  const result = await api(`/api/dashboard/summary?${params}`);
  loading.classList.add('hidden');
  tabs.style.opacity = '1';

  if (!result.success) {
    showToast('error', result.error || 'データ取得に失敗しました');
    return;
  }

  State.dashData = result;
  renderActiveDashTab();
  saveSession('dashboard');
}

function renderActiveDashTab() {
  const active = document.querySelector('#dashTabs .tab.active');
  if (!active) return;
  const name = active.dataset.tab;
  if (name === 'dashSales') renderDashSalesTab();
  else if (name === 'dashAttendance') renderDashAttendanceTab();
  else if (name === 'dashCast') renderDashCastTab();
  else if (name === 'dashIssues') renderDashIssuesTab();
}

// ---- Chart helper ----

const DASH_COLORS = ['#6C5CE7', '#00B894', '#E17055', '#FDCB6E', '#0984E3', '#D63031', '#A29BFE', '#55EFC4'];

function getOrCreateChart(canvasId, config) {
  if (State.dashCharts[canvasId]) {
    const chart = State.dashCharts[canvasId];
    chart.data = config.data;
    if (config.options) chart.options = config.options;
    chart.update();
    return chart;
  }
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const chart = new Chart(ctx, config);
  State.dashCharts[canvasId] = chart;
  return chart;
}

function fmtYen(n) {
  return '\u00a5' + (n || 0).toLocaleString();
}

// ---- Sales Tab ----

function renderDashSalesTab() {
  const data = State.dashData;
  if (!data) return;

  // Aggregate sales by date
  const byDate = {};
  data.sales.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = 0;
    byDate[s.date] += s.salesToday;
  });
  const dates = Object.keys(byDate).sort();
  const values = dates.map(d => byDate[d]);

  // Metrics
  const totalSales = values.reduce((a, b) => a + b, 0);
  const latestMonthlySales = data.sales.length > 0
    ? data.sales.reduce((best, s) => s.date > best.date ? s : best, data.sales[0]).monthlySales
    : 0;
  const avgDaily = dates.length > 0 ? Math.round(totalSales / dates.length) : 0;

  document.getElementById('dashSalesMetrics').innerHTML = `
    <div class="dash-metric">
      <div class="dash-metric-label">期間合計</div>
      <div class="dash-metric-value">${fmtYen(totalSales)}</div>
      <div class="dash-metric-sub">${dates.length}日分</div>
    </div>
    <div class="dash-metric">
      <div class="dash-metric-label">日平均</div>
      <div class="dash-metric-value">${fmtYen(avgDaily)}</div>
    </div>
    <div class="dash-metric">
      <div class="dash-metric-label">最新月次累計</div>
      <div class="dash-metric-value">${fmtYen(latestMonthlySales)}</div>
    </div>
  `;

  // Line chart
  const labels = dates.map(d => d.slice(5)); // MM-DD
  getOrCreateChart('dashSalesChart', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '日次売上',
        data: values,
        borderColor: '#6C5CE7',
        backgroundColor: 'rgba(108,92,231,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: dates.length > 30 ? 0 : 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => fmtYen(v) } },
      },
    },
  });
}

// ---- Attendance Tab ----

function renderDashAttendanceTab() {
  const data = State.dashData;
  if (!data) return;

  // Count by date
  const byDate = {};
  const earlyByDate = {};
  data.attendance.forEach(a => {
    byDate[a.date] = (byDate[a.date] || 0) + 1;
  });
  data.evaluations.forEach(e => {
    if (e.isEarlyLeave) earlyByDate[e.date] = (earlyByDate[e.date] || 0) + 1;
  });
  const dates = Object.keys(byDate).sort();
  const counts = dates.map(d => byDate[d]);
  const totalDays = dates.length;
  const avgCount = totalDays > 0 ? (counts.reduce((a, b) => a + b, 0) / totalDays).toFixed(1) : 0;
  const totalEarly = Object.values(earlyByDate).reduce((a, b) => a + b, 0);

  document.getElementById('dashAttendanceMetrics').innerHTML = `
    <div class="dash-metric">
      <div class="dash-metric-label">平均出勤人数</div>
      <div class="dash-metric-value">${avgCount}人</div>
      <div class="dash-metric-sub">${totalDays}日分</div>
    </div>
    <div class="dash-metric">
      <div class="dash-metric-label">早退数</div>
      <div class="dash-metric-value">${totalEarly}件</div>
    </div>
  `;

  // Bar chart
  getOrCreateChart('dashAttendanceChart', {
    type: 'bar',
    data: {
      labels: dates.map(d => d.slice(5)),
      datasets: [{
        label: '出勤人数',
        data: counts,
        backgroundColor: '#00B894',
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });

  // Attendance table (recent 14 days max)
  const recentDates = dates.slice(-14).reverse();
  const tableContainer = document.getElementById('dashAttendanceTable');
  if (recentDates.length === 0) {
    tableContainer.innerHTML = '<p class="text-muted">データがありません</p>';
    return;
  }

  let html = '<div class="table-wrapper"><table class="table"><thead><tr><th>日付</th><th>人数</th><th>キャスト</th></tr></thead><tbody>';
  recentDates.forEach(date => {
    const casts = data.attendance.filter(a => a.date === date).map(a => escapeHtml(a.castName));
    html += `<tr><td>${date.slice(5)}</td><td>${casts.length}</td><td>${casts.join(', ')}</td></tr>`;
  });
  html += '</tbody></table></div>';
  tableContainer.innerHTML = html;
}

// ---- Cast Tab ----

function renderDashCastTab() {
  const data = State.dashData;
  if (!data) return;

  // Aggregate per cast
  const castMap = {};
  data.attendance.forEach(a => {
    if (!castMap[a.gmail]) castMap[a.gmail] = { name: a.castName, gmail: a.gmail, days: 0, visitors: 0, latestSales: 0, latestDrinks: 0, latestDate: '', scores: [], details: [] };
    castMap[a.gmail].days++;
    castMap[a.gmail].visitors += a.expectedVisitors;
    // 最新日付の売上・ドリンクを保持
    if (a.date >= castMap[a.gmail].latestDate) {
      castMap[a.gmail].latestDate = a.date;
      castMap[a.gmail].latestSales = a.monthlySales || 0;
      castMap[a.gmail].latestDrinks = a.monthlyDrinks || 0;
    }
  });
  data.evaluations.forEach(e => {
    if (!castMap[e.gmail]) castMap[e.gmail] = { name: e.castName, gmail: e.gmail, days: 0, visitors: 0, latestSales: 0, latestDrinks: 0, latestDate: '', scores: [], details: [] };
    castMap[e.gmail].scores.push(e.score);
    castMap[e.gmail].details.push({ date: e.date, score: e.score, comment: e.comment, isEarlyLeave: e.isEarlyLeave });
  });

  const casts = Object.values(castMap).sort((a, b) => b.days - a.days);
  const container = document.getElementById('dashCastSummary');

  if (casts.length === 0) {
    container.innerHTML = '<p class="text-muted">データがありません</p>';
    return;
  }

  let html = '';
  casts.forEach((cast, i) => {
    const avgScore = cast.scores.length > 0
      ? (cast.scores.reduce((a, b) => a + b, 0) / cast.scores.length).toFixed(1)
      : '-';

    let detailHtml = '';
    if (cast.details.length > 0) {
      detailHtml = '<div class="table-wrapper"><table class="table"><thead><tr><th>日付</th><th>スコア</th><th>コメント</th></tr></thead><tbody>';
      cast.details.sort((a, b) => b.date.localeCompare(a.date)).forEach(d => {
        const earlyBadge = d.isEarlyLeave ? ' <span class="badge badge-pickup" style="background:var(--danger-bg);color:var(--danger);">早退</span>' : '';
        detailHtml += `<tr><td>${d.date.slice(5)}</td><td>${d.score}点${earlyBadge}</td><td>${escapeHtml(d.comment) || '<span class="text-muted">-</span>'}</td></tr>`;
      });
      detailHtml += '</tbody></table></div>';
    } else {
      detailHtml = '<p class="text-muted" style="padding:8px 0;">評価データなし</p>';
    }

    html += `
      <div class="dash-cast-row">
        <div class="dash-cast-header" data-cast-idx="${i}">
          <span class="dash-cast-name">${escapeHtml(cast.name)}</span>
          <div class="dash-cast-stats">
            <span>売上<span class="dash-cast-stat-val">${fmtYen(cast.latestSales)}</span></span>
            <span>🍸<span class="dash-cast-stat-val">${cast.latestDrinks}</span></span>
            <span><span class="dash-cast-stat-val">${cast.days}</span>日</span>
            <span>評価<span class="dash-cast-stat-val">${avgScore}</span></span>
          </div>
        </div>
        <div class="dash-cast-detail" id="dashCastDetail${i}">${detailHtml}</div>
      </div>`;
  });

  container.innerHTML = html;

  // Toggle expand
  container.querySelectorAll('.dash-cast-header').forEach(header => {
    header.addEventListener('click', () => {
      const idx = header.dataset.castIdx;
      const detail = document.getElementById('dashCastDetail' + idx);
      detail.classList.toggle('expanded');
    });
  });

  // Score trend chart
  const scoreByDate = {};
  const scoreCounts = {};
  data.evaluations.forEach(e => {
    if (!scoreByDate[e.date]) { scoreByDate[e.date] = 0; scoreCounts[e.date] = 0; }
    scoreByDate[e.date] += e.score;
    scoreCounts[e.date]++;
  });
  const scoreDates = Object.keys(scoreByDate).sort();
  const avgScores = scoreDates.map(d => +(scoreByDate[d] / scoreCounts[d]).toFixed(1));

  getOrCreateChart('dashScoreChart', {
    type: 'line',
    data: {
      labels: scoreDates.map(d => d.slice(5)),
      datasets: [{
        label: '平均スコア',
        data: avgScores,
        borderColor: '#6C5CE7',
        backgroundColor: 'rgba(108,92,231,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: scoreDates.length > 30 ? 0 : 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 10, ticks: { stepSize: 1 } } },
    },
  });
}

// ---- Issues Tab ----

function renderDashIssuesTab() {
  const data = State.dashData;
  if (!data) return;

  const issues = data.issues;
  const open = issues.filter(i => !i.status || i.status === '未対応').length;
  const progress = issues.filter(i => i.status === '対応中').length;
  const done = issues.filter(i => i.status === '完了').length;

  document.getElementById('dashIssuesMetrics').innerHTML = `
    <div class="dash-metric">
      <div class="dash-metric-label">未対応</div>
      <div class="dash-metric-value dash-metric-down">${open}</div>
    </div>
    <div class="dash-metric">
      <div class="dash-metric-label">対応中</div>
      <div class="dash-metric-value" style="color:var(--warning)">${progress}</div>
    </div>
    <div class="dash-metric">
      <div class="dash-metric-label">完了</div>
      <div class="dash-metric-value dash-metric-up">${done}</div>
    </div>
  `;

  // Donut chart
  getOrCreateChart('dashIssueDonutChart', {
    type: 'doughnut',
    data: {
      labels: ['未対応', '対応中', '完了'],
      datasets: [{
        data: [open, progress, done],
        backgroundColor: ['#E17055', '#FDCB6E', '#00B894'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 12 } } } },
    },
  });

  // Issue list (recent 20)
  const listContainer = document.getElementById('dashIssuesList');
  const sorted = [...issues].sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date)).slice(0, 20);

  if (sorted.length === 0) {
    listContainer.innerHTML = '<p class="text-muted">投稿がありません</p>';
    return;
  }

  let html = '';
  sorted.forEach(issue => {
    const statusClass = issue.status === '完了' ? 'status-done'
      : issue.status === '対応中' ? 'status-progress' : 'status-pending';
    html += `<div class="issue-item">
      <div class="issue-item-header">
        <span class="issue-item-reporter">${escapeHtml(issue.reporter)}</span>
        <span class="issue-item-date">${issue.date}</span>
      </div>
      <div class="issue-item-content">${escapeHtml(issue.content)}</div>
      <div class="issue-item-footer">
        <span class="issue-status ${statusClass}">${escapeHtml(issue.status || '未対応')}</span>
      </div>
      ${issue.feedback ? `<div class="issue-feedback"><strong>対応:</strong> ${escapeHtml(issue.feedback)}</div>` : ''}
    </div>`;
  });

  listContainer.innerHTML = html;
}

// =====================================================
// 自動保存
// =====================================================

function debounce(fn, delay) {
  let timer;
  const debounced = function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn.apply(this, args); }, delay);
  };
  debounced.flush = function () {
    if (timer) { clearTimeout(timer); timer = null; fn(); }
  };
  return debounced;
}

function showAutoSaveStatus(elementId, status) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.remove('hidden', 'autosave-saving', 'autosave-saved', 'autosave-error');
  if (status === 'saving') {
    el.className = 'autosave-status autosave-saving';
    el.textContent = '保存中...';
  } else if (status === 'saved') {
    el.className = 'autosave-status autosave-saved';
    el.textContent = '保存済み';
    setTimeout(() => el.classList.add('hidden'), 2000);
  } else if (status === 'error') {
    el.className = 'autosave-status autosave-error';
    el.textContent = '保存に失敗しました';
    setTimeout(() => el.classList.add('hidden'), 3000);
  }
}

// Debounced auto-save functions
const autoSaveChorei = debounce(() => doSaveChorei(), 1000);
const autoSaveShurei = debounce(() => doSaveShurei(), 1000);
const autoSaveCastGoal = debounce(() => doSaveCastGoal(), 1000);
const autoSaveCastEval = debounce(() => doSaveCastEval(), 1000);
const autoSaveManagerEval = debounce(() => doSaveManagerEval(), 1000);

async function doSaveChorei() {
  showAutoSaveStatus('choreiAutoSave', 'saving');
  const salesInputs = document.querySelectorAll('.chorei-monthly-sales');
  const drinksInputs = document.querySelectorAll('.chorei-monthly-drinks');
  const selfVisitorsInput = document.querySelector('.chorei-self-visitors');
  const selfGoalInput = document.querySelector('.manager-self-goal');
  const selfPickupCheck = document.querySelector('.manager-self-pickup-check');
  const selfPickupInput = document.querySelector('.manager-self-pickup-input');

  const casts = State.choreiCasts.map((cast, i) => {
    const isSelf = cast.gmail === State.gmail;
    return {
      castName: cast.castName,
      gmail: cast.gmail,
      monthlySales: parseInt(salesInputs[i]?.value) || 0,
      monthlyDrinks: parseInt(drinksInputs[i]?.value) || 0,
      expectedVisitors: isSelf && selfVisitorsInput ? (parseInt(selfVisitorsInput.value) || 0) : (cast.expectedVisitors || 0),
      managerMemo: '',
      castGoal: isSelf && selfGoalInput ? selfGoalInput.value.trim() : (cast.castGoal || ''),
      needsPickup: isSelf && selfPickupCheck ? selfPickupCheck.checked : (cast.needsPickup || false),
      pickupDestination: isSelf && selfPickupInput ? selfPickupInput.value.trim() : (cast.pickupDestination || ''),
    };
  });

  const result = await api('/api/chorei', {
    method: 'POST',
    body: JSON.stringify({ storeCode: State.storeCode, casts }),
  });

  showAutoSaveStatus('choreiAutoSave', result.success ? 'saved' : 'error');
}

async function doSaveShurei() {
  showAutoSaveStatus('shureiAutoSave', 'saving');
  const result = await api('/api/shurei', {
    method: 'POST',
    body: JSON.stringify({
      storeCode: State.storeCode,
      salesToday: parseInt(document.getElementById('shureiSalesTotal').value) || 0,
      monthlySales: parseInt(document.getElementById('shureiMonthlySales').value) || 0,
    }),
  });
  showAutoSaveStatus('shureiAutoSave', result.success ? 'saved' : 'error');
}

async function doSaveCastGoal() {
  showAutoSaveStatus('castGoalAutoSave', 'saving');
  const result = await api('/api/cast-goal', {
    method: 'POST',
    body: JSON.stringify({
      storeCode: State.storeCode,
      gmail: State.gmail,
      castName: State.castName || State.displayName,
      goal: document.getElementById('castGoalInput').value.trim(),
      expectedVisitors: parseInt(document.getElementById('castVisitorsInput').value) || 0,
      needsPickup: document.getElementById('castPickupCheck').checked,
      pickupDestination: document.getElementById('castPickupDest').value.trim(),
    }),
  });
  showAutoSaveStatus('castGoalAutoSave', result.success ? 'saved' : 'error');
}

async function doSaveCastEval() {
  if (!State.selectedScore) return;
  showAutoSaveStatus('castEvalAutoSave', 'saving');
  const result = await api('/api/self-evaluation', {
    method: 'POST',
    body: JSON.stringify({
      storeCode: State.storeCode,
      gmail: State.gmail,
      castName: State.castName || State.displayName,
      score: State.selectedScore,
      comment: document.getElementById('evalComment').value.trim(),
      isEarlyLeave: false,
    }),
  });
  showAutoSaveStatus('castEvalAutoSave', result.success ? 'saved' : 'error');
}

async function doSaveManagerEval() {
  if (!State.managerSelectedScore) return;
  showAutoSaveStatus('managerEvalAutoSave', 'saving');
  const result = await api('/api/self-evaluation', {
    method: 'POST',
    body: JSON.stringify({
      storeCode: State.storeCode,
      gmail: State.gmail,
      castName: State.castName || State.displayName,
      score: State.managerSelectedScore,
      comment: document.getElementById('managerEvalComment').value.trim(),
      isEarlyLeave: false,
    }),
  });
  showAutoSaveStatus('managerEvalAutoSave', result.success ? 'saved' : 'error');
  if (result.success) await loadManagerEvalData();
}

// =====================================================
// ユーティリティ
// =====================================================

function showAlert(id, type, message) {
  const el = document.getElementById(id);
  if (el) {
    el.className = `alert alert-${type}`;
    el.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  }
  // 店責画面では常にトーストも表示
  if (document.getElementById('managerScreen') && !document.getElementById('managerScreen').classList.contains('hidden')) {
    showToast(type, message);
  }
}

function showToast(type, message) {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.textContent = message;
  toast.style.opacity = '0';
  toast.style.transform = 'translateX(-50%) translateY(-20px)';
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  }, 10);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =====================================================
// 保存中スピナー
// =====================================================

function startSaving(btn) {
  if (!btn) return;
  btn._originalHTML = btn.innerHTML;
  btn.classList.add('is-saving');
  btn.innerHTML = '<span class="spinner"></span>保存中...';
}

function stopSaving(btn) {
  if (!btn || !btn._originalHTML) return;
  btn.classList.remove('is-saving');
  btn.innerHTML = btn._originalHTML;
}
