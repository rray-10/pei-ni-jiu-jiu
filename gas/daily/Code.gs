function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const page = e && e.parameter && e.parameter.page === 'settings' ? 'Settings' : 'Index';
  const template = HtmlService.createTemplateFromFile(page);
  const apiUrl = props.getProperty('F1_API_URL') || '';
  template.app = {
    liffId: props.getProperty('LIFF_ID') || '',
    apiUrl: apiUrl,
    useGasRpc: !apiUrl,
    lineChatUrl: props.getProperty('LINE_CHAT_URL') || ''
  };
  return template.evaluate().setTitle('陪你久久｜健康紀錄')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
