/**
 * データベース初期化スクリプト
 * テーブル作成とサンプルデータ挿入
 */

const db = require('../src/db/database');
const bcrypt = require('bcryptjs');

console.log('データベースを初期化しています...');

// 既存のテーブルを削除（開発用）
db.exec(`DROP TABLE IF EXISTS early_leave;
       DROP TABLE IF EXISTS issues;
       DROP TABLE IF EXISTS shurei;
       DROP TABLE IF EXISTS chorei;
       DROP TABLE IF EXISTS users;
       DROP TABLE IF EXISTS stores;`);

// テーブル作成
db.exec(`
  -- 店舗マスタ
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    brand TEXT,
    area TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ユーザー（パスワード）
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  );

  -- 朝礼データ
  CREATE TABLE IF NOT EXISTS chorei (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    cast_name TEXT NOT NULL,
    contract_time TEXT,
    pickup BOOLEAN DEFAULT 0,
    pickup_location TEXT,
    current_sales INTEGER DEFAULT 0,
    current_drinks INTEGER DEFAULT 0,
    goal_memo TEXT,
    cast_goal_input TEXT,
    manager_memo TEXT,
    store_news TEXT,
    personal_news TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  );

  -- 終礼データ
  CREATE TABLE IF NOT EXISTS shurei (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    cast_name TEXT NOT NULL,
    drink_count INTEGER DEFAULT 0,
    sales INTEGER DEFAULT 0,
    goal_achieved BOOLEAN DEFAULT 0,
    store_total_sales INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  );

  -- 課題トラッカー
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    reporter TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT '未対応',
    feedback TEXT,
    completed_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  );

  -- 早退者セルフ評価
  CREATE TABLE IF NOT EXISTS early_leave (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    cast_name TEXT NOT NULL,
    self_score INTEGER NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  );

  -- 店舗設定（他キャスト表示設定等）
  CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL UNIQUE,
    show_other_casts BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  );

  -- インデックス作成
  CREATE INDEX IF NOT EXISTS idx_chorei_date_store ON chorei(date, store_id);
  CREATE INDEX IF NOT EXISTS idx_shurei_date_store ON shurei(date, store_id);
  CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
  CREATE INDEX IF NOT EXISTS idx_chorei_cast_name ON chorei(cast_name);
  CREATE INDEX IF NOT EXISTS idx_shurei_cast_name ON shurei(cast_name);
  CREATE INDEX IF NOT EXISTS idx_store_settings_store ON store_settings(store_id);
`);

console.log('テーブルを作成しました');

// サンプル店舗データの挿入
const stores = [
  { name: '東京店', brand: 'ビスクドール', area: '関東' },
  { name: '大阪店', brand: 'ビスクドール', area: '関西' },
  { name: '名古屋店', brand: 'ビスクドール', area: '中部' },
];

const insertStore = db.prepare('INSERT OR IGNORE INTO stores (name, brand, area) VALUES (?, ?, ?)');
const insertManyStores = db.transaction((stores) => {
  for (const store of stores) insertStore.run(store.name, store.brand, store.area);
});
insertManyStores(stores);

console.log('サンプル店舗データを挿入しました');

// パスワードハッシュの生成（店責用: manager123, 管理者用: admin123）
const managerPasswordHash = bcrypt.hashSync('manager123', 10);
const adminPasswordHash = bcrypt.hashSync('admin123', 10);

// ユーザーデータの挿入
const insertUser = db.prepare('INSERT OR REPLACE INTO users (store_id, role, password_hash) VALUES ((SELECT id FROM stores WHERE name = ?), ?, ?)');

// 各店舗の店責パスワード
for (const store of stores) {
  insertUser.run(store.name, 'manager', managerPasswordHash);
}

// 管理者パスワード（店舗なし）
db.prepare('INSERT OR REPLACE INTO users (store_id, role, password_hash) VALUES (NULL, ?, ?)')
  .run('admin', adminPasswordHash);

console.log('パスワードを設定しました');
console.log('  店責パスワード: manager123');
console.log('  管理者パスワード: admin123');

// 店舗設定の初期データ
const insertStoreSettings = db.prepare('INSERT OR IGNORE INTO store_settings (store_id, show_other_casts) VALUES ((SELECT id FROM stores WHERE name = ?), 1)');
for (const store of stores) {
  insertStoreSettings.run(store.name);
}

console.log('店舗設定を初期化しました');

db.close();

console.log('データベースの初期化が完了しました！');
