/**
 * Google Form連携
 * 早退者セルフ評価フォームの作成・設定
 */

/**
 * 早退者セルフ評価フォームを作成する
 */
function createEarlyLeaveForm() {
  const ss = getSpreadsheet();

  // 既存のフォームをチェック
  const formUrl = ss.getSheetByName('マスタ')
    ?.getRange('F2')
    .getValue();

  if (formUrl) {
    console.log('既存のフォームがあります: ' + formUrl);
    return formUrl;
  }

  // 新規フォーム作成
  const form = FormApp.create('早退者セルフ評価')
    .setAllowEditResponses(false)
    .setCollectEmail(false)
    .setPublishingSummary(false);

  // アイテム追加
  form.addTextItem()
    .setTitle('日付')
    .setRequired(true);

  // 店舗プルダウン（マスタから取得）
  const stores = getStoreNames();
  form.addListItem()
    .setTitle('店舗')
    .setChoiceValues(stores)
    .setRequired(true);

  form.addTextItem()
    .setTitle('キャスト名')
    .setRequired(true);

  form.addScaleItem()
    .setTitle('本日の自己採点')
    .setBounds(1, 10)
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('理由・振り返り')
    .setRequired(true);

  // スプレッドシートにリンク
  const sheet = ss.getSheetByName('早退者セルフ評価');
  if (sheet) {
    FormApp.openByUrl(form.getEditUrl())
      .setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  }

  // マスタシートにURLを保存
  const masterSheet = ss.getSheetByName('マスタ');
  if (masterSheet) {
    masterSheet.getRange('F2').setValue(form.getPublishedUrl());
    masterSheet.getRange('F1').setValue('早退評価フォームURL');
  }

  console.log('フォームを作成しました: ' + form.getPublishedUrl());

  return form.getPublishedUrl();
}

/**
 * 店舗名一覧取得
 */
function getStoreNames() {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName('マスタ');

  if (!masterSheet) {
    return [];
  }

  const data = masterSheet.getDataRange().getValues();
  const storeNameIndex = data[0].indexOf('店舗名');

  const stores = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][storeNameIndex]) {
      stores.push(data[i][storeNameIndex]);
    }
  }

  return stores;
}

/**
 * QRコード生成（簡易版）
 * QRコードAPIを使用して画像を生成
 */
function generateQRCode() {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName('マスタ');

  if (!masterSheet) {
    console.log('マスタシートが見つかりません');
    return;
  }

  const formUrl = masterSheet.getRange('F2').getValue();

  if (!formUrl) {
    console.log('フォームが作成されていません。先にcreateEarlyLeaveForm()を実行してください');
    return;
  }

  // QRコードAPIを使用
  const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(formUrl);

  // 画像を表示（HTML作成）
  const html = HtmlService.createHtmlOutput(`
    <style>
      body { font-family: sans-serif; text-align: center; padding: 20px; }
      h1 { color: #4CAF50; }
      .qr-container { margin: 20px 0; }
      .url { margin-top: 20px; padding: 10px; background: #f5f5f5; border-radius: 4px; word-break: break-all; }
      .instructions { margin-top: 20px; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto; }
      .instructions h3 { color: #2196F3; }
    </style>
    <h1>早退者セルフ評価 QRコード</h1>
    <div class="qr-container">
      <img src="${qrApiUrl}" alt="QRコード">
    </div>
    <div class="url">
      <strong>フォームURL:</strong><br>
      ${formUrl}
    </div>
    <div class="instructions">
      <h3>設置手順</h3>
      <ol>
        <li>上記のQRコードを右クリックして画像を保存</li>
        <li>印刷して控室に掲示</li>
        <li>キャストに退勤時にスマホで読み取ってもらう</li>
      </ol>
      <h3>使い方</h3>
      <ol>
        <li>キャストがQRコードをスキャン</li>
        <li>フォームから自己評価を入力</li>
        <li>回答は自動的にスプレッドシートに蓄積</li>
        <li>週次会議で本部が確認</li>
      </ol>
    </div>
    <button onclick="window.print()">印刷</button>
  `)
    .setTitle('早退者セルフ評価 QRコード')
    .setWidth(500)
    .setHeight(700);

  SpreadsheetApp.getUi().showModalDialog(html, '早退者セルフ評価 QRコード');
}

/**
 * トリガー設定（LINE通知用の定期実行）
 */
function setupTriggers() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'checkOldIssues') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 毎日9時に実行するトリガーを設定
  ScriptApp.newTrigger('checkOldIssues')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .create();

  console.log('トリガーを設定しました（毎日9時に未対応課題のチェックを実行）');
  return 'トリガーを設定しました（毎日9時に未対応課題のチェックを実行）';
}

/**
 * 未対応課題のチェック（7日以上経過したものを通知）
 */
function checkOldIssues() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('課題トラッカー');

  if (!sheet) {
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idIndex = headers.indexOf('ID');
  const dateIndex = headers.indexOf('起票日');
  const statusIndex = headers.indexOf('ステータス');
  const storeIndex = headers.indexOf('店舗名');
  const contentIndex = headers.indexOf('内容');

  const oldIssues = [];
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  for (let i = 1; i < data.length; i++) {
    if (data[i][statusIndex] === '未対応') {
      const createdDate = new Date(data[i][dateIndex]);
      if (createdDate < sevenDaysAgo) {
        oldIssues.push({
          id: data[i][idIndex],
          store: data[i][storeIndex],
          content: data[i][contentIndex],
          days: Math.floor((today - createdDate) / (24 * 60 * 60 * 1000))
        });
      }
    }
  }

  if (oldIssues.length > 0) {
    // LINE通知を送信（必要に応じて実装）
    sendLineNotification(oldIssues);
  }
}

/**
 * LINE通知送信（オプション機能）
 * LINE Notify APIを使用する場合はここを実装
 */
function sendLineNotification(oldIssues) {
  // LINE Notifyのトークンをプロパティに保存しておく
  const properties = PropertiesService.getScriptProperties();
  const lineToken = properties.getProperty('LINE_NOTIFY_TOKEN');

  if (!lineToken) {
    Logger.log('LINE Notifyトークンが設定されていません');
    return;
  }

  let message = '【未対応課題のアラート】\n\n';
  message += '7日以上経過した未対応の課題があります:\n\n';

  oldIssues.forEach(function(issue) {
    message += `・${issue.store}: ${issue.content}（${issue.days}日経過）\n`;
  });

  message += '\n早めの対応をお願いします。';

  const payload = {
    'message': message
  };

  const options = {
    'method': 'post',
    'payload': payload,
    'headers': {
      'Authorization': 'Bearer ' + lineToken
    },
    'muteHttpExceptions': true
  };

  try {
    UrlFetchApp.fetch('https://notify-api.line.me/api/notify', options);
    Logger.log('LINE通知を送信しました');
  } catch (error) {
    Logger.log('LINE通知の送信に失敗しました: ' + error);
  }
}

/**
 * LINE Notifyトークン設定
 */
function setLineNotifyToken(token) {
  PropertiesService.getScriptProperties().setProperty('LINE_NOTIFY_TOKEN', token);
  console.log('LINE Notifyトークンを設定しました');
  return 'LINE Notifyトークンを設定しました';
}
