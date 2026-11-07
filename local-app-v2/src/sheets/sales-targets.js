// Targets are private operational data, scoped to a calendar month.
function parseSalesTargets(rows, from, to, storeCode) {
  const targets = {};
  for (const row of rows) {
    const month = String(row[0] || '').trim();
    if (!month || month < from.slice(0, 7) || month > to.slice(0, 7)) continue;
    const code = String(row[1] || '').trim();
    if (storeCode !== 'all' && code !== storeCode) continue;
    const raw = String(row[2] ?? '').replace(/[¥￥,\s]/g, '');
    const amount = Number(raw);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^store_\d+$/.test(code)
      || raw === '' || !Number.isSafeInteger(amount) || amount < 0) {
      throw new Error('月別売上目標の年月・店舗コード・金額を確認してください');
    }
    targets[month] ||= {};
    if (Object.hasOwn(targets[month], code)) {
      throw new Error('月別売上目標の年月と店舗コードが重複しています');
    }
    targets[month][code] = amount;
  }
  return targets;
}

module.exports = { parseSalesTargets };
