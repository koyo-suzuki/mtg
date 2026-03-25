const db = require('../src/db/database');

console.log('データベース初期化中...');

db.pragma('foreign_keys = OFF');
db.exec('DROP TABLE IF EXISTS chorei');
db.exec('DROP TABLE IF EXISTS shurei');
db.exec('DROP TABLE IF EXISTS self_evaluation');
db.exec('DROP TABLE IF EXISTS issues');
db.exec('DROP TABLE IF EXISTS stores');
db.exec('DROP TABLE IF EXISTS users');
db.exec('DROP TABLE IF EXISTS cast_master');
db.exec('DROP TABLE IF EXISTS admins');

// =====================================================
// スキーマ
// =====================================================

db.exec(`
  CREATE TABLE stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    brand TEXT,
    area TEXT
  )
`);

// キャストマスタ（Googleスプシの代替）
db.exec(`
  CREATE TABLE cast_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail TEXT UNIQUE NOT NULL,
    cast_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cast'
  )
`);

// 専任（本部スタッフ、キャストマスタとは別管理）
db.exec(`
  CREATE TABLE admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE chorei (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    cast_name TEXT NOT NULL,
    gmail TEXT NOT NULL,
    monthly_sales INTEGER DEFAULT 0,
    monthly_drinks INTEGER DEFAULT 0,
    expected_visitors INTEGER DEFAULT 0,
    cast_goal TEXT DEFAULT '',
    manager_memo TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  )
`);
db.exec('CREATE INDEX idx_chorei_date_store ON chorei(date, store_id)');

db.exec(`
  CREATE TABLE shurei (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    sales_cash INTEGER DEFAULT 0,
    sales_card INTEGER DEFAULT 0,
    sales_paypay INTEGER DEFAULT 0,
    sales_roselink INTEGER DEFAULT 0,
    sales_total INTEGER DEFAULT 0,
    monthly_sales INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  )
`);
db.exec('CREATE INDEX idx_shurei_date_store ON shurei(date, store_id)');

db.exec(`
  CREATE TABLE self_evaluation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    cast_name TEXT NOT NULL,
    gmail TEXT,
    score INTEGER,
    comment TEXT DEFAULT '',
    is_early_leave INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  )
`);

db.exec(`
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    store_id INTEGER NOT NULL,
    reporter TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT '未対応',
    feedback TEXT DEFAULT '',
    completed_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id)
  )
`);

// =====================================================
// サンプルデータ
// =====================================================

const insertStore = db.prepare('INSERT INTO stores (name, brand, area) VALUES (?, ?, ?)');
insertStore.run('東京店', 'ビスクドール', '東京');
insertStore.run('大阪店', 'ビスクドール', '大阪');
insertStore.run('名古屋店', 'ビスクドール', '名古屋');

// キャストマスタ（role: cast_manager = 店責権限あり, cast = 一般キャスト）
const insertCast = db.prepare('INSERT INTO cast_master (gmail, cast_name, role) VALUES (?, ?, ?)');
insertCast.run('aoi@example.com', 'あおい', 'cast_manager');
insertCast.run('sakura@example.com', 'さくら', 'cast_manager');
insertCast.run('hina@example.com', 'ひな', 'cast');
insertCast.run('rena@example.com', 'れな', 'cast');
insertCast.run('miku@example.com', 'みく', 'cast');
insertCast.run('yui@example.com', 'ゆい', 'cast');
insertCast.run('rina@example.com', 'りな', 'cast');
insertCast.run('mei@example.com', 'めい', 'cast');
insertCast.run('sora@example.com', 'そら', 'cast');
insertCast.run('nana@example.com', 'なな', 'cast');
insertCast.run('kaho@example.com', 'かほ', 'cast');
insertCast.run('risa@example.com', 'りさ', 'cast');

// 専任
const insertAdmin = db.prepare('INSERT INTO admins (gmail, name) VALUES (?, ?)');
insertAdmin.run('admin@example.com', '鈴木（本部）');

console.log('✅ データベース初期化完了');
console.log('');
console.log('店舗: 東京店, 大阪店, 名古屋店');
console.log('');
console.log('キャスト（店責権限あり）:');
console.log('  あおい (aoi@example.com)');
console.log('  さくら (sakura@example.com)');
console.log('');
console.log('キャスト（一般）:');
console.log('  ひな, れな, みく, ゆい, りな, めい, そら, なな, かほ, りさ');
console.log('');
console.log('専任:');
console.log('  鈴木（本部） admin@example.com');

process.exit(0);
