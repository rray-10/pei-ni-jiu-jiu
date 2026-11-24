// 以 Playwright 渲染 GAS 版面（google.script.run 以 adapter + 虛構 fixture 模擬）。無 Playwright 時略過。
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { /* skip */ }
const { NOW, src } = require('./fixtures/fixture.js');
const D = (f) => fs.readFileSync(path.join(__dirname, '..', 'gas', 'dashboard', f), 'utf8');
const SHOTS = process.env.SHOT_DIR;
const browserOptions = process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {};

function renderTemplate(config) {
  const evalTpl = (t) => t
    .replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => evalTpl(D(n + '.html')))
    .replace(/<\?!= JSON\.stringify\(config\)[^?]*\?>/g, () => JSON.stringify(config).replace(/</g, '\\u003c'))
    .replace(/<\? if \(config\.liffId\) \{ \?>.*?<\? \} \?>/g, '')
    .replace(/<\?= config\.nav\.(\w+) \|\| '([^']*)' \?>/g, (_, k, fallback) => config.nav[k] || fallback)
    .replace(/<\?= config\.nav\.(\w+) \? '' : 'disabled' \?>/g, (_, k) => config.nav[k] ? '' : 'disabled');
  return evalTpl(D('Index.html'));
}
const bundle = ['health-adapter', 'dashboard-service'].map(f => fs.readFileSync(path.join(__dirname, '..', 'adapters', f + '.js'), 'utf8')).join('\n');

async function open(browser, viewport, uid, srcOverride, config) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); if (process.env.DEBUG_E2E) page.on('console', m => console.log('console:', m.text()));
  const mockJs = `(function(){var S=(0,eval)(${JSON.stringify(bundle)}+';DashboardService');var data=${JSON.stringify(srcOverride || src())},uid=${JSON.stringify(uid)},NOW=${JSON.stringify(NOW)};
    function mk(ok,bad){return {withSuccessHandler:function(f){return mk(f,bad);},withFailureHandler:function(f){return mk(ok,f);},
      getHubData:function(t,d){setTimeout(function(){try{var c=S.getSessionContext(data,uid);ok({context:c,dashboard:S.getDashboardData(data,uid,c.patients[0].id,d,NOW),meta:{devMode:true,timings:{totalMs:1}}});}catch(e){bad(e);}},5);},
      getDashboardData:function(t,p,d){setTimeout(function(){try{ok(S.getDashboardData(data,uid,p,d,NOW));}catch(e){bad(e);}},5);}};}
    window.google={script:{run:mk(function(){},function(){})}};})();`;
  await page.setContent(renderTemplate(config).replace('<head>', '<head><script>' + mockJs.replace(/<\/script/g, '<\\/script') + '</script>'), { waitUntil: 'load' });
  return { page, errors, ctx };
}
const cfg = { page: 'dashboard', liffId: '', devMode: true, nav: { daily: 'https://example.test/daily', member: '', medication: '' } };

test('桌面：側欄固定、儀表板顯示 F1 資料', { skip: !chromium }, async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const { page, errors } = await open(browser, { width: 1280, height: 800 }, 'U_TEST_A1', null, cfg);
    await page.waitForSelector('#app:not([hidden])');
    assert.equal(await page.textContent('#latestBP'), '124/78');
    assert.match(await page.textContent('#visitDetail'), /心臟內科/);
    assert.equal(await page.isVisible('#sidebar'), true);
    assert.equal(await page.isVisible('#menuBtn'), false);
    assert.equal(await page.isVisible('#devBanner'), true);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop.png') });
    await page.click('#periodTabs [data-days="30"]'); await page.waitForTimeout(100);
    assert.equal(await page.textContent('#latestBP'), '124/78');
    await page.click('#summaryBtn'); assert.equal(await page.isVisible('#summaryBody'), true);
    assert.match(await page.textContent('#summaryBody'), /測試阿嬤/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
test('手機：drawer 開關、無橫向捲動', { skip: !chromium }, async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const { page, errors } = await open(browser, { width: 375, height: 700 }, 'U_TEST_A1', null, cfg);
    await page.waitForSelector('#app:not([hidden])');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.isVisible('#menuBtn'), true);
    assert.equal((await page.locator('#sidebar').boundingBox()).x < 0, true);
    await page.click('#menuBtn');
    assert.equal(await page.locator('#menuBtn').getAttribute('aria-expanded'), 'true', JSON.stringify(errors));
    await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().left >= -0.5);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mobile-drawer.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('sidebar').getBoundingClientRect().right <= 0.5);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
test('狀態：未綁定使用者顯示錯誤訊息；空資料顯示「—」', { skip: !chromium }, async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    let { page } = await open(browser, { width: 375, height: 700 }, 'U_TEST_STRANGER', null, cfg);
    await page.waitForFunction(() => /尚未加入照護家庭/.test(document.getElementById('loading').textContent));
    assert.equal(await page.isVisible('#app'), false);
    const empty = src(); empty.dailyRecords = []; empty.appointments = [];
    ({ page } = await open(browser, { width: 375, height: 700 }, 'U_TEST_A1', empty, cfg));
    await page.waitForSelector('#app:not([hidden])');
    assert.equal(await page.textContent('#latestBP'), '—');
    assert.equal(await page.textContent('#nextVisit'), '—');
    assert.match(await page.textContent('#chart'), /尚無紀錄|沒有可繪製/);
  } finally { await browser.close(); }
});
if (process.env.DEBUG_E2E) test('debug', { skip: !chromium }, async () => {
  const browser = await chromium.launch(browserOptions);
  const { page } = await open(browser, { width: 1280, height: 800 }, 'U_TEST_A1', null, cfg);
  await page.waitForTimeout(1500);
  console.log('LOADING:', await page.textContent('#loading'), '| gs:', await page.evaluate(() => typeof google), '| cfg:', await page.evaluate(() => JSON.stringify(window.HUB_CONFIG)), '| msg:', await page.textContent('#message'));
  await browser.close();
});

test('未綁定的每日紀錄入口顯示綁定表單，建立後回到每日紀錄', { skip: !chromium }, async () => {
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await browser.newPage({viewport:{width:375,height:700}});
    const {render} = require('../frontend/server');
    await page.route('https://static.line-scdn.net/**', route => route.fulfill({contentType:'application/javascript',
      body:'window.liff={init:async()=>{},isLoggedIn:()=>true,getAccessToken:()=> "fixture-token"};'}));
    const fake = `
      window.fetch=async (url,opts)=>{
        const body=JSON.parse(opts.body);
        window.actions=(window.actions||[]).concat(body.action);
        if(body.action==='memberStatus')return Response.json({ok:true,bound:false});
        if(body.action==='createFamily')return Response.json({ok:true,bound:true,role:'admin'});
        if(body.action==='read')return Response.json({ok:true,familyId:'F_TEST_A',role:'admin',metrics:[{metricKey:'blood_glucose',metricName:'血糖',inputType:'number',isActive:true}],settings:{blood_glucose:true}});
        return Response.json({ok:false},{status:400});
      };
    `;
    await page.setContent(render('daily',{LIFF_ENDPOINT:'https://hub.example.test/',LIFF_ID:'fixture'})
      .replace('<head>','<head><script>'+fake+'</script>'));
    await page.getByRole('heading',{name:'綁定照護家庭'}).waitFor();
    assert.equal(await page.locator('#hubModule').isVisible(),false);
    await page.getByRole('textbox',{name:'希望家人在畫面上看到的稱呼'}).fill('測試本人');
    await page.getByRole('button',{name:'建立家庭'}).click();
    await page.locator('#recordForm').waitFor();
    assert.equal(await page.locator('#memberGate').isVisible(),false);
    assert.deepEqual(await page.evaluate(() => window.actions),['memberStatus','createFamily','read']);
  } finally {
    await browser.close();
  }
});
