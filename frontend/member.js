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
  /** 解除、刪除、復原前的確認彈窗；回傳使用者是否按下確認。 */
  /** 確認彈窗：回傳 'ok'、'extra'（可選的第二個按鈕）或 false。 */
  const confirmBox = ({title, text, ok, danger = true, extra = ''}) => new Promise(resolve => {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalOk').textContent = ok;
    $('modalOk').className = danger ? 'danger' : '';
    $('modalExtra').textContent = extra;
    $('modalExtra').hidden = !extra;
    $('modal').hidden = false;
    const close = value => { $('modal').hidden = true; resolve(value); };
    $('modalOk').onclick = () => close('ok');
    $('modalExtra').onclick = () => close('extra');
    $('modalCancel').onclick = () => close(false);
  });
  /** 選擇新的管理者，回傳成員的 key 或 null。 */
  const pickMember = members => new Promise(resolve => {
    $('modalTitle').textContent = '指定新的管理者';
    $('modalText').textContent = '選擇要接手的成員。對方會成為管理者，之後你就可以離開。';
    $('modalOk').hidden = true;
    $('modalExtra').hidden = true;
    const list = document.createElement('div');
    $('modalOptions').replaceChildren(...members.map(member => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = member.displayName || '成員';
      button.onclick = () => done(member.key);
      return button;
    }));
    $('modalOptions').append(list);
    $('modal').hidden = false;
    const done = value => {
      $('modal').hidden = true;
      $('modalOptions').replaceChildren();
      $('modalOk').hidden = false;
      resolve(value);
    };
    $('modalCancel').onclick = () => done(null);
  });
  /** 管理者離開且沒有其他管理者時，決定要刪除家庭或指定新管理者。回傳要送出的額外欄位，取消則回傳 null。 */
  const chooseLeave = async others => {
    const choice = await confirmBox({title:'離開前請選擇', danger:true, ok:'刪除家庭', extra:'指定新管理者',
      text:'你是目前唯一的管理者，家裡還有其他成員。\n・刪除家庭：所有人一起解除綁定，3 個月內可復原\n・指定新管理者：由對方接手，你再離開'});
    if (choice === 'ok') return {deleteFamily:true};
    if (choice !== 'extra') return null;
    const key = await pickMember(others);
    return key ? {promoteMemberKey:key} : null;
  };
  const day = iso => new Date(iso).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'});
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
      $('unbindLabel').textContent = data.role === 'admin' ? '離開照護家庭' : '解除綁定';
      $('memberLinks').replaceChildren(...Object.entries(cfg.links)
        .filter(([label,url]) => url && label !== '回到 LINE 官方帳號' && !(['member','bind'].includes(cfg.page) && label === '會員中心'))
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
    const ended = message => {
      status(message,'ok');
      $('familyPanel').hidden = true;
      $('restart').hidden = false;
      $('restart').onclick = () => location.reload();
    };
    $('unbind').onclick = async () => {
      const name = $('patientName').textContent;
      $('unbind').disabled = true;
      try {
        const {members} = await api('listMembers');
        const self = members.find(member => member.isSelf);
        const others = members.filter(member => !member.isSelf);
        const isAdmin = self?.role === 'admin';
        let extra = {};
        if (isAdmin && others.length && !others.some(member => member.role === 'admin')) {
          extra = await chooseLeave(others);
          if (!extra) return;
        } else if (isAdmin && !others.length) {
          if (!await confirmBox({title:'刪除照護家庭？',ok:'確認刪除',
            text:'「' + name + '」照護家庭將被刪除。\n三個月內可以復原家庭。'})) return;
        } else if (!await confirmBox({title:'解除綁定？',ok:'確認解除',
          text:'解除後你將無法查看或記錄「' + name + '」的資料，家庭和紀錄仍會保留給其他家人。\n\n之後可用家人的邀請連結再次加入，或建立自己的照護家庭。'})) {
          return;
        }
        const result = await api('unbind', extra);
        $('memberHeading').textContent = result.deleted ? '照護家庭已刪除' : '已解除綁定';
        ended(result.deleted
          ? '已刪除，' + day(result.restoreUntil) + ' 前可在建立頁面復原。'
          : 'LINE 選單會恢復為未綁定樣式。');
      } catch (err) { status(err.message,'error'); }
      finally { $('unbind').disabled = false; }
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
        $('switchBlock').textContent = peek.needsChoice ? '你是目前家庭的管理者，離開前需要選擇：刪除家庭，或指定新的管理者。'
          : peek.lastMember ? '你是目前家庭最後一位成員，離開後該家庭會被刪除（3 個月內可復原）。' : '';
        $('doSwitch').textContent = '解除目前綁定並加入';
        $('switchPanel').hidden = false;
        status('請確認是否要切換。');
        return await new Promise(resolve => {
          $('cancelSwitch').onclick = () => { $('switchPanel').hidden = true; resolve(finish(data)); };
          $('doSwitch').onclick = async () => {
            $('doSwitch').disabled = true;
            try {
              let extra = {};
              if (peek.needsChoice) {
                const {members} = await api('listMembers');
                extra = await chooseLeave(members.filter(member => !member.isSelf));
                if (!extra) { $('doSwitch').disabled = false; return; }
              }
              const result = await api('switchFamily',{inviteCode:invited,...extra});
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
    const restorable = data.restorable || [];
    $('restoreBox').hidden = !restorable.length;
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
      $('restoreList').replaceChildren(...restorable.map(item => {
        const row = document.createElement('div');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = '復原「' + item.patientName + '」';
        const note = document.createElement('p');
        note.textContent = day(item.restoreUntil) + ' 前可復原';
        button.onclick = async () => {
          if (await confirmBox({title:'復原照護家庭？',ok:'確認復原',danger:false,
            text:'會復原「' + item.patientName + '」的資料，原本的家人若沒有加入其他家庭，也會一起恢復綁定。'})) complete('restoreFamily',{familyId:item.familyId});
        };
        row.append(button,note);
        return row;
      }));
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
      let pending;
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
          const fields = {
            patientName:form.get('patientName'),birthYear:form.get('birthYear'),
            conditions:[...form.getAll('condition'),...(other ? [other] : [])],
            allergies:form.get('allergies'),metrics,thresholds,proxy:form.get('forWhom') === 'proxy',consent:form.get('forWhom') === 'proxy' && form.get('consent') === 'on'
          };
          // 同一份內容重送沿用同一個 requestId；內容改了就是另一次建立
          const signature = JSON.stringify(fields);
          if (pending?.signature !== signature) pending = {signature,requestId:crypto.randomUUID?.()}; // 舊版瀏覽器沒有時由後端產生
          return complete('createFamily',{...fields,requestId:pending.requestId});
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
