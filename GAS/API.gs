/**
 * API 関数
 * クライアント側から呼び出されるサーバーサイド関数
 */

// =====================================================
// 認証関連
// =====================================================

/**
 * 認証処理
 * @param {string} role - ロール (manager/cast/admin)
 * @param {string} password - パスワード
 * @param {string} storeName - 店舗名（manager/castの場合）
 * @returns {Object} 認証結果
 */
function authenticate(role, password, storeName) {
  try {
    const ss = getSpreadsheet();
    const masterSheet = ss.getSheetByName('マスタ');

    if (!masterSheet) {
      return { success: false, error: 'マスタシートが見つかりません' };
    }

    const data = masterSheet.getDataRange().getValues();
    const headers = data[0];
    const storeNameIndex = headers.indexOf('店舗名');
    const managerPassIndex = headers.indexOf('店責パスワードハッシュ');
    const adminPassIndex = headers.indexOf('管理者パスワードハッシュ');

    const passwordHash = getHash(password);

    if (role === ROLES.ADMIN) {
      // 管理者認証
      // 管理者パスワードはD1セルまたは各店舗行の5列目に保存
      for (let i = 1; i < data.length; i++) {
        const storedHash = data[i][adminPassIndex];
        if (storedHash && storedHash === passwordHash) {
          return {
            success: true,
            role: ROLES.ADMIN,
            storeName: null
          };
        }
      }
      return { success: false, error: 'パスワードが正しくありません' };

    } else if (role === ROLES.MANAGER || role === ROLES.CAST) {
      // 店舗認証
      if (!storeName) {
        return { success: false, error: '店舗を選択してください' };
      }

      for (let i = 1; i < data.length; i++) {
        if (data[i][storeNameIndex] === storeName) {
          const storedHash = data[i][managerPassIndex];

          if (storedHash && storedHash === passwordHash) {
            return {
              success: true,
              role: role,
              storeName: storeName
            };
          }
        }
      }
      return { success: false, error: 'パスワードが正しくありません' };
    }

    return { success: false, error: '無効なロールです' };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * 店舗リスト取得
 */
function getStoreList() {
  try {
    const ss = getSpreadsheet();
    const masterSheet = ss.getSheetByName('マスタ');

    if (!masterSheet) {
      return { success: false, error: 'マスタシートが見つかりません' };
    }

    const data = masterSheet.getDataRange().getValues();
    const headers = data[0];
    const storeNameIndex = headers.indexOf('店舗名');
    const brandIndex = headers.indexOf('ブランド');
    const areaIndex = headers.indexOf('エリア');

    const stores = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][storeNameIndex]) {
        stores.push({
          name: data[i][storeNameIndex],
          brand: data[i][brandIndex] || '',
          area: data[i][areaIndex] || ''
        });
      }
    }

    return { success: true, stores: stores };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// =====================================================
// 朝礼関連
// =====================================================

/**
 * 朝礼データ保存
 */
function saveChorei(data) {
  const lock = getLock();
  try {
    lock.waitLock(10000);

    const ss = getSpreadsheet();
    const sheet = getSheet('朝礼');

    const businessDate = getBusinessDate();
    const timestamp = new Date();

    for (const cast of data.casts) {
      sheet.appendRow([
        timestamp,
        formatDate(businessDate),
        data.storeName,
        cast.castName,
        cast.contractTime,
        cast.pickup ? '✓' : '',
        cast.goalMemo || '',
        '', // 店責メモは別途更新
        data.storeNews || '',
        data.personalNews || ''
      ]);
    }

    // 店舗ニュース・個人ニュースを一括更新（最新の行のみ）
    const lastRow = sheet.getLastRow();
    if (data.storeNews) {
      sheet.getRange(lastRow, 9).setValue(data.storeNews);
    }
    if (data.personalNews) {
      sheet.getRange(lastRow, 10).setValue(data.personalNews);
    }

    return { success: true };

  } catch (error) {
    return { success: false, error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 朝礼データ取得（当日分）
 */
function getChoreiData(storeName, date) {
  try {
    const ss = getSpreadsheet();
    const sheet = getSheet('朝礼');

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const dateIndex = headers.indexOf('日付');
    const storeIndex = headers.indexOf('店舗名');
    const castNameIndex = headers.indexOf('キャスト名');
    const contractTimeIndex = headers.indexOf('契約時間');
    const pickupIndex = headers.indexOf('送迎');
    const goalMemoIndex = headers.indexOf('目標メモ(キャスト)');
    const managerMemoIndex = headers.indexOf('目標メモ(店責)');
    const storeNewsIndex = headers.indexOf('店舗ニュース');
    const personalNewsIndex = headers.indexOf('個人ニュース');

    const targetDate = date ? new Date(date) : getBusinessDate();
    const targetDateStr = formatDate(targetDate);

    const casts = [];
    let storeNews = '';
    let personalNews = '';

    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][dateIndex];
      const rowDateStr = rowDate instanceof Date ?
        Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy/MM/dd') : rowDate;

      if (rowDateStr === targetDateStr && data[i][storeIndex] === storeName) {
        casts.push({
          castName: data[i][castNameIndex],
          contractTime: data[i][contractTimeIndex],
          pickup: data[i][pickupIndex] === '✓',
          goalMemo: data[i][goalMemoIndex],
          managerMemo: data[i][managerMemoIndex]
        });

        if (data[i][storeNewsIndex]) {
          storeNews = data[i][storeNewsIndex];
        }
        if (data[i][personalNewsIndex]) {
          personalNews = data[i][personalNewsIndex];
        }
      }
    }

    return {
      success: true,
      casts: casts,
      storeNews: storeNews,
      personalNews: personalNews,
      date: targetDateStr
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * キャスト用目標入力
 */
function saveCastGoal(storeName, castName, goal) {
  const lock = getLock();
  try {
    lock.waitLock(10000);

    const ss = getSpreadsheet();
    const sheet = getSheet('朝礼');

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const dateIndex = headers.indexOf('日付');
    const storeIndex = headers.indexOf('店舗名');
    const castNameIndex = headers.indexOf('キャスト名');
    const goalMemoIndex = headers.indexOf('目標メモ(キャスト)');

    const businessDate = getBusinessDate();
    const targetDateStr = formatDate(businessDate);

    // 既存のデータを検索して更新
    let found = false;
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][dateIndex];
      const rowDateStr = rowDate instanceof Date ?
        Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy/MM/dd') : rowDate;

      if (rowDateStr === targetDateStr &&
          data[i][storeIndex] === storeName &&
          data[i][castNameIndex] === castName) {
        sheet.getRange(i + 1, goalMemoIndex + 1).setValue(goal);
        found = true;
        break;
      }
    }

    // 新規行を追加
    if (!found) {
      sheet.appendRow([
        new Date(),
        targetDateStr,
        storeName,
        castName,
        '', '', // 契約時間、送迎
        goal,  // 目標メモ
        '', '', '', ''
      ]);
    }

    return { success: true };

  } catch (error) {
    return { success: false, error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * キャスト用目標取得
 */
function getCastGoal(storeName, castName) {
  try {
    const result = getChoreiData(storeName);
    if (!result.success) {
      return result;
    }

    const castData = result.casts.find(c => c.castName === castName);

    return {
      success: true,
      goal: castData ? castData.goalMemo : '',
      date: result.date
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * 店責用メモ更新
 */
function updateManagerMemo(storeName, castName, memo) {
  const lock = getLock();
  try {
    lock.waitLock(10000);

    const ss = getSpreadsheet();
    const sheet = getSheet('朝礼');

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const dateIndex = headers.indexOf('日付');
    const storeIndex = headers.indexOf('店舗名');
    const castNameIndex = headers.indexOf('キャスト名');
    const managerMemoIndex = headers.indexOf('目標メモ(店責)');

    const businessDate = getBusinessDate();
    const targetDateStr = formatDate(businessDate);

    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][dateIndex];
      const rowDateStr = rowDate instanceof Date ?
        Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy/MM/dd') : rowDate;

      if (rowDateStr === targetDateStr &&
          data[i][storeIndex] === storeName &&
          data[i][castNameIndex] === castName) {
        sheet.getRange(i + 1, managerMemoIndex + 1).setValue(memo);
        return { success: true };
      }
    }

    return { success: false, error: '該当するキャストが見つかりません' };

  } catch (error) {
    return { success: false, error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
// 終礼関連
// =====================================================

/**
 * 終礼データ保存
 */
function saveShurei(data) {
  const lock = getLock();
  try {
    lock.waitLock(10000);

    const ss = getSpreadsheet();
    const sheet = getSheet('終礼');

    const businessDate = getBusinessDate();
    const timestamp = new Date();

    for (const cast of data.casts) {
      sheet.appendRow([
        timestamp,
        formatDate(businessDate),
        data.storeName,
        cast.castName,
        cast.drinkCount || 0,
        cast.sales || 0,
        cast.goalAchieved ? '達成' : '未達成',
        data.totalSales || 0
      ]);
    }

    return { success: true };

  } catch (error) {
    return { success: false, error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 終礼データ取得（当日分）
 */
function getShureiData(storeName, date) {
  try {
    const ss = getSpreadsheet();
    const sheet = getSheet('終礼');

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const dateIndex = headers.indexOf('日付');
    const storeIndex = headers.indexOf('店舗名');
    const castNameIndex = headers.indexOf('キャスト名');
    const drinkCountIndex = headers.indexOf('ドリンク杯数');
    const salesIndex = headers.indexOf('売上');
    const goalAchievedIndex = headers.indexOf('目標達成可否');
    const totalSalesIndex = headers.indexOf('店舗全体売上');

    const targetDate = date ? new Date(date) : getBusinessDate();
    const targetDateStr = formatDate(targetDate);

    const casts = [];
    let totalSales = 0;

    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][dateIndex];
      const rowDateStr = rowDate instanceof Date ?
        Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy/MM/dd') : rowDate;

      if (rowDateStr === targetDateStr && data[i][storeIndex] === storeName) {
        casts.push({
          castName: data[i][castNameIndex],
          drinkCount: data[i][drinkCountIndex] || 0,
          sales: data[i][salesIndex] || 0,
          goalAchieved: data[i][goalAchievedIndex] === '達成'
        });

        if (data[i][totalSalesIndex]) {
          totalSales = data[i][totalSalesIndex];
        }
      }
    }

    return {
      success: true,
      casts: casts,
      totalSales: totalSales,
      date: targetDateStr
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * キャスト用実績閲覧（当日と累計のみ）
 */
function getCastPerformance(storeName, castName) {
  try {
    const ss = getSpreadsheet();
    const sheet = getSheet('終礼');

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const dateIndex = headers.indexOf('日付');
    const storeIndex = headers.indexOf('店舗名');
    const castNameIndex = headers.indexOf('キャスト名');
    const drinkCountIndex = headers.indexOf('ドリンク杯数');
    const salesIndex = headers.indexOf('売上');
    const goalAchievedIndex = headers.indexOf('目標達成可否');

    const businessDate = getBusinessDate();
    const targetDateStr = formatDate(businessDate);

    // 当日の実績
    let todayPerformance = null;

    // 月間累計
    let monthlyTotalSales = 0;
    let monthlyTotalDrinks = 0;

    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][dateIndex];
      const rowDateStr = rowDate instanceof Date ?
        Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy/MM/dd') : rowDate;

      if (data[i][storeIndex] === storeName &&
          data[i][castNameIndex] === castName) {

        const sales = data[i][salesIndex] || 0;
        const drinks = data[i][drinkCountIndex] || 0;

        // 月間累計に加算
        monthlyTotalSales += sales;
        monthlyTotalDrinks += drinks;

        // 当日の実績
        if (rowDateStr === targetDateStr) {
          todayPerformance = {
            sales: sales,
            drinkCount: drinks,
            goalAchieved: data[i][goalAchievedIndex] === '達成',
            date: targetDateStr
          };
        }
      }
    }

    return {
      success: true,
      today: todayPerformance,
      monthly: {
        totalSales: monthlyTotalSales,
        totalDrinks: monthlyTotalDrinks
      }
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// =====================================================
// 課題トラッカー関連
// =====================================================

/**
 * 課題一覧取得
 */
function getIssues(status) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('課題トラッカー');

    if (!sheet) {
      return { success: false, error: '課題トラッカーシートが見つかりません' };
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const idIndex = headers.indexOf('ID');
    const dateIndex = headers.indexOf('起票日');
    const storeIndex = headers.indexOf('店舗名');
    const reporterIndex = headers.indexOf('起票者');
    const contentIndex = headers.indexOf('内容');
    const statusIndex = headers.indexOf('ステータス');
    const fbIndex = headers.indexOf('FBコメント');
    const completedIndex = headers.indexOf('完了日');

    const issues = [];

    for (let i = 1; i < data.length; i++) {
      const rowStatus = data[i][statusIndex];

      if (!status || rowStatus === status) {
        issues.push({
          id: data[i][idIndex],
          date: data[i][dateIndex] instanceof Date ?
            Utilities.formatDate(data[i][dateIndex], CONFIG.TIMEZONE, 'yyyy/MM/dd') : data[i][dateIndex],
          storeName: data[i][storeIndex],
          reporter: data[i][reporterIndex],
          content: data[i][contentIndex],
          status: rowStatus,
          feedback: data[i][fbIndex],
          completedDate: data[i][completedIndex] instanceof Date ?
            Utilities.formatDate(data[i][completedIndex], CONFIG.TIMEZONE, 'yyyy/MM/dd') : data[i][completedIndex]
        });
      }
    }

    return { success: true, issues: issues };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * 課題追加
 */
function addIssue(storeName, reporter, content) {
  const lock = getLock();
  try {
    lock.waitLock(10000);

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('課題トラッカー');

    if (!sheet) {
      return { success: false, error: '課題トラッカーシートが見つかりません' };
    }

    // ID生成（現在時刻のミリ秒）
    const id = new Date().getTime().toString();
    const date = formatDate(getBusinessDate());

    sheet.appendRow([
      id,
      date,
      storeName,
      reporter,
      content,
      '未対応',
      '',
      ''
    ]);

    return { success: true, issueId: id };

  } catch (error) {
    return { success: false, error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 課題ステータス更新
 */
function updateIssueStatus(issueId, status, feedback) {
  const lock = getLock();
  try {
    lock.waitLock(10000);

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('課題トラッカー');

    if (!sheet) {
      return { success: false, error: '課題トラッカーシートが見つかりません' };
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const idIndex = headers.indexOf('ID');
    const statusIndex = headers.indexOf('ステータス');
    const fbIndex = headers.indexOf('FBコメント');
    const completedIndex = headers.indexOf('完了日');

    for (let i = 1; i < data.length; i++) {
      if (data[i][idIndex] == issueId) {
        sheet.getRange(i + 1, statusIndex + 1).setValue(status);

        if (feedback) {
          sheet.getRange(i + 1, fbIndex + 1).setValue(feedback);
        }

        if (status === '完了') {
          sheet.getRange(i + 1, completedIndex + 1).setValue(formatDate(getBusinessDate()));
        }

        return { success: true };
      }
    }

    return { success: false, error: '該当する課題が見つかりません' };

  } catch (error) {
    return { success: false, error: error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// =====================================================
// ダッシュボード関連（本部用）
// =====================================================

/**
 * 全店舗データ取得（ダッシュボード用）
 */
function getAllStoresData(date) {
  try {
    const ss = getSpreadsheet();

    // 店舗リスト取得
    const masterSheet = ss.getSheetByName('マスタ');
    const masterData = masterSheet.getDataRange().getValues();
    const storeNameIndex = masterData[0].indexOf('店舗名');

    const stores = [];
    for (let i = 1; i < masterData.length; i++) {
      if (masterData[i][storeNameIndex]) {
        stores.push(masterData[i][storeNameIndex]);
      }
    }

    // 朝礼・終礼データ取得
    const targetDateStr = date || formatDate(getBusinessDate());

    const choreiSheet = getSheet('朝礼');
    const shureiSheet = getSheet('終礼');

    const choreiData = choreiSheet.getDataRange().getValues();
    const shureiData = shureiSheet.getDataRange().getValues();

    const results = [];

    for (const storeName of stores) {
      // 朝礼データ
      const choreiHeaders = choreiData[0];
      const choreiDateIndex = choreiHeaders.indexOf('日付');
      const choreiStoreIndex = choreiHeaders.indexOf('店舗名');
      const choreiCastIndex = choreiHeaders.indexOf('キャスト名');

      // 終礼データ
      const shureiHeaders = shureiData[0];
      const shureiDateIndex = shureiHeaders.indexOf('日付');
      const shureiStoreIndex = shureiHeaders.indexOf('店舗名');
      const shureiCastIndex = shureiHeaders.indexOf('キャスト名');
      const shureiSalesIndex = shureiHeaders.indexOf('売上');
      const shureiTotalSalesIndex = shureiHeaders.indexOf('店舗全体売上');

      let castCount = 0;
      let totalSales = 0;

      for (let i = 1; i < choreiData.length; i++) {
        const rowDate = choreiData[i][choreiDateIndex];
        const rowDateStr = rowDate instanceof Date ?
          Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy/MM/dd') : rowDate;

        if (rowDateStr === targetDateStr && choreiData[i][choreiStoreIndex] === storeName) {
          castCount++;
        }
      }

      for (let i = 1; i < shureiData.length; i++) {
        const rowDate = shureiData[i][shureiDateIndex];
        const rowDateStr = rowDate instanceof Date ?
          Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy/MM/dd') : rowDate;

        if (rowDateStr === targetDateStr && shureiData[i][shureiStoreIndex] === storeName) {
          if (shureiData[i][shureiTotalSalesIndex]) {
            totalSales = shureiData[i][shureiTotalSalesIndex];
          }
        }
      }

      results.push({
        storeName: storeName,
        castCount: castCount,
        totalSales: totalSales,
        date: targetDateStr
      });
    }

    return { success: true, data: results };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

/**
 * 月間集計取得
 */
function getMonthlySummary(storeName) {
  try {
    const ss = getSpreadsheet();
    const sheet = getSheet('終礼');

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const dateIndex = headers.indexOf('日付');
    const storeIndex = headers.indexOf('店舗名');
    const salesIndex = headers.indexOf('売上');
    const drinkIndex = headers.indexOf('ドリンク杯数');
    const goalIndex = headers.indexOf('目標達成可否');

    // 現在の月を取得
    const currentMonth = Utilities.formatDate(getBusinessDate(), CONFIG.TIMEZONE, 'yyyy/MM');

    let totalSales = 0;
    let totalDrinks = 0;
    let achievedCount = 0;
    let totalCount = 0;

    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][dateIndex];
      const rowDateStr = rowDate instanceof Date ?
        Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy/MM') : '';

      if (rowDateStr === currentMonth &&
          (!storeName || data[i][storeIndex] === storeName)) {

        totalSales += data[i][salesIndex] || 0;
        totalDrinks += data[i][drinkIndex] || 0;
        totalCount++;

        if (data[i][goalIndex] === '達成') {
          achievedCount++;
        }
      }
    }

    return {
      success: true,
      summary: {
        month: currentMonth,
        totalSales: totalSales,
        totalDrinks: totalDrinks,
        achievedCount: achievedCount,
        totalCount: totalCount,
        achievementRate: totalCount > 0 ? Math.round((achievedCount / totalCount) * 100) : 0
      }
    };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}
