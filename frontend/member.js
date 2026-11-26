'use strict';
window.hubSession = (async () => {
  const cfg = window.MEMBER_CONFIG;
  const $ = id => document.getElementById(id);
  const status = (text, kind = '') => {
    const el = $('memberStatus');
    el.textContent = text;
    el.className = kind;
    const friendUrl = cfg.links['回到 LINE 官方帳號'];
    if (friendUrl) $('addFriend').href = friendUrl;
    if (kind === 'error' && /加入官方帳號/.test(text) && friendUrl) $('addFriend').hidden = false;
  };
  const icon = name => '<svg class="ico" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  const linkIcons = {'健康摘要':'chart','每日紀錄':'edit','會員中心':'people'};
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
      $('avatar').textContent = Array.from(data.patientName || '')[0] || '';
      $('familyRole').innerHTML = data.role === 'admin' ? icon('crown') : '';
      $('familyRole').append(data.role === 'admin' ? '家庭管理者' : '家人');
      $('invite').hidden = data.role !== 'admin';
      $('inviteCard').hidden = data.role !== 'admin';
      $('memberLinks').replaceChildren(...Object.entries(cfg.links)
        .filter(([label,url]) => url && !(cfg.page === 'member' && label === '會員中心'))
        .map(([label,url]) => {
          const link = document.createElement('a');
          link.href = url;
          link.innerHTML = icon(linkIcons[label] || 'link');
          const text = document.createElement('span');
          text.textContent = label;
          link.append(text);
          link.insertAdjacentHTML('beforeend', '<svg class="ico chev" aria-hidden="true"><use href="#i-chev"></use></svg>');
          return link;
        }));
      $('retryMenu').hidden = data.menu !== 'retry';
      status(cfg.page === 'appointments' ? '請返回 LINE 官方帳號，傳送「回診管理」。' : '已綁定照護家庭','ok');
      if (cfg.page === 'member') loadMembers();
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
    // Proactive prompt: works only when the LINE Login channel is linked to the OA; otherwise liff.getFriendship() throws and we stay silent
    // (the server still enforces friendship when REQUIRE_OA_FRIEND=true).
    const friendUrl = cfg.links['回到 LINE 官方帳號'];
    async function checkFriend() {
      if (!friendUrl || typeof liff.getFriendship !== 'function') return;
      try { $('addFriend').hidden = (await liff.getFriendship()).friendFlag !== false; } catch (_) { /* OA not linked */ }
    }
    const invited = new URLSearchParams(location.search).get('invite');
    const validInvite = /^[a-f0-9]{32}$/i.test(invited || '');
    async function loadMembers() {
      try {
        const result = await api('listMembers');
        const admin = result.role === 'admin';
        const rows = result.members.map(member => {
          const item = document.createElement('li');
          const avatar = document.createElement('span');
          avatar.className = 'avatar';
          avatar.setAttribute('aria-hidden','true');
          avatar.textContent = Array.from(member.displayName || '成')[0];
          const who = document.createElement('span');
          who.className = 'who';
          who.textContent = (member.displayName || '成員') + (member.isSelf ? '（你）' : '') + '・' + (member.role === 'admin' ? '管理者' : '成員');
          item.append(avatar, who);
          if (admin && !member.isSelf && member.role === 'member') {
            const actions = document.createElement('div');
            actions.className = 'actions';
            for (const [label, action, confirmText] of [['設為管理者','promoteMember','要把「' + (member.displayName || '這位成員') + '」設為管理者嗎？'],
                                                       ['移除','removeMember','要移除「' + (member.displayName || '這位成員') + '」嗎？對方將無法再查看或記錄資料。']]) {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = action === 'removeMember' ? 'danger' : 'secondary';
              button.textContent = label;
              button.onclick = async () => {
                if (!window.confirm(confirmText)) return;
                button.disabled = true;
                try { await api(action,{memberKey:member.key}); await loadMembers(); status(action === 'removeMember' ? '已移除成員' : '已設為管理者','ok'); }
                catch (err) { status(err.message,'error'); button.disabled = false; }
              };
              actions.append(button);
            }
            item.append(actions);
          }
          return item;
        });
        $('memberList').replaceChildren(...rows);
        $('membersBox').hidden = false;
      } catch (err) { status(err.message,'error'); }
    }
    // 已綁定是常態：功能頁需要的資料和會員狀態同時發出，不必排隊。未綁定時結果直接丟棄。
    let early = null;
    window.hubPrefetch = action => {
      if (!early || early.action !== action) return null;
      const {response} = early;
      early = null;
      return response;
    };
    if (cfg.module) {
      const [url, body] = ['daily','settings'].includes(cfg.page)
        ? ['/api/daily',{action:'read',accessToken}]
        : ['/api/dashboard',{action:'getHubData',idToken:accessToken,days:7}];
      const response = fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      response.catch(() => {}); // 由取用的頁面處理錯誤
      early = {action:body.action,response};
    }
    const data = await api('memberStatus');
    $('invite').onclick = async () => {
      $('invite').disabled = true;
      try {
        const result = await api('createInvite');
        $('inviteCode').textContent = result.inviteCode;
        const link = 'https://liff.line.me/' + cfg.liffId + '/?page=bind&invite=' + result.inviteCode;
        $('inviteLink').textContent = link;
        $('shareInvite').href = 'https://line.me/R/msg/text/?' + encodeURIComponent('邀請你加入「' + data.patientName + '」的照護家庭（24 小時內、限用一次）：' + link);
        $('copyInvite').onclick = async () => {
          try { await navigator.clipboard.writeText(link); status('已複製邀請連結'); }
          catch { status('請長按上方連結複製'); }
        };
        $('inviteShare').hidden = false;
        status('請私下交給一位家人。邀請碼 24 小時內只能使用一次。');
      } catch (err) { status(err.message,'error'); }
      finally { $('invite').disabled = false; }
    };
    $('unbind').onclick = async () => {
      if (!window.confirm('解除綁定後，將無法再查看或記錄「' + $('patientName').textContent + '」的資料。確定要解除嗎？')) return;
      $('unbind').disabled = true;
      try {
        await api('unbind');
        status('已解除綁定，LINE 選單會恢復為未綁定樣式。請關閉此頁。','ok');
        $('familyPanel').hidden = true;
        $('memberHeading').textContent = '已解除綁定';
      } catch (err) { status(err.message,'error'); $('unbind').disabled = false; }
    };
    $('retryMenu').onclick = async () => {
      $('retryMenu').disabled = true;
      try {
        const result = await api('syncMenu');
        $('retryMenu').hidden = result.menu !== 'retry';
        status(result.menu === 'linked' ? '已更新 LINE 選單' : 'LINE 選單更新未完成');
      } catch (err) { status(err.message,'error'); }
      finally { $('retryMenu').disabled = false; }
    };
    if (data.bound && validInvite && cfg.page === 'bind') {
      try {
        const peek = await api('previewInvite',{inviteCode:invited});
        $('memberHeading').textContent = '切換照護家庭';
        $('switchText').textContent = '你目前綁定「' + peek.current.patientName + '」的家庭（' + (peek.current.role === 'admin' ? '管理者' : '成員') +
          '）。邀請你加入的是「' + peek.preview.patientName + '」的家庭。一個帳號目前只能綁定一個家庭。';
        $('switchBlock').textContent = peek.switchBlocked || '';
        $('doSwitch').hidden = !!peek.switchBlocked;
        $('switchPanel').hidden = false;
        status('請確認是否要切換。');
        return await new Promise(resolve => {
          $('cancelSwitch').onclick = () => { $('switchPanel').hidden = true; resolve(finish(data)); };
          $('doSwitch').onclick = async () => {
            $('doSwitch').disabled = true;
            try {
              const result = await api('switchFamily',{inviteCode:invited});
              $('switchPanel').hidden = true;
              resolve(finish(result));
            } catch (err) { status(err.message,'error'); $('doSwitch').disabled = false; }
          };
        });
      } catch (err) { status(err.message,'error'); }
    }
    if (data.bound) return finish(data);
    early = null; // 綁定前抓的資料已無效，完成綁定後頁面會重新讀取
    $('onboarding').hidden = false;
    $('memberHeading').textContent = '綁定照護家庭';
    checkFriend();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkFriend(); });
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
      status('請選擇建立新的照護家庭，或輸入家人提供的邀請碼。');
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
        } catch (err) { status(err.message,'error'); }
        finally { disable(false); }
      };
      const isProxy = form => form.elements.forWhom.value === 'proxy';
      $('startFamily').elements.forWhom.forEach(radio => {
        radio.onchange = () => { $('proxyNotice').hidden = !isProxy($('startFamily')); };
      });
      $('chooseStart').onclick = () => {
        show('startFamily'); step('startFamily','startStep1');
        status('先填寫基本資料，下一步再選擇追蹤項目。');
      };
      $('chooseJoin').onclick = () => { show('joinFamily'); step('joinFamily','joinStep1'); status('請輸入家人提供的邀請碼。'); };
      for (const button of $('onboarding').querySelectorAll('.back')) button.onclick = reset;
      $('backStep1').onclick = () => step('startFamily','startStep1');
      $('backJoin').onclick = () => step('joinFamily','joinStep1');
      $('toStep2').onclick = () => {
        const form = $('startFamily');
        const year = form.elements.birthYear.value.trim();
        if (isProxy(form) && !form.elements.consent.checked) { status('請先勾選「我已取得患者同意」'); return; }
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
            allergies:form.get('allergies'),metrics,thresholds,proxy:form.get('forWhom') === 'proxy',consent:form.get('forWhom') === 'proxy' && form.get('consent') === 'on'
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
        } catch (err) { status(err.message,'error'); }
        finally { disable(false); }
      };
      if (validInvite) {
        show('joinFamily');
        step('joinFamily','joinStep1');
        $('joinFamily').elements.inviteCode.value = invited;
        $('joinFamily').requestSubmit();
      }
    });
  } catch (err) {
    status(err.message || '無法確認 LINE 與家庭身分','error');
    return false;
  }
})();
