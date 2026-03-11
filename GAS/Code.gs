/**
 * 朝礼・終礼シートシステム
 * Google Workspace + GAS WebApp
 * 株式会社esplanade（ビスクドールグループ）
 * 作成者：鈴木洸葉（HR / Operations）
 * 作成日：2026年3月11日　バージョン：v3.0
 */

// =====================================================
// 設定・定数
// =====================================================

const CONFIG = {
  SPREADSHEET_ID: '10dZPv_gaVN9ByRgsksHhljHpfNXeLRjjay8vd7GAGMg', // スプレッドシートID
  TIMEZONE: 'Asia/Tokyo',
  DATE_CUTOVER_HOUR: 2, // AM2:00で日付切り替え
};

// ロール定義
const ROLES = {
  MANAGER: 'manager',
  CAST: 'cast',
  ADMIN: 'admin'
};

/**
 * スプレッドシート取得ヘルパー
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

// =====================================================
// 初期化・セットアップ
// =====================================================

/**
 * スプレッドシート初期化（初回実行のみ）
 */
function setupSpreadsheet() {
  // スプレッドシートIDを直接指定
  const SPREADSHEET_ID = '10dZPv_gaVN9ByRgsksHhljHpfNXeLRjjay8vd7GAGMg';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 既存シートをクリア（オプション）
  // const sheets = ss.getSheets();
  // sheets.forEach(sheet => {
  //   if (sheet.getSheetName() !== 'シート1') {
  //     ss.deleteSheet(sheet);
  //   }
  // });

  // シート作成
  createChoreiSheet(ss);
  createShureiSheet(ss);
  createEarlyLeaveSheet(ss);
  createIssueTrackerSheet(ss);
  createMasterSheet(ss);

  console.log('スプレッドシートの初期化が完了しました！');
  return 'スプレッドシートの初期化が完了しました！';
}

/**
 * 朝礼シート作成
 */
function createChoreiSheet(ss) {
  const sheetName = '朝礼_' + getCurrentMonth();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  sheet.clear();
  sheet.setFrozenRows(1);

  const headers = [
    'タイムスタンプ',
    '日付',
    '店舗名',
    'キャスト名',
    '契約時間',
    '送迎',
    '目標メモ(キャスト)',
    '目標メモ(店責)',
    '店舗ニュース',
    '個人ニュース'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#4CAF50')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 列幅設定
  sheet.setColumnWidth(1, 180); // タイムスタンプ
  sheet.setColumnWidth(2, 120); // 日付
  sheet.setColumnWidth(3, 150); // 店舗名
  sheet.setColumnWidth(4, 150); // キャスト名
  sheet.setColumnWidth(5, 100); // 契約時間
  sheet.setColumnWidth(6, 80);  // 送迎
  sheet.setColumnWidth(7, 200); // 目標メモ(キャスト)
  sheet.setColumnWidth(8, 200); // 目標メモ(店責)
  sheet.setColumnWidth(9, 300); // 店舗ニュース
  sheet.setColumnWidth(10, 300); // 個人ニュース
}

/**
 * 終礼シート作成
 */
function createShureiSheet(ss) {
  const sheetName = '終礼_' + getCurrentMonth();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  sheet.clear();
  sheet.setFrozenRows(1);

  const headers = [
    'タイムスタンプ',
    '日付',
    '店舗名',
    'キャスト名',
    'ドリンク杯数',
    '売上',
    '目標達成可否',
    '店舗全体売上'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#2196F3')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 列幅設定
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 120);
  sheet.setColumnWidth(7, 100);
  sheet.setColumnWidth(8, 150);
}

/**
 * 早退者セルフ評価シート作成（Google Form連携用）
 */
function createEarlyLeaveSheet(ss) {
  let sheet = ss.getSheetByName('早退者セルフ評価');

  if (!sheet) {
    sheet = ss.insertSheet('早退者セルフ評価');
  }

  // Google Form連携なのでヘッダーのみ作成
  // 実際はFormが自動で作成する
  sheet.getRange(1, 1).setValue('早退者セルフ評価（Google Form連携）')
    .setFontWeight('bold').setFontSize(14);
}

/**
 * 課題トラッカーシート作成
 */
function createIssueTrackerSheet(ss) {
  let sheet = ss.getSheetByName('課題トラッカー');

  if (!sheet) {
    sheet = ss.insertSheet('課題トラッカー');
  }

  sheet.clear();
  sheet.setFrozenRows(1);

  const headers = [
    'ID',
    '起票日',
    '店舗名',
    '起票者',
    '内容',
    'ステータス',
    'FBコメント',
    '完了日'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#FF9800')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 列幅設定
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(5, 300);
  sheet.setColumnWidth(6, 100);
  sheet.setColumnWidth(7, 300);
  sheet.setColumnWidth(8, 120);

  // データ検証（ステータス）
  const statusRange = sheet.getRange(2, 6, 1000, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['未対応', '対応中', '完了'], true)
    .build();
  statusRange.setDataValidation(rule);
}

/**
 * マスタシート作成
 */
function createMasterSheet(ss) {
  let sheet = ss.getSheetByName('マスタ');

  if (!sheet) {
    sheet = ss.insertSheet('マスタ');
  }

  sheet.clear();
  sheet.setFrozenRows(1);

  const headers = [
    '店舗名',
    'ブランド',
    'エリア',
    '店責パスワードハッシュ',
    '管理者パスワードハッシュ'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#9C27B0')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // 列幅設定
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 250);
  sheet.setColumnWidth(5, 250);

  // サンプル店舗データ（デプロイ時に削除または変更）
  const sampleStores = [
    ['サンプル店舗1', 'ビスクドール', '東京', '', getHash('manager123')],
    ['サンプル店舗2', 'ビスクドール', '大阪', '', getHash('manager123')],
  ];

  // パスワードハッシュ列の前にサンプルデータを追加
  sheet.getRange(2, 1, sampleStores.length, 5).setValues(sampleStores);

  // 管理者パスワードハッシュをD1セルに設定（グローバル値）
  sheet.getRange(2, 5).setValue(getHash('admin123'));
}

// =====================================================
// ユーティリティ関数
// =====================================================

/**
 * 現在の月を取得（シート名用）
 */
function getCurrentMonth() {
  const date = getBusinessDate();
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy-MM');
}

/**
 * 営業日を取得（AM2:00区切り）
 */
function getBusinessDate() {
  const now = new Date();
  const hour = now.getHours();

  // AM 0:00～1:59の場合は前日として扱う
  if (hour < CONFIG.DATE_CUTOVER_HOUR) {
    now.setDate(now.getDate() - 1);
  }

  // 時刻をリセット
  now.setHours(0, 0, 0, 0);

  return now;
}

/**
 * 日付フォーマット（表示用）
 */
function formatDate(date) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, 'yyyy/MM/dd');
}

/**
 * SHA-256ハッシュ生成
 */
function getHash(text) {
  const rawHash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text
  );
  let txtHash = '';
  for (let i = 0; i < rawHash.length; i++) {
    let hashVal = rawHash[i];
    if (hashVal < 0) {
      hashVal += 256;
    }
    if (hashVal.toString(16).length == 1) {
      txtHash += '0';
    }
    txtHash += hashVal.toString(16);
  }
  return txtHash;
}

/**
 * シートを取得（月次シート用）
 */
function getSheet(sheetType) {
  const ss = getSpreadsheet();
  const month = getCurrentMonth();
  const sheetName = sheetType + '_' + month;
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    // シートが存在しない場合は作成
    if (sheetType === '朝礼') {
      createChoreiSheet(ss);
    } else if (sheetType === '終礼') {
      createShureiSheet(ss);
    }
    sheet = ss.getSheetByName(sheetName);
  }

  return sheet;
}

/**
 * LockServiceで排他制御
 */
function getLock() {
  return LockService.getScriptLock();
}

// =====================================================
// WebApp エントリーポイント
// =====================================================

/**
 * WebApp の doGet
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('朝礼・終礼シートシステム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
