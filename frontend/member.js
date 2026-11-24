'use strict';
window.hubSession = (async () => {
  const cfg = window.MEMBER_CONFIG;
  const $ = id => document.getElementById(id);
  const status = text => { $('memberStatus').textContent = text; };
  try {
    await liff.init({liffId:cfg.liffId});
    if (!liff.isLoggedIn()) {
      if (liff.isInClient()) throw new Error('請重新從 LINE 聊天開啟此頁。');
      liff.login();
      return false;
    }
    const accessToken = liff.getAccessToken();
    if (!accessToken) throw new Error('LINE 登入已失效，請重新開啟。');
    async function api(action, fields = {}) {
      const response = await fetch('/api/member',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,accessToken,...fields})});
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '家庭服務暫時無法使用');
      return result;
    }
    function showFamily(data) {
      $('onboarding').hidden = true;
      $('familyPanel').hidden = false;
      $('memberHeading').textContent = '會員中心';
      $('patientName').textContent = data.patientName;
      $('familyRole').textContent = data.role === 'admin' ? '家庭管理者' : '家人';
      $('invite').hidden = data.role !== 'admin';
      $('memberLinks').replaceChildren(...Object.entries(cfg.links).filter(([,url]) => url).map(([label,url]) => {
        const link = document.createElement('a');
        link.textContent = label;
        link.href = url;
        return link;
      }));
      $('retryMenu').hidden = data.menu !== 'retry';
      status(cfg.page === 'appointments' ? '請返回 LINE 官方帳號，傳送「回診管理」。' : '已綁定照護家庭');
    }
    function finish(data) {
      if (cfg.module) {
        $('memberGate').hidden = true;
        $('hubModule').hidden = false;
        return true;
      }
      showFamily(data);
      return false;
    }
    const data = await api('memberStatus');
    $('invite').onclick = async () => {
      $('invite').disabled = true;
      try {
        const result = await api('createInvite');
        $('inviteCode').textContent = result.inviteCode;
        status('請私下交給一位家人。邀請碼 24 小時內只能使用一次。');
      } catch (err) { status(err.message); }
      finally { $('invite').disabled = false; }
    };
    $('unbind').onclick = async () => {
      if (!window.confirm('解除綁定後，將無法再查看或記錄「' + $('patientName').textContent + '」的資料。確定要解除嗎？')) return;
      $('unbind').disabled = true;
      try {
        await api('unbind');
        status('已解除綁定，LINE 選單會恢復為未綁定樣式。請關閉此頁。');
        $('familyPanel').hidden = true;
        $('memberHeading').textContent = '已解除綁定';
      } catch (err) { status(err.message); $('unbind').disabled = false; }
    };
    $('retryMenu').onclick = async () => {
      $('retryMenu').disabled = true;
      try {
        const result = await api('syncMenu');
        $('retryMenu').hidden = result.menu !== 'retry';
        status(result.menu === 'linked' ? '已更新 LINE 選單' : 'LINE 選單更新未完成');
      } catch (err) { status(err.message); }
      finally { $('retryMenu').disabled = false; }
    };
    if (data.bound) return finish(data);
    $('onboarding').hidden = false;
    $('memberHeading').textContent = '綁定照護家庭';
    const show = id => {
      for (const name of ['choose','startFamily','joinFamily']) $(name).hidden = name !== id;
    };
    const step = (form, id) => {
      for (const fieldset of $(form).querySelectorAll('fieldset')) fieldset.hidden = fieldset.id !== id;
    };
    const disable = value => $('onboarding').querySelectorAll('button').forEach(button => { button.disabled = value; });
    const reset = () => {
      show('choose');
      step('startFamily','startStep1');
      step('joinFamily','joinStep1');
      status('請選擇為自己建立家庭，或輸入家人提供的邀請碼。');
    };
    reset();
    return await new Promise(resolve => {
      const complete = async (action, fields) => {
        disable(true);
        try {
          const result = await api(action,fields);
          if (cfg.module && result.menu === 'retry') {
            showFamily(result);
            status('家庭已綁定。可重試更新 LINE 選單，或繼續使用原本功能。');
            const next = document.createElement('button');
            next.textContent = '繼續';
            next.onclick = () => resolve(finish(result));
            $('familyPanel').append(next);
          } else {
            resolve(finish(result));
          }
        } catch (err) { status(err.message); }
        finally { disable(false); }
      };
      $('chooseStart').onclick = () => { show('startFamily'); step('startFamily','startStep1'); status('先填寫基本資料，下一步再選擇追蹤項目。'); };
      $('chooseJoin').onclick = () => { show('joinFamily'); step('joinFamily','joinStep1'); status('請輸入家人提供的邀請碼。'); };
      for (const button of $('onboarding').querySelectorAll('.back')) button.onclick = reset;
      $('backStep1').onclick = () => step('startFamily','startStep1');
      $('backJoin').onclick = () => step('joinFamily','joinStep1');
      $('toStep2').onclick = () => {
        const form = $('startFamily');
        const year = form.elements.birthYear.value.trim();
        if (!form.elements.patientName.value.trim()) { status('請輸入稱呼'); form.elements.patientName.focus(); return; }
        if (year && !/^\d{4}$/.test(year)) { status('出生年請輸入 4 位數西元年'); return; }
        step('startFamily','startStep2');
        status('請選擇要追蹤的項目。');
      };
      $('startFamily').onsubmit = event => {
        event.preventDefault();
        if (!$('startStep2').hidden) {
          const form = new FormData(event.currentTarget);
          const metrics = form.getAll('metric');
          if (!metrics.length) { status('請至少選擇一個追蹤項目'); return; }
          const thresholds = {};
          for (const [name, value] of form.entries()) {
            const [kind, metric, field] = name.split(':');
            if (kind !== 't' || value === '' || !metrics.includes(metric)) continue;
            (thresholds[metric] ||= {})[field] = Number(value);
          }
          const other = String(form.get('conditionOther') || '').trim();
          return complete('createFamily',{
            patientName:form.get('patientName'),birthYear:form.get('birthYear'),
            conditions:[...form.getAll('condition'),...(other ? [other] : [])],
            allergies:form.get('allergies'),metrics,thresholds
          });
        }
        $('toStep2').click();
      };
      $('joinFamily').onsubmit = async event => {
        event.preventDefault();
        const inviteCode = new FormData(event.currentTarget).get('inviteCode');
        if (!$('joinStep2').hidden) return complete('joinFamily',{inviteCode});
        disable(true);
        try {
          const result = await api('previewInvite',{inviteCode});
          $('joinPreview').textContent = '要加入「' + result.preview.patientName + '」的照護家庭嗎？';
          step('joinFamily','joinStep2');
          status('請確認家庭名稱。');
        } catch (err) { status(err.message); }
        finally { disable(false); }
      };
    });
  } catch (err) {
    status(err.message || '無法確認 LINE 與家庭身分');
    return false;
  }
})();
