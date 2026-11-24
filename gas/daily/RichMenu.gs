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
 * Image size must be exactly 2500x843 or 2500x1686 px (JPEG/PNG, <= 1 MB).
 */
const RICH_MENU_HEIGHT = 843;

function richMenuDefinitions_(liffId) {
  const liff = page => 'https://liff.line.me/' + liffId + (page ? '/?page=' + page : '');
  const area = (index, count, action) => ({
    bounds: {x: Math.round(2500 / count * index), y: 0, width: Math.round(2500 / count), height: RICH_MENU_HEIGHT},
    action
  });
  return {
    unbound: {
      size: {width: 2500, height: RICH_MENU_HEIGHT}, selected: true, name: 'unbound-v1', chatBarText: '綁定家人',
      areas: [area(0, 1, {type: 'uri', label: '綁定家人', uri: liff('bind')})]
    },
    bound: {
      size: {width: 2500, height: RICH_MENU_HEIGHT}, selected: true, name: 'bound-v1', chatBarText: '陪你久久',
      areas: [
        area(0, 3, {type: 'uri', label: '每日紀錄', uri: liff('daily')}),
        area(1, 3, {type: 'uri', label: '健康摘要', uri: liff('')}),
        area(2, 3, {type: 'message', label: '回診管理', text: '回診管理'})
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
