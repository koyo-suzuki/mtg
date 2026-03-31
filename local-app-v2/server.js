try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }

const express = require('express');
const cors = require('cors');
const path = require('path');
const { verifyGoogleToken } = require('./src/auth/middleware');
const { authMiddleware } = require('./src/auth/middleware');
const configReader = require('./src/sheets/config-reader');
const dataStore = require('./src/sheets/data-store');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// 営業日（AM 11:00 区切り）
// =====================================================

function getBusinessDate() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const hour = jst.getUTCHours();

  if (hour < 5) {
    jst.setUTCDate(jst.getUTCDate() - 1);
  }

  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// =====================================================
// 公開API（認証不要）
// =====================================================

/**
 * フロントエンド用設定（Google Client ID）
 */
app.get('/api/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  });
});

/**
 * Google認証ログイン
 */
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;

  try {
    const payload = await verifyGoogleToken(idToken);
    const email = payload.email;

    const user = await configReader.getUserByEmail(email);
    if (!user) {
      return res.json({ success: false, error: '登録されていないアカウントです' });
    }

    res.json({
      success: true,
      gmail: user.email,
      displayName: user.castName || payload.name || email,
      castName: user.castName || '',
      googleName: payload.name || '',
      role: user.role,
      isManager: user.role === 'cast_manager',
      selectedStore: user.selectedStore || '',
    });
  } catch (error) {
    console.error('Google auth error:', error.message);
    res.json({ success: false, error: '認証に失敗しました' });
  }
});

// =====================================================
// 認証必須API
// =====================================================

app.use('/api', authMiddleware);

// =====================================================
// 店舗・営業日
// =====================================================

app.get('/api/stores', async (req, res) => {
  try {
    const stores = await configReader.getStores();
    res.json({ success: true, stores });
  } catch (error) {
    console.error('Stores error:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/business-date', (req, res) => {
  res.json({ success: true, date: getBusinessDate() });
});

// =====================================================
// キャストマスタ
// =====================================================

app.get('/api/cast-master', async (req, res) => {
  try {
    const casts = await configReader.getCastMembers();
    res.json({ success: true, casts });
  } catch (error) {
    console.error('Cast master error:', error);
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 朝礼API
// =====================================================

/**
 * 朝礼データ保存（店責用）
 */
app.post('/api/chorei', async (req, res) => {
  const { storeCode, casts } = req.body;
  const date = getBusinessDate();

  try {
    await dataStore.saveChoreiCasts(date, storeCode, casts);
    res.json({ success: true });
  } catch (error) {
    console.error('Chorei save error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * 朝礼データ取得
 */
app.get('/api/chorei/:storeCode', async (req, res) => {
  const { storeCode } = req.params;
  const date = getBusinessDate();

  try {
    const casts = await dataStore.getChoreiByDateStore(date, storeCode);
    res.json({ success: true, casts, date });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * キャスト目標保存
 */
app.post('/api/cast-goal', async (req, res) => {
  const { storeCode, gmail, goal, expectedVisitors, needsPickup, pickupDestination } = req.body;
  const date = getBusinessDate();

  try {
    const updated = await dataStore.saveCastGoal(date, storeCode, gmail, {
      goal, expectedVisitors, needsPickup, pickupDestination,
    });
    if (updated) {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: '朝礼にまだ追加されていません' });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * キャストが今日出勤している店舗を取得
 */
app.get('/api/my-stores/:gmail', async (req, res) => {
  const { gmail } = req.params;
  const date = getBusinessDate();

  try {
    const castStores = await dataStore.getCastStores(date, gmail);
    // Resolve store names
    const allStores = await configReader.getStores();
    const stores = castStores.map(cs => {
      const store = allStores.find(s => s.code === cs.storeCode);
      return {
        storeCode: cs.storeCode,
        storeName: store ? store.name : cs.storeCode,
      };
    });
    res.json({ success: true, stores });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 送迎一覧取得（全店舗・当日）
 */
app.get('/api/pickup-list', async (req, res) => {
  const date = getBusinessDate();

  try {
    const pickups = await dataStore.getPickupList(date);
    // Resolve store names
    const allStores = await configReader.getStores();
    const result = pickups.map(p => {
      const store = allStores.find(s => s.code === p.storeCode);
      return {
        castName: p.castName,
        pickupDestination: p.pickupDestination,
        storeName: store ? store.name : p.storeCode,
      };
    });
    res.json({ success: true, pickups: result, date });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 終礼API
// =====================================================

app.post('/api/shurei', async (req, res) => {
  const { storeCode, salesToday, monthlySales } = req.body;
  const date = getBusinessDate();

  try {
    await dataStore.saveShurei(date, storeCode, { salesToday, monthlySales });
    res.json({ success: true });
  } catch (error) {
    console.error('Shurei save error:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/shurei/:storeCode', async (req, res) => {
  const { storeCode } = req.params;
  const date = getBusinessDate();

  try {
    const data = await dataStore.getShureiByDateStore(date, storeCode);
    res.json({ success: true, data, date });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 自己採点API
// =====================================================

app.post('/api/self-evaluation', async (req, res) => {
  const { storeCode, gmail, castName, score, comment, isEarlyLeave } = req.body;
  const date = getBusinessDate();

  try {
    await dataStore.saveSelfEval(date, storeCode, gmail, castName, {
      score, comment, isEarlyLeave,
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Self-evaluation save error:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/self-evaluation/:storeCode', async (req, res) => {
  const { storeCode } = req.params;
  const date = getBusinessDate();

  try {
    const evaluations = await dataStore.getSelfEvalByDateStore(date, storeCode);
    res.json({ success: true, evaluations, date });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 伝言板API
// =====================================================

app.post('/api/issues', async (req, res) => {
  const { storeCode, reporter, content } = req.body;
  const date = getBusinessDate();

  try {
    await dataStore.createIssue(date, storeCode, reporter, content);
    res.json({ success: true });
  } catch (error) {
    console.error('Issue save error:', error);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/issues/:storeCode', async (req, res) => {
  const { storeCode } = req.params;

  try {
    const issues = await dataStore.getIssuesByStore(storeCode);
    res.json({ success: true, issues });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.put('/api/issues/:id', async (req, res) => {
  const { id } = req.params;
  const { status, feedback } = req.body;

  try {
    const updated = await dataStore.updateIssue(id, status, feedback);
    if (updated) {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: '伝言が見つかりません' });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// サーバー起動
// =====================================================

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('');
    console.log('=================================');
    console.log('  朝礼・終礼シート v2 (Production)');
    console.log(`  http://localhost:${PORT}`);
    console.log('=================================');
    console.log('');
  });
}

module.exports = app;
