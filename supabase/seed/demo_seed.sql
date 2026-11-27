-- 假資料（測試用）。在 Supabase SQL Editor 執行；可重複執行（已用 on conflict 處理）。
insert into metric_definitions (metric_key,metric_name,input_type,unit,is_active) values
('blood_pressure','血壓','bloodPressure','mmHg',true),('blood_glucose','血糖','number','mg/dL',true)
on conflict (metric_key) do nothing;
insert into families (family_id,patient_name,birth_year,conditions,allergies,created_for) values ('F_DEMO0001','測試阿嬤',1956,'高血壓、糖尿病','青黴素','self') on conflict (family_id) do nothing;
insert into family_patients (family_id,patient_id) values ('F_DEMO0001','P_DEMO0001') on conflict (family_id) do nothing;
insert into members (line_uid,family_id,role,display_name) values ('DEMO-ADMIN-NOT-A-LINE-UID','F_DEMO0001','admin','測試管理者') on conflict (line_uid) do nothing;
insert into tracking_settings (family_id,metric_key,enabled,metric_name,unit,systolic_low,systolic_high,diastolic_low,diastolic_high,alert_low,alert_high,updated_by) values
('F_DEMO0001','blood_pressure',true,'血壓','mmHg',100,140,60,90,null,null,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001','blood_glucose',true,'血糖','mg/dL',null,null,null,null,80,140,'DEMO-ADMIN-NOT-A-LINE-UID')
on conflict (family_id,metric_key) do nothing;
insert into medications (medication_id,family_id,name,dose,schedule_per_day,times,note,active,created_by) values
('M_DEMO0001','F_DEMO0001','降血壓藥','10mg',2,'早餐後、睡前','飯後吃',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('M_DEMO0002','F_DEMO0001','降血糖藥','1 顆',1,'早餐後',null,true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('M_DEMO0003','F_DEMO0001','舊藥（已停用）','5mg',1,'晚餐後',null,false,'DEMO-ADMIN-NOT-A-LINE-UID')
on conflict (medication_id) do nothing;
insert into daily_records (record_id,family_id,patient_id,line_uid,recorded_at,record_date,period,metric_key,metric_name,value,value_numeric,value_systolic,value_diastolic,unit,note,source,is_recorded,created_by) values
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261029:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-10-29T08:00:00+08:00','2026-10-29','morning','blood_pressure','血壓','113/88',null,113,88,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261030:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-10-30T08:00:00+08:00','2026-10-30','morning','blood_pressure','血壓','120/79',null,120,79,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261031:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-10-31T08:00:00+08:00','2026-10-31','morning','blood_pressure','血壓','129/74',null,129,74,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261031:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-10-31T07:30:00+08:00','2026-10-31','morning','blood_glucose','血糖','109',109,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261101:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-01T08:00:00+08:00','2026-11-01','morning','blood_pressure','血壓','121/82',null,121,82,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261102:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-02T08:00:00+08:00','2026-11-02','morning','blood_pressure','血壓','119/78',null,119,78,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261103:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-03T08:00:00+08:00','2026-11-03','morning','blood_pressure','血壓','114/75',null,114,75,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261103:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-03T07:30:00+08:00','2026-11-03','morning','blood_glucose','血糖','147',147,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261104:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-04T08:00:00+08:00','2026-11-04','morning','blood_pressure','血壓','113/75',null,113,75,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261105:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-05T08:00:00+08:00','2026-11-05','morning','blood_pressure','血壓','135/76',null,135,76,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261106:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-06T08:00:00+08:00','2026-11-06','morning','blood_pressure','血壓','113/88',null,113,88,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261106:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-06T07:30:00+08:00','2026-11-06','morning','blood_glucose','血糖','150',150,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261107:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-07T08:00:00+08:00','2026-11-07','morning','blood_pressure','血壓','116/70',null,116,70,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261108:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-08T08:00:00+08:00','2026-11-08','morning','blood_pressure','血壓','113/84',null,113,84,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261109:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-09T08:00:00+08:00','2026-11-09','morning','blood_pressure','血壓','128/88',null,128,88,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261109:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-09T07:30:00+08:00','2026-11-09','morning','blood_glucose','血糖','157',157,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261110:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-10T08:00:00+08:00','2026-11-10','morning','blood_pressure','血壓','135/78',null,135,78,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261111:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-11T08:00:00+08:00','2026-11-11','morning','blood_pressure','血壓','127/71',null,127,71,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261112:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-12T08:00:00+08:00','2026-11-12','morning','blood_pressure','血壓','128/71',null,128,71,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261112:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-12T07:30:00+08:00','2026-11-12','morning','blood_glucose','血糖','148',148,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261113:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-13T08:00:00+08:00','2026-11-13','morning','blood_pressure','血壓','137/77',null,137,77,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261114:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-14T08:00:00+08:00','2026-11-14','morning','blood_pressure','血壓','137/86',null,137,86,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261115:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-15T08:00:00+08:00','2026-11-15','morning','blood_pressure','血壓','117/82',null,117,82,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261115:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-15T07:30:00+08:00','2026-11-15','morning','blood_glucose','血糖','120',120,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261116:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-16T08:00:00+08:00','2026-11-16','morning','blood_pressure','血壓','138/74',null,138,74,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261117:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-17T08:00:00+08:00','2026-11-17','morning','blood_pressure','血壓','120/83',null,120,83,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261118:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-18T08:00:00+08:00','2026-11-18','morning','blood_pressure','血壓','128/74',null,128,74,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261118:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-18T07:30:00+08:00','2026-11-18','morning','blood_glucose','血糖','146',146,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261119:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-19T08:00:00+08:00','2026-11-19','morning','blood_pressure','血壓','132/77',null,132,77,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261120:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-20T08:00:00+08:00','2026-11-20','morning','blood_pressure','血壓','121/86',null,121,86,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261121:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-21T08:00:00+08:00','2026-11-21','morning','blood_pressure','血壓','128/73',null,128,73,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261121:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-21T07:30:00+08:00','2026-11-21','morning','blood_glucose','血糖','122',122,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261122:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-22T08:00:00+08:00','2026-11-22','morning','blood_pressure','血壓','115/74',null,115,74,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261123:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-23T08:00:00+08:00','2026-11-23','morning','blood_pressure','血壓','122/72',null,122,72,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261124:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-24T08:00:00+08:00','2026-11-24','morning','blood_pressure','血壓','127/75',null,127,75,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261124:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-24T07:30:00+08:00','2026-11-24','morning','blood_glucose','血糖','161',161,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261125:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-25T08:00:00+08:00','2026-11-25','morning','blood_pressure','血壓','114/72',null,114,72,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261126:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-26T08:00:00+08:00','2026-11-26','morning','blood_pressure','血壓','112/71',null,112,71,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261127:bp','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-27T08:00:00+08:00','2026-11-27','morning','blood_pressure','血壓','138/79',null,138,79,'mmHg','','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID'),
('F_DEMO0001:DEMO-ADMIN-NOT-A-LINE-UID:seed20261127:gl','F_DEMO0001','P_DEMO0001','DEMO-ADMIN-NOT-A-LINE-UID','2026-11-27T07:30:00+08:00','2026-11-27','morning','blood_glucose','血糖','116',116,null,null,'mg/dL','空腹','LIFF',true,'DEMO-ADMIN-NOT-A-LINE-UID')
on conflict (record_id) do nothing;
insert into appointments (appt_id,patient_id,family_id,date,session,hospital,department,status) values
('APT_DEMO01','P_DEMO0001','F_DEMO0001','2026-11-30','09:00','台大醫院','心臟內科','scheduled'),
('APT_DEMO02','P_DEMO0001','F_DEMO0001','2026-12-18','14:00','榮總','新陳代謝科','scheduled'),
('APT_DEMO03','P_DEMO0001','F_DEMO0001','2026-11-13','10:00','長庚','眼科','cancelled')
on conflict (appt_id) do nothing;
insert into family_invites (code_hash,family_id,expires_at,claimed_by) values
('655b9c8bf3cd63141cc9aa41b8f8666d5aacf0032e8a9cd57ef0b3b1129e2dd0','F_DEMO0001','2026-12-27T23:59:00+08:00',null)
on conflict (code_hash) do nothing;
