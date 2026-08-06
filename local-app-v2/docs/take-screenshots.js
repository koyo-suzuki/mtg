const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'http://localhost:3001';
const OUT = path.join(__dirname, 'images');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  // 1. Login screen
  await page.goto(BASE);
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, '01_login.png') });
  console.log('01_login.png');

  // Login as cast (かほ)
  const accounts = await page.$$('.account-item');
  // Find かほ
  for (const acc of accounts) {
    const name = await acc.$eval('.account-name', el => el.textContent);
    if (name.includes('かほ')) {
      await acc.click();
      break;
    }
  }
  await sleep(500);

  // 2. Store selection
  await page.screenshot({ path: path.join(OUT, '02_store_select.png') });
  console.log('02_store_select.png');

  // Select first store
  const storeItems = await page.$$('.store-item');
  if (storeItems.length > 0) {
    await storeItems[0].click();
  }
  await sleep(1000);

  // 3. Cast - input tab
  await page.screenshot({ path: path.join(OUT, '03_cast_input.png') });
  console.log('03_cast_input.png');

  // 4. Cast - chorei tab
  const castTabs = await page.$$('#castTabBar .tab-btn');
  for (const tab of castTabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('朝礼')) {
      await tab.click();
      break;
    }
  }
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '04_cast_chorei.png') });
  console.log('04_cast_chorei.png');

  // 5. Cast - shurei tab
  for (const tab of castTabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('終礼')) {
      await tab.click();
      break;
    }
  }
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '05_cast_shurei.png') });
  console.log('05_cast_shurei.png');

  // 6. Cast - evaluation tab
  for (const tab of castTabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('振り返り')) {
      await tab.click();
      break;
    }
  }
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '06_cast_eval.png') });
  console.log('06_cast_eval.png');

  // 7. Cast - message board tab
  for (const tab of castTabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('伝言板')) {
      await tab.click();
      break;
    }
  }
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '07_cast_dengon.png') });
  console.log('07_cast_dengon.png');

  // Go back to login
  await page.click('#castBack');
  await sleep(500);
  await page.click('#castStoreBack');
  await sleep(500);

  // Login as manager (あおい)
  const accounts2 = await page.$$('.account-item');
  for (const acc of accounts2) {
    const name = await acc.$eval('.account-name', el => el.textContent);
    if (name.includes('あおい')) {
      await acc.click();
      break;
    }
  }
  await sleep(500);

  // Select first store
  const storeItems2 = await page.$$('.store-item');
  if (storeItems2.length > 0) {
    await storeItems2[0].click();
  }
  await sleep(1000);

  // 8. Manager - chorei tab
  await page.screenshot({ path: path.join(OUT, '08_manager_chorei.png'), fullPage: true });
  console.log('08_manager_chorei.png');

  // 9. Manager - shurei tab
  const mgrTabs = await page.$$('#managerTabBar .tab-btn');
  for (const tab of mgrTabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('終礼')) {
      await tab.click();
      break;
    }
  }
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '09_manager_shurei.png'), fullPage: true });
  console.log('09_manager_shurei.png');

  // 10. Manager - pickup tab
  for (const tab of mgrTabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('送迎')) {
      await tab.click();
      break;
    }
  }
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '10_manager_pickup.png') });
  console.log('10_manager_pickup.png');

  // 11. Manager - message board tab
  for (const tab of mgrTabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text.includes('伝言板')) {
      await tab.click();
      break;
    }
  }
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, '11_manager_dengon.png'), fullPage: true });
  console.log('11_manager_dengon.png');

  await browser.close();
  console.log('Done!');
})();
