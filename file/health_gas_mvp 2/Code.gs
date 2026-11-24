/** Health Helper GAS MVP — DEMO ONLY. No authentication. Do not use real patient data. */
const CONFIG = { spreadsheetId: '', demoUserId: 'u_demo_01' };
const HEADERS = {
 Users:['user_id','line_user_id','display_name'],
 Patients:['patient_id','name','birth_year','conditions','allergies'],
 PatientMembers:['patient_id','user_id','role','status'],
 BPRecords:['record_id','patient_id','measured_at','systolic','diastolic'],
 GlucoseRecords:['record_id','patient_id','measured_at','value','context'],
 Medications:['medication_id','patient_id','name','dose','schedule_per_day'],
 MedicationRecords:['record_id','patient_id','medication_id','scheduled_at','reported_at','status'],
 Appointments:['appointment_id','patient_id','scheduled_at','department','hospital'],
 Questions:['question_id','patient_id','content']
};
function doGet(){return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('陪你久久｜健康摘要').addMetaTag('viewport','width=device-width, initial-scale=1');}
function include(name){return HtmlService.createHtmlOutputFromFile(name).getContent();}
function ss_(){ const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || CONFIG.spreadsheetId; if(!id) throw new Error('尚未設定 SPREADSHEET_ID，請先執行 setupDemoSpreadsheet()');return SpreadsheetApp.openById(id);}
function read_(name){const sheet=ss_().getSheetByName(name);if(!sheet)throw new Error('找不到工作表 '+name);const values=sheet.getDataRange().getValues();const heads=values.shift();return values.filter(row=>row.some(v=>v!==''&&v!==null)).map(row=>Object.fromEntries(heads.map((h,i)=>[h,row[i] instanceof Date?row[i].toISOString():row[i]])));}
function localDate_(d){return Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy-MM-dd');}
function dateAt_(daysAgo,hour=8){let d=new Date();d.setDate(d.getDate()-daysAgo);d.setHours(hour,10,0,0);return d;}
function setupDemoSpreadsheet(){
 const ss=SpreadsheetApp.create('陪你久久_健康儀表板_虛構測試資料');
 PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID',ss.getId());
 const first=ss.getSheets()[0];first.setName('Users');
 Object.entries(HEADERS).forEach(([name,cols])=>{const s=ss.getSheetByName(name)||ss.insertSheet(name);s.clear();s.getRange(1,1,1,cols.length).setValues([cols]);s.setFrozenRows(1);s.getRange(1,1,1,cols.length).setFontWeight('bold').setBackground('#e2f1e6');});
 const rows={Users:[['u_demo_01','','王小姐（測試）']],Patients:[['p_demo_01','王伯伯',1958,'高血壓、糖尿病','盤尼西林'],['p_demo_02','王媽媽',1961,'高血壓','未填寫']],PatientMembers:[['p_demo_01','u_demo_01','caregiver','active'],['p_demo_02','u_demo_01','caregiver','active']],BPRecords:[],GlucoseRecords:[],Medications:[['m1','p_demo_01','Amlodipine','5 mg',1],['m2','p_demo_01','Metformin','500 mg',2],['m3','p_demo_02','Amlodipine','5 mg',1]],MedicationRecords:[],Appointments:[['a1','p_demo_01',dateAt_(-12,9),'新陳代謝科','測試醫院'],['a2','p_demo_02',dateAt_(-20,10),'心臟內科','測試醫院']],Questions:[['q1','p_demo_01','最近早上頭暈，想詢問醫師是否與用藥有關。'],['q2','p_demo_01','飯後血糖的紀錄應如何解讀？']]};
 for(let i=89;i>=0;i--){
  for(const [pi,p] of ['p_demo_01','p_demo_02'].entries()){
   if(i%3!==0){rows.BPRecords.push(['bp_'+p+'_'+i,p,dateAt_(i),122+pi*4+(i*7)%30,75+(i*3)%17]);rows.GlucoseRecords.push(['g_'+p+'_'+i,p,dateAt_(i,7),95+(i*11)%55,i%2?'空腹':'飯後']);}
   const meds=pi===0?['m1','m2']:['m3'];for(const m of meds){const n=m==='m2'?2:1;for(let j=0;j<n;j++){const scheduled=dateAt_(i,j?19:8);const taken=i%7!==0;rows.MedicationRecords.push(['mr_'+p+'_'+m+'_'+i+'_'+j,p,m,scheduled,taken?new Date(scheduled.getTime()+25*60000):' ',taken?'taken':'missed']);}}
  }
 }
 Object.entries(rows).forEach(([name,data])=>{if(data.length)ss.getSheetByName(name).getRange(2,1,data.length,HEADERS[name].length).setValues(data);});
 Logger.log('DEMO SHEET URL: '+ss.getUrl());return ss.getUrl();
}
function getDemoBootstrap(){return {demo:true,user:{id:CONFIG.demoUserId,name:'王小姐（測試）'},patients:read_('PatientMembers').filter(r=>r.user_id===CONFIG.demoUserId&&r.status==='active').map(m=>{const p=read_('Patients').find(x=>x.patient_id===m.patient_id);return p?{id:p.patient_id,name:p.name,role:m.role}:null;}).filter(Boolean)};}
function allowed_(patientId){return read_('PatientMembers').some(m=>m.user_id===CONFIG.demoUserId&&m.patient_id===patientId&&m.status==='active');}
function records_(name,patientId,days){const cutoff=Date.now()-Number(days)*86400000;const field=name==='BPRecords'||name==='GlucoseRecords'?'measured_at':name==='MedicationRecords'?'scheduled_at':'scheduled_at';return read_(name).filter(r=>r.patient_id===patientId&&new Date(r[field]).getTime()>=cutoff&&new Date(r[field]).getTime()<=Date.now());}
function avg_(a){return a.length?Math.round(a.reduce((s,x)=>s+Number(x),0)/a.length):null;}
function getDashboardData(patientId,days){days=Number(days);if(![7,30,90].includes(days))throw new Error('期間無效');if(!allowed_(patientId))throw new Error('無權存取');
 const p=read_('Patients').find(x=>x.patient_id===patientId);if(!p)throw new Error('找不到患者');
 const bp=records_('BPRecords',patientId,days).sort((a,b)=>new Date(a.measured_at)-new Date(b.measured_at));const glucose=records_('GlucoseRecords',patientId,days).sort((a,b)=>new Date(a.measured_at)-new Date(b.measured_at));const med=records_('MedicationRecords',patientId,days);const taken=med.filter(x=>x.status==='taken').length;
 const appointments=read_('Appointments').filter(x=>x.patient_id===patientId&&new Date(x.scheduled_at)>new Date()).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));const next=appointments[0]||null;
 const latest=bp.length?bp[bp.length-1]:null;
 return {patient:{id:p.patient_id,name:p.name,birthYear:p.birth_year,conditions:p.conditions,allergies:p.allergies},days,latestBP:latest,bpAverage:{sys:avg_(bp.map(x=>x.systolic)),dia:avg_(bp.map(x=>x.diastolic))},glucoseAverage:avg_(glucose.map(x=>x.value)),medication:{taken,total:med.length,rate:med.length?Math.round(100*taken/med.length):null},nextAppointment:next,bp,glucose,medications:read_('Medications').filter(x=>x.patient_id===patientId),questions:read_('Questions').filter(x=>x.patient_id===patientId).map(x=>x.content),generatedAt:new Date().toISOString()};
}
function getVisitSummary(patientId,days){const d=getDashboardData(patientId,days);const stats=a=>a.length?{min:Math.min(...a),max:Math.max(...a)}:{min:null,max:null};return {...d,bpSysStats:stats(d.bp.map(x=>Number(x.systolic))),bpDiaStats:stats(d.bp.map(x=>Number(x.diastolic))),glucoseStats:stats(d.glucose.map(x=>Number(x.value)))};}
function generateVisitPdf(patientId,days){const d=getVisitSummary(patientId,days);const template=HtmlService.createTemplateFromFile('PdfTemplate');template.data=d;const html=template.evaluate().getContent();const pdf=Utilities.newBlob(html,'text/html','summary.html').getAs(MimeType.PDF).setName('健康摘要_'+patientId+'_'+days+'天.pdf');return {filename:pdf.getName(),base64:Utilities.base64Encode(pdf.getBytes())};}
