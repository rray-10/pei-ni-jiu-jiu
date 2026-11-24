/**
 * Rich Menu setup (run from the Apps Script editor, test OA only).
 *
 * Script Properties (Daily project):
 *   LINE_OA_ACCESS_TOKEN              Messaging API channel access token of the TEST OA
 *   LIFF_ID                           test LIFF ID used to build the button URLs
 *   RICH_MENU_UNBOUND_IMAGE_FILE_ID   Google Drive file ID of the unbound menu image
 *   RICH_MENU_BOUND_IMAGE_FILE_ID     Google Drive file ID of the bound menu image
 * Written by createRichMenus():
 *   UNBOUND_RICH_MENU_ID              OA default menu (everyone who is not bound)
 *   BOUND_RICH_MENU_ID                linked per user after binding, unlinked on unbind
 *
 */
/**
 * Layout follows the design files in Drive "01｜產品素材":
 *   unbound: rich_menu_unbound_v2_2500x843.png   (2 buttons)
 *   bound:   rich_menu_bound_v2_2500x1686.png    (5 buttons)
 * If you swap the images, adjust the bounds below. LINE accepts 2500x843 or 2500x1686, JPEG/PNG, up to 1 MB.
 */
function richMenuDefinitions_(liffId) {
  const liff = page => 'https://liff.line.me/' + liffId + (page ? '/?page=' + page : '');
  const uri = (label, page) => ({type: 'uri', label, uri: liff(page)});
  const text = label => ({type: 'message', label, text: label});
  const area = (x, y, width, height, action) => ({bounds: {x, y, width, height}, action});
  return {
    unbound: {
      size: {width: 2500, height: 843}, selected: true, name: 'unbound-v2', chatBarText: '綁定家人',
      areas: [
        area(0, 300, 1617, 543, text('介紹陪你久久')),        // handled by n8n (reply with an intro message)
        area(1617, 300, 883, 543, uri('建立照護家庭', 'bind'))
      ]
    },
    bound: {
      size: {width: 2500, height: 1686}, selected: true, name: 'bound-v2', chatBarText: '陪你久久',
      areas: [
        area(0, 398, 800, 1288, text('用藥打卡')),            // handled by n8n (medication check-in, not built yet)
        area(800, 398, 817, 592, uri('每日記錄', 'daily')),
        area(1617, 398, 883, 592, text('回診管理')),           // handled by n8n F3
        area(800, 990, 817, 696, uri('健康摘要', '')),
        area(1617, 990, 883, 696, uri('會員中心', 'member'))
      ]
    }
  };
}

function richMenuCall_(token, method, url, options) {
  const response = UrlFetchApp.fetch(url, Object.assign({method, muteHttpExceptions: true, headers: {Authorization: 'Bearer ' + token}}, options || {}));
  if (response.getResponseCode() !== 200) throw new Error('LINE API ' + response.getResponseCode() + ': ' + response.getContentText().slice(0, 200));
  return response.getContentText() ? JSON.parse(response.getContentText()) : {};
}

function richMenuCreate_(token, definition, fileId) {
  const created = richMenuCall_(token, 'post', 'https://api.line.me/v2/bot/richmenu',
    {contentType: 'application/json', payload: JSON.stringify(definition)});
  const blob = DriveApp.getFileById(fileId).getBlob();
  richMenuCall_(token, 'post', 'https://api-data.line.me/v2/bot/richmenu/' + created.richMenuId + '/content',
    {contentType: blob.getContentType(), payload: blob.getBytes()});
  return created.richMenuId;
}

/** Creates both menus, uploads images, stores the IDs and makes the unbound menu the OA default. */
function createRichMenus() {
  const props = PropertiesService.getScriptProperties();
  const need = key => props.getProperty(key) || (() => { throw new Error('Missing script property ' + key); })();
  const token = need('LINE_OA_ACCESS_TOKEN');
  const defs = richMenuDefinitions_(need('LIFF_ID'));
  const unbound = richMenuCreate_(token, defs.unbound, need('RICH_MENU_UNBOUND_IMAGE_FILE_ID'));
  const bound = richMenuCreate_(token, defs.bound, need('RICH_MENU_BOUND_IMAGE_FILE_ID'));
  richMenuCall_(token, 'post', 'https://api.line.me/v2/bot/user/all/richmenu/' + unbound);
  props.setProperties({UNBOUND_RICH_MENU_ID: unbound, BOUND_RICH_MENU_ID: bound});
  console.log('UNBOUND_RICH_MENU_ID=' + unbound + ' BOUND_RICH_MENU_ID=' + bound);
}

/** Manual check: which menu does this LINE user currently see? Pass the userId as argument when running. */
function checkUserRichMenu(uid) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_OA_ACCESS_TOKEN');
  console.log(JSON.stringify(richMenuCall_(token, 'get', 'https://api.line.me/v2/bot/user/' + encodeURIComponent(uid) + '/richmenu')));
}

/**
 * Manual check: is this LINE user an OA friend? Run from the editor with the userId (Members.lineUid) as argument.
 * 200 = friend, 404 = not a friend or blocked. A 404 for everybody usually means the OA token belongs to a different Provider.
 */
function checkUserFriend(uid) {
  const props = PropertiesService.getScriptProperties();
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(uid),
    {headers: {Authorization: 'Bearer ' + props.getProperty('LINE_OA_ACCESS_TOKEN')}, muteHttpExceptions: true});
  console.log('REQUIRE_OA_FRIEND=' + props.getProperty('REQUIRE_OA_FRIEND') + ' status=' + response.getResponseCode() + ' ' + response.getContentText().slice(0, 120));
}
