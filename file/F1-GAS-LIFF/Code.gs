/** 陪你久久 F1 GAS host for LIFF.
 * Health data and LINE access tokens stay in the browser and n8n.
 * Update WEB_APP_URL after creating a deployment; use it as the LINE LIFF endpoint.
 */
const APP = Object.freeze({
  title: '陪你久久｜健康紀錄',
  liffId: '2012665607-zDqqoaya',
  apiUrl: 'https://aidenwang2026.app.n8n.cloud/webhook/f1a/api',
  lineChatUrl: ''
});

function doGet(e) {
  const page = e && e.parameter && e.parameter.page === 'settings' ? 'Settings' : 'Index';
  const template = HtmlService.createTemplateFromFile(page);
  template.app = APP;
  return template.evaluate()
    .setTitle(APP.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
