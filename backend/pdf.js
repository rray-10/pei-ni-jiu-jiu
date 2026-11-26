'use strict';
// 就診摘要 PDF（Node 版，取代 GAS 的 PdfTemplate）。中文字型為 Noto Sans TC（SIL OFL，見 backend/fonts/OFL.txt）。
const path = require('node:path');
const PDFDocument = require('pdfkit');

const FONT = path.join(__dirname, 'fonts', 'NotoSansTC-Regular.ttf');
const dash = v => (v === null || v === undefined || v === '' ? '—' : String(v));
const LEFT = 48, WIDTH = 499;

// 產生時間用台北時間，避免顯示 UTC 的 ISO 字串
function taipeiStamp(value) {
  const d = new Date(value);
  if (isNaN(d)) return dash(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function renderVisitPdf(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size: 'A4', margin: 48, info: {Title: '陪你久久｜就診健康摘要'}});
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('zh', FONT);
    doc.font('zh');

    // 每一行都明確指定 x，避免表格之後的文字沿用上一個欄位的位置
    const heading = text => { doc.moveDown(0.8).fontSize(13).fillColor('#38775c').text(text, LEFT, doc.y, {width: WIDTH}).moveDown(0.3); doc.fillColor('#26382f').fontSize(11); };
    const line = text => doc.text(text, LEFT, doc.y, {width: WIDTH});

    doc.fontSize(18).fillColor('#38775c').text('陪你久久｜就診健康摘要', LEFT, 48, {width: WIDTH});
    doc.fontSize(11).fillColor('#26382f').moveDown(0.3);
    line(`患者：${dash(d.patient.name)}　｜　最近 ${d.days} 天`);
    line(`產生時間：${taipeiStamp(d.generatedAt)}`);

    heading('基本資料');
    line(`出生年份：${dash(d.patient.birthYear)}`);
    line(`慢性病：${d.patient.conditions || '未填寫'}`);
    line(`過敏史：${d.patient.allergies || '未填寫'}`);

    heading('健康紀錄統計');
    const rows = [
      ['項目', '平均', '最高', '最低'],
      ['收縮壓', dash(d.bpAverage.sys), dash(d.bpSysStats.max), dash(d.bpSysStats.min)],
      ['舒張壓', dash(d.bpAverage.dia), dash(d.bpDiaStats.max), dash(d.bpDiaStats.min)],
      ['血糖', dash(d.glucoseAverage), dash(d.glucoseStats.max), dash(d.glucoseStats.min)]
    ];
    const colX = [48, 200, 320, 440];
    rows.forEach((row, i) => {
      const y = doc.y;
      row.forEach((cell, j) => doc.text(cell, colX[j], y, {width: 100, continued: false}));
      doc.x = LEFT;
      doc.moveDown(0.6);
      if (i === 0) doc.moveTo(48, doc.y - 4).lineTo(540, doc.y - 4).strokeColor('#cfe0d6').stroke();
    });
    doc.moveDown(0.4);
    doc.x = LEFT;
    line(`用藥回報：${d.medication.taken} / ${d.medication.total} 次（${dash(d.medication.rate)}%）`);
    line('注意：用藥回報不等於實際服藥。');

    heading('目前登錄藥物');
    if (d.medications && d.medications.length) {
      d.medications.forEach(m => line(`・${m.name} ${m.dose}（每日預定 ${m.schedule_per_day} 次）`));
    } else {
      line('尚無藥物資料');
    }

    heading('想詢問醫師的問題');
    if (d.questions && d.questions.length) d.questions.forEach((q, i) => line(`${i + 1}. ${q}`));
    else line('尚無問題');

    doc.moveDown(1).fontSize(9).fillColor('#777777')
      .text('此摘要依使用者自行輸入的紀錄產生，僅供就診參考，不代表醫療診斷。用藥回報不等於實際服藥。', LEFT, doc.y, {width: WIDTH});
    doc.end();
  });
}

module.exports = {renderVisitPdf};
