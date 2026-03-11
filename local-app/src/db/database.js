/**
 * データベース設定
 * SQLite3を使用
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/chorei.db');

// データディレクトリの作成
const fs = require('fs');
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// タイムアウト設定
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

module.exports = db;
