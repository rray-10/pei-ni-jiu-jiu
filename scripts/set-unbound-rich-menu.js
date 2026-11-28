#!/usr/bin/env node
'use strict';
// 建立新的「未綁定」圖文選單並設為官方帳號預設（所有未綁定使用者看到的選單）。
// 不動綁定選單，不刪除舊選單（舊的請在確認後手動刪除，見下方輸出）。
//
// 圖片來源：Google Drive「01｜產品素材：LOGO、Rich Menu」的 rich_menu_unbound_v2_2500x843.png
// 請先下載到本機，不要放進 repo（圖片以 Drive 為準）。
//
// 環境變數：
//   LINE_OA_ACCESS_TOKEN   官方帳號的 Channel access token（只放本機終端機，不要貼到聊天或 repo）
//   UNBOUND_IMAGE          本機圖檔路徑（PNG 或 JPEG，2500×843，≤1MB）
//   LIFF_ID                （可選）保留給 LIFF 連結用，目前未綁定選單不用
//   DRY_RUN=1              只列出將送出的內容，不呼叫 LINE
//
// 範例：
//   UNBOUND_IMAGE=~/Downloads/rich_menu_unbound_v2_2500x843.png node scripts/set-unbound-rich-menu.js
//   DRY_RUN=1 UNBOUND_IMAGE=~/Downloads/rich_menu_unbound_v2_2500x843.png node scripts/set-unbound-rich-menu.js

const {readFileSync, statSync} = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const UNBOUND_URL = 'https://sophiepm23.github.io/care99/';
const BIND_URL = 'https://liff.line.me/' + (process.env.LIFF_ID || '2012665607-u1QJZaMC') + '/?page=bind';

// 版面與 backend/richmenu.js 的未綁定選單一致（2500×843，左：介紹網址，右：建立照護家庭）
const definition = {
  size: {width: 2500, height: 843},
  selected: true,
  name: 'unbound-v3-care99',
  chatBarText: '綁定家人',
  areas: [
    {bounds: {x: 0, y: 300, width: 1617, height: 543}, action: {type: 'uri', label: '介紹陪你久久', uri: UNBOUND_URL}},
    {bounds: {x: 1617, y: 300, width: 883, height: 543}, action: {type: 'uri', label: '建立照護家庭', uri: BIND_URL}}
  ]
};

function localPath(value) {
  if (!value) throw new Error('缺少 UNBOUND_IMAGE（本機圖檔路徑）');
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
}

async function lineCall(token, method, url, body, contentType = 'application/json') {
  const response = await fetch(url, {method, headers: {Authorization: 'Bearer ' + token, 'Content-Type': contentType},
    body: body === undefined ? undefined : (Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body))});
  const text = await response.text();
  if (!response.ok) throw new Error('LINE API ' + response.status + ': ' + text.slice(0, 200));
  return text ? JSON.parse(text) : {};
}

(async () => {
  const file = localPath(process.env.UNBOUND_IMAGE);
  const size = statSync(file).size;
  const ext = path.extname(file).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) throw new Error('圖檔必須是 PNG 或 JPEG');
  if (size > 1024 * 1024) throw new Error('圖檔超過 1MB（LINE 限制）');
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  if (process.env.DRY_RUN === '1') {
    console.log('DRY_RUN：不會呼叫 LINE。');
    console.log('圖檔：' + file + '（' + Math.round(size / 1024) + ' KB，' + contentType + '）');
    console.log(JSON.stringify(definition, null, 2));
    console.log('將會：建立選單 → 上傳圖片 → 設為官方帳號預設（user/all）。');
    return;
  }

  const token = process.env.LINE_OA_ACCESS_TOKEN;
  if (!token) throw new Error('缺少 LINE_OA_ACCESS_TOKEN');

  // 1. 建立選單
  const created = await lineCall(token, 'POST', 'https://api.line.me/v2/bot/richmenu', definition);
  const id = created.richMenuId;
  // 2. 上傳圖片
  await lineCall(token, 'POST', `https://api-data.line.me/v2/bot/richmenu/${id}/content`, readFileSync(file), contentType);
  // 3. 設為預設（未綁定使用者看到的選單）
  await lineCall(token, 'POST', `https://api.line.me/v2/bot/user/all/richmenu/${id}`);

  console.log('新的未綁定選單已設為預設：' + id);
  console.log('綁定選單與 Render 的 BOUND_RICH_MENU_ID 不需要改。');

  // 列出同名的舊選單，供你確認後手動刪除（這支腳本不刪除）
  const list = await lineCall(token, 'GET', 'https://api.line.me/v2/bot/richmenu/list');
  const olds = (list.richmenus || []).filter(m => m.name.startsWith('unbound') && m.richMenuId !== id);
  if (olds.length) {
    console.log('\n舊的未綁定選單（確認新的生效後再刪除，刪除不能復原）：');
    for (const m of olds) console.log('  curl -X DELETE -H "Authorization: Bearer $LINE_OA_ACCESS_TOKEN" https://api.line.me/v2/bot/richmenu/' + m.richMenuId);
  }
})().catch(error => { console.error(error.message); process.exit(1); });
