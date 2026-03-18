const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./src/db/database');

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

  if (hour < 11) {
    jst.setUTCDate(jst.getUTCDate() - 1);
  }

  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// =====================================================
// 認証
// =====================================================

/**
 * ログイン可能なアカウント一覧（ローカル版用）
 */
app.get('/api/accounts', (req, res) => {
  // キャスト（店責権限含む）
  const casts = db.prepare(
    'SELECT gmail, cast_name, role FROM cast_master ORDER BY role DESC, cast_name'
  ).all();

  // 専任
  const admins = db.prepare('SELECT gmail, name FROM admins').all();

  const accounts = [];

  casts.forEach(c => {
    accounts.push({
      gmail: c.gmail,
      displayName: c.cast_name,
      role: c.role, // cast_manager or cast
      type: c.role === 'cast_manager' ? '店責権限あり' : 'キャスト'
    });
  });

  admins.forEach(a => {
    accounts.push({
      gmail: a.gmail,
      displayName: a.name,
      role: 'admin',
      type: '専任'
    });
  });

  res.json({ success: true, accounts });
});

/**
 * ログイン
 */
app.post('/api/auth/login', (req, res) => {
  const { gmail } = req.body;

  // まず専任チェック
  const admin = db.prepare('SELECT gmail, name FROM admins WHERE gmail = ?').get(gmail);
  if (admin) {
    return res.json({
      success: true,
      gmail: admin.gmail,
      displayName: admin.name,
      role: 'admin',
      isManager: false
    });
  }

  // キャストマスタチェック
  const cast = db.prepare('SELECT gmail, cast_name, role FROM cast_master WHERE gmail = ?').get(gmail);
  if (cast) {
    return res.json({
      success: true,
      gmail: cast.gmail,
      displayName: cast.cast_name,
      role: cast.role,
      isManager: cast.role === 'cast_manager'
    });
  }

  res.json({ success: false, error: '登録されていないアカウントです' });
});

// =====================================================
// 店舗・営業日
// =====================================================

app.get('/api/stores', (req, res) => {
  const stores = db.prepare('SELECT id, name, brand, area FROM stores ORDER BY name').all();
  res.json({ success: true, stores });
});

app.get('/api/business-date', (req, res) => {
  res.json({ success: true, date: getBusinessDate() });
});

// =====================================================
// キャストマスタ
// =====================================================

app.get('/api/cast-master', (req, res) => {
  const casts = db.prepare('SELECT gmail, cast_name, role FROM cast_master ORDER BY cast_name').all();
  res.json({ success: true, casts });
});

// =====================================================
// 朝礼API
// =====================================================

/**
 * 朝礼データ保存（店責用）
 */
app.post('/api/chorei', (req, res) => {
  const { storeId, casts } = req.body;
  const date = getBusinessDate();

  try {
    const check = db.prepare('SELECT id FROM chorei WHERE date = ? AND store_id = ? AND gmail = ?');
    const update = db.prepare(`
      UPDATE chorei SET cast_name = ?, monthly_sales = ?, monthly_drinks = ?,
        expected_visitors = ?, manager_memo = ?
      WHERE id = ?
    `);
    const insert = db.prepare(`
      INSERT INTO chorei (date, store_id, cast_name, gmail, monthly_sales, monthly_drinks, expected_visitors, manager_memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const existingGmails = db.prepare(
      'SELECT gmail FROM chorei WHERE date = ? AND store_id = ?'
    ).all(date, storeId).map(r => r.gmail);

    const sentGmails = casts.map(c => c.gmail);

    // 削除されたキャスト
    const toDelete = existingGmails.filter(g => !sentGmails.includes(g));
    if (toDelete.length > 0) {
      const deleteSt = db.prepare('DELETE FROM chorei WHERE date = ? AND store_id = ? AND gmail = ?');
      for (const g of toDelete) {
        deleteSt.run(date, storeId, g);
      }
    }

    for (const cast of casts) {
      const existing = check.get(date, storeId, cast.gmail);
      if (existing) {
        update.run(
          cast.castName,
          cast.monthlySales || 0,
          cast.monthlyDrinks || 0,
          cast.expectedVisitors || 0,
          cast.managerMemo || '',
          existing.id
        );
      } else {
        insert.run(
          date, storeId, cast.castName, cast.gmail,
          cast.monthlySales || 0,
          cast.monthlyDrinks || 0,
          cast.expectedVisitors || 0,
          cast.managerMemo || ''
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
app.get('/api/chorei/:storeId', (req, res) => {
  const { storeId } = req.params;
  const date = getBusinessDate();

  try {
    const rows = db.prepare(`
      SELECT cast_name, gmail, monthly_sales, monthly_drinks, expected_visitors,
             cast_goal, manager_memo
      FROM chorei
      WHERE date = ? AND store_id = ?
    `).all(date, parseInt(storeId));

    const casts = rows.map(row => ({
      castName: row.cast_name,
      gmail: row.gmail,
      monthlySales: row.monthly_sales,
      monthlyDrinks: row.monthly_drinks,
      expectedVisitors: row.expected_visitors,
      castGoal: row.cast_goal,
      managerMemo: row.manager_memo
    }));

    res.json({ success: true, casts, date });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * キャスト目標保存
 */
app.post('/api/cast-goal', (req, res) => {
  const { storeId, gmail, goal, expectedVisitors } = req.body;
  const date = getBusinessDate();

  try {
    const existing = db.prepare(
      'SELECT id FROM chorei WHERE date = ? AND store_id = ? AND gmail = ?'
    ).get(date, storeId, gmail);

    if (existing) {
      db.prepare('UPDATE chorei SET cast_goal = ?, expected_visitors = ? WHERE id = ?')
        .run(goal, expectedVisitors || 0, existing.id);
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
app.get('/api/my-stores/:gmail', (req, res) => {
  const { gmail } = req.params;
  const date = getBusinessDate();

  try {
    const rows = db.prepare(`
      SELECT c.store_id, s.name as store_name
      FROM chorei c
      JOIN stores s ON c.store_id = s.id
      WHERE c.date = ? AND c.gmail = ?
    `).all(date, gmail);

    res.json({ success: true, stores: rows });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 終礼API
// =====================================================

/**
 * 終礼データ保存（店責用）
 */
app.post('/api/shurei', (req, res) => {
  const { storeId, salesCash, salesCard, salesPaypay, salesRoselink, monthlySales } = req.body;
  const date = getBusinessDate();

  try {
    const salesTotal = (salesCash || 0) + (salesCard || 0) + (salesPaypay || 0) + (salesRoselink || 0);

    const existing = db.prepare(
      'SELECT id FROM shurei WHERE date = ? AND store_id = ?'
    ).get(date, storeId);

    if (existing) {
      db.prepare(`
        UPDATE shurei SET sales_cash = ?, sales_card = ?, sales_paypay = ?,
          sales_roselink = ?, sales_total = ?, monthly_sales = ?
        WHERE id = ?
      `).run(salesCash || 0, salesCard || 0, salesPaypay || 0, salesRoselink || 0, salesTotal, monthlySales || 0, existing.id);
    } else {
      db.prepare(`
        INSERT INTO shurei (date, store_id, sales_cash, sales_card, sales_paypay, sales_roselink, sales_total, monthly_sales)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(date, storeId, salesCash || 0, salesCard || 0, salesPaypay || 0, salesRoselink || 0, salesTotal, monthlySales || 0);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Shurei save error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * 終礼データ取得
 */
app.get('/api/shurei/:storeId', (req, res) => {
  const { storeId } = req.params;
  const date = getBusinessDate();

  try {
    const row = db.prepare(`
      SELECT sales_cash, sales_card, sales_paypay, sales_roselink, sales_total, monthly_sales
      FROM shurei WHERE date = ? AND store_id = ?
    `).get(date, parseInt(storeId));

    res.json({ success: true, data: row || null, date });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 自己採点API
// =====================================================

/**
 * 自己採点保存
 */
app.post('/api/self-evaluation', (req, res) => {
  const { storeId, gmail, castName, score, comment, isEarlyLeave } = req.body;
  const date = getBusinessDate();

  try {
    const existing = db.prepare(
      'SELECT id FROM self_evaluation WHERE date = ? AND store_id = ? AND gmail = ?'
    ).get(date, storeId, gmail);

    if (existing) {
      db.prepare(`
        UPDATE self_evaluation SET score = ?, comment = ?, is_early_leave = ?
        WHERE id = ?
      `).run(score, comment || '', isEarlyLeave ? 1 : 0, existing.id);
    } else {
      db.prepare(`
        INSERT INTO self_evaluation (date, store_id, cast_name, gmail, score, comment, is_early_leave)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(date, storeId, castName, gmail, score, comment || '', isEarlyLeave ? 1 : 0);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Self-evaluation save error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * 自己採点一覧取得（店舗・当日）
 */
app.get('/api/self-evaluation/:storeId', (req, res) => {
  const { storeId } = req.params;
  const date = getBusinessDate();

  try {
    const rows = db.prepare(`
      SELECT cast_name, gmail, score, comment, is_early_leave
      FROM self_evaluation
      WHERE date = ? AND store_id = ?
      ORDER BY created_at
    `).all(date, parseInt(storeId));

    res.json({ success: true, evaluations: rows, date });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// 伝言板API
// =====================================================

/**
 * 伝言投稿
 */
app.post('/api/issues', (req, res) => {
  const { storeId, reporter, content } = req.body;
  const date = getBusinessDate();

  try {
    db.prepare(`
      INSERT INTO issues (date, store_id, reporter, content)
      VALUES (?, ?, ?, ?)
    `).run(date, storeId, reporter, content);

    res.json({ success: true });
  } catch (error) {
    console.error('Issue save error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * 伝言一覧取得（店舗）
 */
app.get('/api/issues/:storeId', (req, res) => {
  const { storeId } = req.params;

  try {
    const rows = db.prepare(`
      SELECT id, date, reporter, content, status, feedback, completed_at, created_at
      FROM issues
      WHERE store_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(parseInt(storeId));

    res.json({ success: true, issues: rows });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

/**
 * 伝言ステータス更新
 */
app.put('/api/issues/:id', (req, res) => {
  const { id } = req.params;
  const { status, feedback } = req.body;

  try {
    const completedAt = status === '完了' ? new Date().toISOString() : null;
    db.prepare(`
      UPDATE issues SET status = ?, feedback = ?, completed_at = ?
      WHERE id = ?
    `).run(status, feedback || '', completedAt, parseInt(id));

    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// =====================================================
// サーバー起動
// =====================================================

app.listen(PORT, () => {
  console.log('');
  console.log('=================================');
  console.log('  朝礼・終礼シート v2');
  console.log(`  http://localhost:${PORT}`);
  console.log('=================================');
  console.log('');
});
