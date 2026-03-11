/**
 * サンプルデータ生成スクリプト
 */

const db = require('../src/db/database');
const bcrypt = require('bcryptjs');

console.log('サンプルデータを生成しています...');

const date = getBusinessDate();
const dateStr = formatDate(date);

function getBusinessDate() {
  // テスト用：3/10を返す
  return new Date('2026-03-10T00:00:00');

  // 本番稼働時
  // const now = new Date();
  // const hour = now.getHours();
  // if (hour < 2) {
  //   now.setDate(now.getDate() - 1);
  // }
  // now.setHours(0, 0, 0, 0);
  // return now;
}

function formatDate(date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

// 店舗データ取得
const stores = db.prepare('SELECT id, name FROM stores').all();

// キャスト名サンプル
const castNames = [
  '桜庭 みお', '佐藤 優子', '鈴木 舞', '高橋 美玲', '伊藤 舞',
  '渡辺 あい', '山本 里奈', '中村 美樹', '小林 愛', '加藤 あかり'
];

// 目標メモサンプル
const goalMemos = [
  '本日は楽しくおもてなしします！',
  '売上目標：50万円',
  '新しいお客様を3人増やします',
  '笑顔を忘れず接客します',
  'ドリンクオーダーを意識します'
];

// 契約時間サンプル
const contractTimes = [
  '18:00-23:00', '19:00-24:00', '17:00-22:00', '18:30-23:30', '20:00-25:00'
];

console.log(`日付: ${dateStr}`);
console.log(`店舗数: ${stores.length}`);
console.log('');

for (const store of stores) {
  console.log(`--- ${store.name} ---`);

  // 朝礼データ生成
  const castCount = Math.floor(Math.random() * 4) + 3; // 3〜6人のキャスト

  for (let i = 0; i < castCount; i++) {
    const castName = castNames[Math.floor(Math.random() * castNames.length)];
    const currentSales = Math.floor(Math.random() * 50000); // 0〜5万円
    const currentDrinks = Math.floor(Math.random() * 20); // 0〜20杯
    const goalMemo = goalMemos[Math.floor(Math.random() * goalMemos.length)];

    db.prepare(`
      INSERT INTO chorei (date, store_id, cast_name, contract_time, pickup, current_sales, current_drinks, goal_memo, manager_memo, store_news, personal_news)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dateStr,
      store.id,
      castName,
      contractTimes[Math.floor(Math.random() * contractTimes.length)],
      Math.random() > 0.5 ? 1 : 0,
      currentSales,
      currentDrinks,
      goalMemo,
      '',
      '本日はイベントあります。',
      'みなさん、体調に気をつけてください。'
    );

    console.log(`  朝礼: ${castName} - 売上¥${currentSales.toLocaleString()} / ${currentDrinks}杯`);
  }

  // 終礼データ生成
  const choreiCasts = db.prepare(`
    SELECT cast_name FROM chorei WHERE date = ? AND store_id = ?
  `).all(dateStr, store.id);

  let totalSales = 0;
  for (const castRow of choreiCasts) {
    const sales = Math.floor(Math.random() * 100000) + 30000; // 3〜13万円
    const drinkCount = Math.floor(Math.random() * 30) + 10; // 10〜40杯
    const goalAchieved = Math.random() > 0.4;

    totalSales += sales;

    db.prepare(`
      INSERT INTO shurei (date, store_id, cast_name, drink_count, sales, goal_achieved, store_total_sales)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      dateStr,
      store.id,
      castRow.cast_name,
      drinkCount,
      sales,
      goalAchieved ? 1 : 0,
      0 // store_total_salesは後で更新
    );

    console.log(`  終礼: ${castRow.cast_name} - 売上¥${sales.toLocaleString()} / ${drinkCount}杯 ${goalAchieved ? '達成' : '未達成'}`);
  }

  // 店舗全体売上を更新
  db.prepare(`UPDATE shurei SET store_total_sales = ? WHERE date = ? AND store_id = ?`)
    .run(totalSales, dateStr, store.id);

  console.log(`  店舗全体売上: ¥${totalSales.toLocaleString()}`);
  console.log('');
}

// 課題データ生成
const issueContents = [
  'エアコンの調子が悪い',
  '在庫が足りません',
  'トイレットペーパーの補充が必要',
  'スタッフミーティングの日程調整',
  '新商品の導入について相談'
];

const reporters = ['店長', '副店長', 'シフトリーダー'];

for (const store of stores) {
  if (Math.random() > 0.5) {
    const content = issueContents[Math.floor(Math.random() * issueContents.length)];
    const reporter = reporters[Math.floor(Math.random() * reporters.length)];

    db.prepare(`
      INSERT INTO issues (date, store_id, reporter, content, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      dateStr,
      store.id,
      reporter,
      content,
      '未対応'
    );

    console.log(`課題: ${store.name} - ${content}`);
  }
}

// キャスト用目標データ（既に朝礼で作成されています）

// 総キャスト数を取得
const totalCasts = db.prepare('SELECT COUNT(*) as count FROM chorei WHERE date = ?').get(dateStr).count;

console.log('');
console.log('サンプルデータの生成が完了しました！');
console.log('');
console.log('生成内容:');
console.log(`  日付: ${dateStr}`);
console.log(`  店舗数: ${stores.length}店舗`);
console.log(`  合計キャスト数: ${totalCasts}人`);
console.log(`  課題数: ${db.prepare('SELECT COUNT(*) as count FROM issues WHERE date = ?').get(dateStr).count}件`);

db.close();
