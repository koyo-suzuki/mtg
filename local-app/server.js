/**
 * Expressサーバー
 * 朝礼・終礼シートシステム
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./src/db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// ユーティリティ関数
// =====================================================

/**
 * 営業日を取得（AM2:00区切り）
 */
function getBusinessDate() {
  // テスト用：3/10を返す（本番稼働時はコメント解除）
  return '2026-03-10';

  /* 本番稼働時は以下を使用
  const now = new Date();
  const hour = now.getHours();

  // AM 0:00～1:59の場合は前日として扱う
  if (hour < 2) {
    now.setDate(now.getDate() - 1);
  }

  // 時刻をリセット
  now.setHours(0, 0, 0, 0);

  // 日本時間で日付文字列を生成
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`; // YYYY-MM-DD
  */
}

/**
 * 日付フォーマット（表示用）
 */
function formatDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// =====================================================
// APIルート
// =====================================================

/**
 * 認証
 */
app.post('/api/auth/login', (req, res) => {
  const { role, password, storeName } = req.body;
  const bcrypt = require('bcryptjs');

  try {
    let query;
    let params;

    if (role === 'admin') {
      query = `
        SELECT u.id, u.role, NULL as store_name, s.name as store_display_name
        FROM users u
        WHERE u.role = 'admin' AND u.store_id IS NULL
      `;
      params = [];
    } else {
      query = `
        SELECT u.id, u.role, s.name as store_name, s.name as store_display_name
        FROM users u
        JOIN stores s ON u.store_id = s.id
        WHERE u.role = ? AND s.name = ?
      `;
      params = [role, storeName];
    }

    const user = db.prepare(query).get(...params);

    if (!user) {
      return res.json({ success: false, error: '認証に失敗しました' });
    }

    // パスワード検証（デモ用に平文比較もサポート）
    const isValid = bcrypt.compareSync(password, user.password_hash) || password === 'manager123' || password === 'admin123';

    if (!isValid) {
      return res.json({ success: false, error: 'パスワードが正しくありません' });
    }

    res.json({
      success: true,
      role: user.role,
      storeName: user.store_name
    });
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * 店舗一覧取得
 */
app.get('/api/stores', (req, res) => {
  try {
    const stores = db.prepare('SELECT name, brand, area FROM stores ORDER BY name').all();
    res.json({ success: true, stores });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 営業日取得
 */
app.get('/api/business-date', (req, res) => {
  res.json({ success: true, date: formatDate(getBusinessDate()) });
});

// =====================================================
// 朝礼API
// =====================================================

/**
 * 朝礼データ保存
 */
app.post('/api/chorei', (req, res) => {
  const { storeName, casts, storeNews, personalNews } = req.body;
  const date = getBusinessDate();

  try {
    // 店舗ID取得
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    // 各キャストごとに処理（既存なら更新、なければ追加）
    const check = db.prepare('SELECT id FROM chorei WHERE date = ? AND store_id = ? AND cast_name = ?');
    const update = db.prepare(`
      UPDATE chorei
      SET contract_time = ?, pickup = ?, pickup_location = ?, current_sales = ?, current_drinks = ?,
          goal_memo = ?, cast_goal_input = ?, manager_memo = ?, store_news = ?, personal_news = ?
      WHERE id = ?
    `);
    const insert = db.prepare(`
      INSERT INTO chorei (date, store_id, cast_name, contract_time, pickup, pickup_location, current_sales, current_drinks, goal_memo, cast_goal_input, manager_memo, store_news, personal_news)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const cast of casts) {
      const existing = check.get(date, store.id, cast.castName);

      if (existing) {
        // 既存レコードを更新
        update.run(
          cast.contractTime || '',
          cast.pickup ? 1 : 0,
          cast.pickupLocation || '',
          cast.currentSales || 0,
          cast.currentDrinks || 0,
          cast.goalMemo || '',
          cast.castGoalInput || '',
          cast.managerMemo || '',
          storeNews || '',
          personalNews || '',
          existing.id
        );
      } else {
        // 新規追加
        insert.run(
          date,
          store.id,
          cast.castName,
          cast.contractTime || '',
          cast.pickup ? 1 : 0,
          cast.pickupLocation || '',
          cast.currentSales || 0,
          cast.currentDrinks || 0,
          cast.goalMemo || '',
          cast.castGoalInput || '',
          cast.managerMemo || '',
          storeNews || '',
          personalNews || ''
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Chorei save error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * 朝礼データ取得
 */
app.get('/api/chorei/:storeName', (req, res) => {
  const { storeName } = req.params;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    const rows = db.prepare(`
      SELECT cast_name, contract_time, pickup, pickup_location, current_sales, current_drinks, goal_memo, cast_goal_input, manager_memo
      FROM chorei
      WHERE date = ? AND store_id = ?
    `).all(date, store.id);

    const casts = rows.map(row => ({
      castName: row.cast_name,
      contractTime: row.contract_time,
      pickup: row.pickup === 1,
      pickupLocation: row.pickup_location || '',
      currentSales: row.current_sales || 0,
      currentDrinks: row.current_drinks || 0,
      goalMemo: row.goal_memo,
      castGoalInput: row.cast_goal_input,
      managerMemo: row.manager_memo
    }));

    // ニュースは最初の行から取得
    const newsRow = rows[0];
    const storeNews = newsRow?.store_news || '';
    const personalNews = newsRow?.personal_news || '';

    res.json({
      success: true,
      casts,
      storeNews,
      personalNews,
      date: formatDate(date)
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * キャスト目標保存
 */
app.post('/api/cast-goal', (req, res) => {
  const { storeName, castName, goal } = req.body;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    // 既存チェック
    const existing = db.prepare(`
      SELECT id FROM chorei WHERE date = ? AND store_id = ? AND cast_name = ?
    `).get(date, store.id, castName);

    if (existing) {
      // 更新
      db.prepare('UPDATE chorei SET goal_memo = ? WHERE id = ?').run(goal, existing.id);
    } else {
      // 新規
      db.prepare(`
        INSERT INTO chorei (date, store_id, cast_name, goal_memo)
        VALUES (?, ?, ?, ?)
      `).run(date, store.id, castName, goal);
    }

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * キャスト目標取得
 */
app.get('/api/cast-goal/:storeName/:castName', (req, res) => {
  const { storeName, castName } = req.params;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    const row = db.prepare(`
      SELECT goal_memo, cast_goal_input FROM chorei
      WHERE date = ? AND store_id = ? AND cast_name = ?
    `).get(date, store.id, castName);

    res.json({
      success: true,
      goal: row?.goal_memo || '',
      castGoalInput: row?.cast_goal_input || '',
      date: formatDate(date)
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 送迎情報保存（キャスト用）
 */
app.post('/api/pickup-info', (req, res) => {
  const { storeName, castName, pickup, pickupLocation } = req.body;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    // 既存チェック
    const existing = db.prepare(`
      SELECT id FROM chorei WHERE date = ? AND store_id = ? AND cast_name = ?
    `).get(date, store.id, castName);

    if (existing) {
      // 更新
      db.prepare('UPDATE chorei SET pickup = ?, pickup_location = ? WHERE id = ?')
        .run(pickup ? 1 : 0, pickupLocation || '', existing.id);
    } else {
      // 新規
      db.prepare(`
        INSERT INTO chorei (date, store_id, cast_name, pickup, pickup_location)
        VALUES (?, ?, ?, ?, ?)
      `).run(date, store.id, castName, pickup ? 1 : 0, pickupLocation || '');
    }

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * キャスト目標入力保存（キャスト用）
 */
app.post('/api/cast-goal-input', (req, res) => {
  const { storeName, castName, goal } = req.body;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    // 既存チェック
    const existing = db.prepare(`
      SELECT id FROM chorei WHERE date = ? AND store_id = ? AND cast_name = ?
    `).get(date, store.id, castName);

    if (existing) {
      // 更新
      db.prepare('UPDATE chorei SET cast_goal_input = ? WHERE id = ?').run(goal, existing.id);
    } else {
      // 新規
      db.prepare(`
        INSERT INTO chorei (date, store_id, cast_name, cast_goal_input)
        VALUES (?, ?, ?, ?)
      `).run(date, store.id, castName, goal);
    }

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 時系列実績取得
 */
app.get('/api/cast-history/:storeName/:castName', (req, res) => {
  const { storeName, castName } = req.params;
  const { limit = 30 } = req.query;

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    const rows = db.prepare(`
      SELECT date, sales, drink_count, goal_achieved
      FROM shurei
      WHERE store_id = ? AND cast_name = ?
      ORDER BY date DESC
      LIMIT ?
    `).all(store.id, castName, parseInt(limit));

    const history = rows.map(row => ({
      date: formatDate(row.date),
      sales: row.sales,
      drinkCount: row.drink_count,
      goalAchieved: row.goal_achieved === 1
    }));

    res.json({ success: true, history });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 表示設定取得
 */
app.get('/api/settings/:storeName', (req, res) => {
  const { storeName } = req.params;

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    const setting = db.prepare('SELECT show_other_casts FROM store_settings WHERE store_id = ?').get(store.id);

    res.json({
      success: true,
      showOtherCasts: setting ? setting.show_other_casts === 1 : true
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 表示設定更新
 */
app.put('/api/settings/:storeName', (req, res) => {
  const { storeName } = req.params;
  const { showOtherCasts } = req.body;

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    // 既存チェック
    const existing = db.prepare('SELECT id FROM store_settings WHERE store_id = ?').get(store.id);

    if (existing) {
      db.prepare('UPDATE store_settings SET show_other_casts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(showOtherCasts ? 1 : 0, existing.id);
    } else {
      db.prepare('INSERT INTO store_settings (store_id, show_other_casts) VALUES (?, ?)')
        .run(store.id, showOtherCasts ? 1 : 0);
    }

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 早退者自己採点保存
 */
app.post('/api/early-leave', (req, res) => {
  const { storeName, castName, selfScore, reason } = req.body;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    db.prepare(`
      INSERT INTO early_leave (date, store_id, cast_name, self_score, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(date, store.id, castName, selfScore, reason || '');

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 早退者自己採点一覧取得
 */
app.get('/api/early-leave/:storeName', (req, res) => {
  const { storeName } = req.params;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    const rows = db.prepare(`
      SELECT cast_name, self_score, reason, created_at
      FROM early_leave
      WHERE date = ? AND store_id = ?
      ORDER BY created_at DESC
    `).all(date, store.id);

    const earlyLeaves = rows.map(row => ({
      castName: row.cast_name,
      selfScore: row.self_score,
      reason: row.reason,
      createdAt: row.created_at
    }));

    res.json({ success: true, earlyLeaves });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 終礼API
// =====================================================

/**
 * 終礼データ保存
 */
app.post('/api/shurei', (req, res) => {
  const { storeName, casts, totalSales } = req.body;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    // 既存データを削除
    db.prepare('DELETE FROM shurei WHERE date = ? AND store_id = ?').run(date, store.id);

    // データ挿入
    const insert = db.prepare(`
      INSERT INTO shurei (date, store_id, cast_name, drink_count, sales, goal_achieved, store_total_sales)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const cast of casts) {
      insert.run(
        date,
        store.id,
        cast.castName,
        cast.drinkCount || 0,
        cast.sales || 0,
        cast.goalAchieved ? 1 : 0,
        totalSales || 0
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 終礼データ取得
 */
app.get('/api/shurei/:storeName', (req, res) => {
  const { storeName } = req.params;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    const rows = db.prepare(`
      SELECT cast_name, drink_count, sales, goal_achieved, store_total_sales
      FROM shurei
      WHERE date = ? AND store_id = ?
    `).all(date, store.id);

    if (rows.length === 0) {
      return res.json({ success: true, casts: [], totalSales: 0, date: formatDate(date) });
    }

    const casts = rows.map(row => ({
      castName: row.cast_name,
      drinkCount: row.drink_count,
      sales: row.sales,
      goalAchieved: row.goal_achieved === 1
    }));

    res.json({
      success: true,
      casts,
      totalSales: rows[0].store_total_sales || 0,
      date: formatDate(date)
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * キャスト実績取得（当日と月間累計）
 */
app.get('/api/cast-performance/:storeName/:castName', (req, res) => {
  const { storeName, castName } = req.params;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    // 当日の実績
    const todayRow = db.prepare(`
      SELECT drink_count, sales, goal_achieved
      FROM shurei
      WHERE date = ? AND store_id = ? AND cast_name = ?
    `).get(date, store.id, castName);

    // 月間累計
    const monthStart = date.substring(0, 7); // YYYY-MM
    const monthlyRows = db.prepare(`
      SELECT sales, drink_count
      FROM shurei
      WHERE date LIKE ? AND store_id = ? AND cast_name = ?
    `).all(monthStart + '%', store.id, castName);

    let monthlyTotalSales = 0;
    let monthlyTotalDrinks = 0;
    for (const row of monthlyRows) {
      monthlyTotalSales += row.sales;
      monthlyTotalDrinks += row.drink_count;
    }

    res.json({
      success: true,
      today: todayRow ? {
        sales: todayRow.sales,
        drinkCount: todayRow.drink_count,
        goalAchieved: todayRow.goal_achieved === 1,
        date: formatDate(date)
      } : null,
      monthly: {
        totalSales: monthlyTotalSales,
        totalDrinks: monthlyTotalDrinks
      }
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 課題トラッカーAPI
// =====================================================

/**
 * 課題一覧取得
 */
app.get('/api/issues', (req, res) => {
  const { status } = req.query;

  try {
    let query = `
      SELECT i.id, i.date, s.name as store_name, i.reporter, i.content, i.status, i.feedback, i.completed_at
      FROM issues i
      JOIN stores s ON i.store_id = s.id
    `;

    if (status && status !== 'all') {
      query += ' WHERE i.status = ?';
    }

    query += ' ORDER BY i.created_at DESC';

    const issues = status && status !== 'all'
      ? db.prepare(query).all(status)
      : db.prepare(query).all();

    res.json({ success: true, issues });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 課題追加
 */
app.post('/api/issues', (req, res) => {
  const { storeName, reporter, content } = req.body;
  const date = getBusinessDate();

  try {
    const store = db.prepare('SELECT id FROM stores WHERE name = ?').get(storeName);
    if (!store) {
      return res.json({ success: false, error: '店舗が見つかりません' });
    }

    const result = db.prepare(`
      INSERT INTO issues (date, store_id, reporter, content)
      VALUES (?, ?, ?, ?)
    `).run(date, store.id, reporter, content);

    res.json({ success: true, issueId: result.lastInsertRowid });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 課題ステータス更新
 */
app.put('/api/issues/:id', (req, res) => {
  const { id } = req.params;
  const { status, feedback } = req.body;

  try {
    const update = db.prepare(`
      UPDATE issues
      SET status = ?, feedback = ?, completed_at = CASE WHEN ? = '完了' THEN ? ELSE completed_at END
      WHERE id = ?
    `);

    update.run(status, feedback || '', status, getBusinessDate(), id);

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 管理者用ダッシュボードAPI
// =====================================================

/**
 * 全店舗データ取得
 */
app.get('/api/dashboard/all-stores', (req, res) => {
  const date = getBusinessDate();

  try {
    const stores = db.prepare('SELECT id, name FROM stores ORDER BY name').all();

    const results = [];

    for (const store of stores) {
      // キャスト数
      const castCount = db.prepare(`
        SELECT COUNT(DISTINCT cast_name) as count FROM chorei
        WHERE date = ? AND store_id = ?
      `).get(date, store.id)?.count || 0;

      // 店舗全体売上
      const salesRow = db.prepare(`
        SELECT store_total_sales FROM shurei
        WHERE date = ? AND store_id = ? LIMIT 1
      `).get(date, store.id);

      const totalSales = salesRow?.store_total_sales || 0;

      results.push({
        storeName: store.name,
        castCount,
        totalSales,
        date: formatDate(date)
      });
    }

    res.json({ success: true, data: results });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 月間集計取得
 */
app.get('/api/dashboard/summary', (req, res) => {
  const { storeName } = req.query;

  try {
    const monthStart = new Date().toISOString().substring(0, 7); // YYYY-MM

    let query = `
      SELECT
        COUNT(*) as total_count,
        SUM(CASE WHEN goal_achieved = 1 THEN 1 ELSE 0 END) as achieved_count,
        SUM(sales) as total_sales,
        SUM(drink_count) as total_drinks
      FROM shurei
      WHERE date LIKE ?
    `;

    const params = [monthStart + '%'];

    if (storeName) {
      query += ' AND store_id = (SELECT id FROM stores WHERE name = ?)';
      params.push(storeName);
    }

    const row = db.prepare(query).get(...params);

    res.json({
      success: true,
      summary: {
        month: monthStart,
        totalSales: row.total_sales || 0,
        totalDrinks: row.total_drinks || 0,
        achievedCount: row.achieved_count || 0,
        totalCount: row.total_count || 0,
        achievementRate: row.total_count > 0 ? Math.round((row.achieved_count / row.total_count) * 100) : 0
      }
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// サーバー起動
// =====================================================

app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`🚀 サーバーが起動しました`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`=================================\n`);
});

module.exports = app;
