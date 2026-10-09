(() => {
  'use strict';

  const play = PaviloPlay.createPlayClient();
  const i18n = WerewolfI18n.createI18n();
  const t = (key, vars) => i18n.t(key, vars);

  const el = (id) => document.getElementById(id);
  const ui = {
    status: el('status'), channels: el('channels'), boardTag: el('boardTag'),
    phaseName: el('phaseName'), phaseHint: el('phaseHint'),
    timer: el('timer'), timerFill: el('timerFill'), timerText: el('timerText'),
    seats: el('seats'), panel: el('panel'), panelTitle: el('panelTitle'), actions: el('actions'),
    sayForm: el('sayForm'), sayInput: el('sayInput'), endSpeech: el('endSpeech'),
    log: el('log'), myCard: el('myCard'), cardFlip: el('cardFlip'),
    cardImage: el('cardImage'), cardLabel: el('cardLabel'),
    wolfChat: el('wolfChat'), wolfLog: el('wolfLog'), wolfForm: el('wolfForm'), wolfInput: el('wolfInput'),
    reveal: el('reveal'), revealTitle: el('revealTitle'), revealReason: el('revealReason'),
    revealSeats: el('revealSeats'), restartButton: el('restartButton'),
    langButton: el('langButton'), leaveButton: el('leaveButton')
  };

  const channelId = new URLSearchParams(location.search).get('channel');
  const ROLE_IMG = (role) => `/plays/werewolf/assets/roles/${role}.jpg`;
  const AVATAR_IMG = (role) => `/plays/werewolf/assets/roles/avatar-${role}.jpg`;

  let view = null;
  let prevPhase = null;
  let prevAlive = new Map();
  let revealedRole = null;
  let tick = null;
  let loggedLog = 0;
  let wolfSeen = 0;

  // ---------------------------------------------------------------- 工具

  function clearNode(node) { node.replaceChildren(); }

  function seatById(id) { return view?.seats?.find((seat) => seat.id === id) || null; }
  function seatNo(id) { return seatById(id)?.seat ?? '?'; }

  function isNight(phase) { return phase === 'night_actions' || phase === 'night_witch'; }

  // ---------------------------------------------------------------- 阶段

  function paintPhase() {
    const phase = view.phase.name;
    document.body.classList.toggle('is-night', isNight(phase));
    document.body.classList.toggle('is-day', !isNight(phase) && phase !== 'lobby' && phase !== 'game_over');
    document.body.classList.toggle('is-over', phase === 'game_over');

    if (phase !== prevPhase) {
      ui.phaseName.textContent = t(`phase.${phase}`);
      // 重新触发入场动画：换幕感
      ui.phaseName.classList.remove('enter');
      void ui.phaseName.offsetWidth;
      ui.phaseName.classList.add('enter');
      prevPhase = phase;
    }
    ui.phaseHint.textContent = hintFor(phase);
  }

  function hintFor(phase) {
    const self = view.self;
    if (self && !self.alive && phase !== 'game_over' && view.phase.currentSpeaker !== self.id) return t('hint.dead');
    if (phase === 'night_actions') {
      if (view.wolf) return t('hint.night_wolf');
      if (view.seer) return t('hint.night_seer');
      return t('hint.night_actions');
    }
    if (phase === 'night_witch') return view.witch ? t('hint.witch_self') : t('hint.night_witch');
    if (phase === 'day_speech' || phase === 'pk_speech') {
      return view.phase.currentSpeaker === self?.id ? t('hint.day_speech') : t('hint.waiting');
    }
    return t(`hint.${phase}`) === `hint.${phase}` ? '' : t(`hint.${phase}`);
  }

  // ---------------------------------------------------------------- 倒计时

  function paintTimer() {
    if (tick) { clearInterval(tick); tick = null; }
    const deadline = view.phase.deadline;
    if (!deadline) { ui.timer.hidden = true; return; }
    ui.timer.hidden = false;
    const total = Math.max(1, deadline - Date.now());
    const circumference = 2 * Math.PI * 17;

    const render = () => {
      const left = Math.max(0, deadline - Date.now());
      const seconds = Math.ceil(left / 1000);
      ui.timerText.textContent = seconds;
      ui.timerFill.style.strokeDashoffset = String(circumference * (1 - left / total));
      ui.timer.classList.toggle('urgent', seconds <= 5 && seconds > 0);
      if (left <= 0 && tick) { clearInterval(tick); tick = null; }
    };
    render();
    tick = setInterval(render, 250);
  }

  // ---------------------------------------------------------------- 座位

  function paintSeats() {
    const seats = view.seats || [];
    const targets = targetMap();
    const teammates = new Set((view.wolf?.team || []).map((mate) => mate.id));
    const myPick = view.wolf?.picks?.[view.self?.id] || null;

    clearNode(ui.seats);
    if (!seats.length) { paintLobby(); return; }

    seats.forEach((seat, index) => {
      const li = document.createElement('li');
      li.className = 'seat';
      li.style.setProperty('--i', index);
      if (seat.id === view.self?.id) li.classList.add('is-self');
      if (seat.kind === 'agent') li.classList.add('is-agent');
      if (!seat.alive) li.classList.add('is-dead');
      if (view.phase.currentSpeaker === seat.id) li.classList.add('is-speaking');
      if (teammates.has(seat.id) && seat.id !== view.self?.id) li.classList.add('is-teammate');
      if (myPick === seat.id) li.classList.add('is-picked');
      // 刚死的人给一次死亡动画
      if (prevAlive.get(seat.id) === true && !seat.alive) li.classList.add('just-died');

      const no = document.createElement('span');
      no.className = 'seat-no';
      no.textContent = String(seat.seat).padStart(2, '0');

      const avatar = document.createElement('div');
      avatar.className = 'seat-avatar';
      // 只有终局揭晓后才显示角色头像，否则一律用首字，避免泄底
      if (seat.role) {
        const img = document.createElement('img');
        img.src = AVATAR_IMG(seat.role);
        img.alt = t(`role.${seat.role}`);
        img.loading = 'lazy';
        avatar.append(img);
      } else {
        avatar.textContent = (seat.username || '?').slice(0, 1).toUpperCase();
      }

      const name = document.createElement('span');
      name.className = 'seat-name';
      name.textContent = seat.username || t('seat.empty');

      const badge = document.createElement('span');
      badge.className = 'seat-badge';
      badge.textContent = !seat.alive ? t('seat.dead')
        : view.phase.currentSpeaker === seat.id ? t('seat.speaking')
          : teammates.has(seat.id) && seat.id !== view.self?.id ? t('seat.teammate')
            : seat.id === view.self?.id ? t('seat.you') : '';

      li.append(no, avatar, name, badge);

      const action = targets.get(seat.id);
      if (action) {
        li.classList.add('is-target');
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', `${action.label} ${seat.seat}`);
        const fire = () => play.playAction(action.name, action.payload);
        li.addEventListener('click', fire);
        li.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fire(); }
        });
      }
      ui.seats.append(li);
    });

    prevAlive = new Map(seats.map((seat) => [seat.id, seat.alive]));
  }

  function paintLobby() {
    const lobby = view.lobby || [];
    for (let index = 0; index < 9; index += 1) {
      const entry = lobby[index];
      const li = document.createElement('li');
      li.className = 'seat';
      li.style.setProperty('--i', index);
      if (entry?.id === view.self?.id) li.classList.add('is-self');
      if (entry?.kind === 'agent') li.classList.add('is-agent');

      const no = document.createElement('span');
      no.className = 'seat-no';
      no.textContent = String(index + 1).padStart(2, '0');
      const avatar = document.createElement('div');
      avatar.className = 'seat-avatar';
      avatar.textContent = entry ? (entry.username || '?').slice(0, 1).toUpperCase() : '·';
      const name = document.createElement('span');
      name.className = 'seat-name';
      name.textContent = entry?.username || t('seat.empty');
      const badge = document.createElement('span');
      badge.className = 'seat-badge';
      badge.textContent = entry?.kind === 'agent' ? '' : entry?.id === view.self?.id ? t('seat.you') : '';
      li.append(no, avatar, name, badge);
      ui.seats.append(li);
    }
  }

  // 把服务端的 legalActions 映射成「点座位」的目标。
  // 前端不推断权限：没有下发就没有目标。
  function targetMap() {
    const map = new Map();
    for (const action of view.legalActions || []) {
      const target = action.payload?.target;
      if (!target) continue;
      const label = t(`act.${action.name}`);
      map.set(target, { name: action.name, payload: action.payload, label });
    }
    return map;
  }

  // ---------------------------------------------------------------- 操作面板

  function paintActions() {
    clearNode(ui.actions);
    const actions = view.legalActions || [];
    const speaking = view.phase.currentSpeaker === view.self?.id;

    ui.sayForm.hidden = !speaking;
    if (speaking) {
      ui.sayInput.placeholder = t('say.placeholder');
      if (document.activeElement !== ui.sayInput) ui.sayInput.focus({ preventScroll: true });
    }

    // 带 target 的动作已经画在座位上，这里只放无目标的按钮
    const plain = actions.filter((action) => !action.payload?.target
      && action.name !== 'speak' && action.name !== 'endSpeech' && action.name !== 'wolfChat');

    plain.forEach((action, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.setProperty('--i', index);
      const isNone = action.name === 'wolfPick' && action.payload?.target === null;
      button.className = ['start', 'witchSave', 'hunterShoot'].includes(action.name) ? 'primary' : 'ghost';
      button.textContent = isNone ? t('act.wolfPickNone') : t(`act.${action.name}`);
      // sit 需要带上自己的名字，其余动作原样透传服务端给的 payload
      const payload = action.name === 'sit'
        ? { username: play.identity?.username || 'Player' }
        : (action.payload || {});
      button.addEventListener('click', () => play.playAction(action.name, payload));
      ui.actions.append(button);
    });

    const hasPanel = ui.actions.childElementCount > 0 || speaking;
    ui.panelTitle.hidden = !hasPanel;
    if (hasPanel) ui.panelTitle.textContent = t(`phase.${view.phase.name}`);
  }

  // ---------------------------------------------------------------- 身份牌

  function paintCard() {
    const role = view.self?.role;
    ui.myCard.hidden = !role;
    if (!role) { revealedRole = null; return; }
    if (role !== revealedRole) {
      ui.cardImage.src = ROLE_IMG(role);
      ui.cardImage.alt = t(`role.${role}`);
      ui.cardLabel.textContent = t(`role.${role}`);
      ui.myCard.classList.remove('revealed');
      // 发牌后稍等再翻，让翻牌动作被看见
      setTimeout(() => ui.myCard.classList.add('revealed'), 420);
      revealedRole = role;
    }
  }

  // ---------------------------------------------------------------- 狼队

  function paintWolf() {
    const wolf = view.wolf;
    ui.wolfChat.hidden = !wolf;
    if (!wolf) { wolfSeen = 0; return; }
    const lines = wolf.chat || [];
    if (lines.length < wolfSeen) { clearNode(ui.wolfLog); wolfSeen = 0; }
    for (const line of lines.slice(wolfSeen)) {
      const li = document.createElement('li');
      const who = document.createElement('b');
      who.textContent = `${line.seat}号 `;
      li.append(who, document.createTextNode(line.text));
      ui.wolfLog.append(li);
    }
    if (lines.length !== wolfSeen) {
      wolfSeen = lines.length;
      ui.wolfLog.scrollTop = ui.wolfLog.scrollHeight;
    }
  }

  // ---------------------------------------------------------------- 日志

  function paintLog() {
    const entries = view.log || [];
    if (entries.length < loggedLog) { clearNode(ui.log); loggedLog = 0; }
    for (const entry of entries.slice(loggedLog)) {
      const text = describe(entry);
      if (text) appendLog(text, true);
    }
    loggedLog = entries.length;
  }

  function describe(entry) {
    switch (entry.kind) {
      case 'started': return t('log.started', { seats: entry.seats });
      case 'nightFell': return t('log.nightFell', { night: entry.night });
      case 'dayBegan': return t('log.dayBegan', { day: entry.day });
      case 'dawn':
        return entry.deaths?.length
          ? t('log.dawn_some', { seats: entry.deaths.join('、') })
          : t('log.dawn_none');
      case 'voteResult':
        if (entry.outcome === 'exile') return t('log.voteResult_exile', { seat: seatNo(entry.exiled) });
        if (entry.outcome === 'tie') return t('log.voteResult_tie', { seats: entry.tied.map(seatNo).join('、') });
        return t('log.voteResult_none');
      case 'hunterShot': return t('log.hunterShot', { seat: entry.target });
      case 'gameOver': return t('log.gameOver', { winner: t(`win.${entry.winner}`) });
      default: return '';
    }
  }

  function appendLog(text, judge = false) {
    const li = document.createElement('li');
    if (judge) li.className = 'judge';
    li.textContent = text;
    ui.log.append(li);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function appendSpeech(username, text) {
    const li = document.createElement('li');
    const who = document.createElement('b');
    who.textContent = `${username}：`;
    li.append(who, document.createTextNode(text));
    ui.log.append(li);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  // ---------------------------------------------------------------- 终局

  function paintReveal() {
    const over = view.phase.name === 'game_over';
    ui.reveal.hidden = !over;
    if (!over) return;
    const result = view.result || {};
    ui.revealTitle.textContent = t(`win.${result.winner}`);
    ui.revealTitle.className = result.winner === 'good' ? 'good' : 'wolf';
    ui.revealReason.textContent = t(`reason.${result.reason}`);

    clearNode(ui.revealSeats);
    (view.seats || []).forEach((seat, index) => {
      const li = document.createElement('li');
      li.style.setProperty('--i', index);
      if (!seat.alive) li.classList.add('dead');
      const img = document.createElement('img');
      img.src = ROLE_IMG(seat.role);
      img.alt = t(`role.${seat.role}`);
      const name = document.createElement('span');
      name.className = 'r-name';
      name.textContent = `${seat.seat}. ${seat.username}`;
      const role = document.createElement('span');
      role.className = 'r-role';
      role.textContent = t(`role.${seat.role}`);
      li.append(img, name, role);
      ui.revealSeats.append(li);
    });
  }

  // ---------------------------------------------------------------- 渲染

  function render() {
    if (!view) return;
    ui.boardTag.textContent = t(`board.${view.boardId || 'std9'}`);
    paintPhase();
    paintTimer();
    paintSeats();
    paintActions();
    paintCard();
    paintWolf();
    paintLog();
    paintReveal();
  }

  function renderChannels() {
    const current = play.currentChannel()?.id || channelId;
    clearNode(ui.channels);
    for (const channel of (play.channels || []).filter((item) => item.enabled)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = channel.name;
      if (channel.id === current) button.className = 'active';
      button.addEventListener('click', () => play.switchToChannel(channel));
      ui.channels.append(button);
    }
  }

  // ---------------------------------------------------------------- 事件

  play.subscribe((event) => {
    if (event.type === 'connecting') {
      ui.status.textContent = t('connecting');
      ui.status.className = 'status';
    }
    if (event.type === 'open' || event.type === 'stateStart') {
      ui.status.textContent = t('online');
      ui.status.className = 'status online';
    }
    if (event.type === 'close') {
      ui.status.textContent = t('offline');
      ui.status.className = 'status offline';
    }
    if (event.type === 'stateStart') renderChannels();
    if (event.type === 'playState') { view = event.state; render(); }
    if (event.type === 'message') {
      appendSpeech(event.message.author?.username || '?', event.message.text || '');
    }
    if (event.type === 'error') appendLog(`${event.code}: ${event.message}`);
  });

  ui.sayForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.sayInput.value.trim();
    if (!text) return;
    play.playAction('speak', { text });
    ui.sayInput.value = '';
  });
  ui.endSpeech.addEventListener('click', () => play.playAction('endSpeech', {}));

  ui.wolfForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.wolfInput.value.trim();
    if (!text) return;
    play.playAction('wolfChat', { text });
    ui.wolfInput.value = '';
  });

  ui.cardFlip.addEventListener('click', () => ui.myCard.classList.toggle('revealed'));
  ui.restartButton.addEventListener('click', () => play.playAction('restart', {}));
  ui.leaveButton.addEventListener('click', () => { play.leave(); location.assign('/'); });
  ui.langButton.addEventListener('click', () => {
    i18n.set(i18n.other());
    ui.langButton.textContent = i18n.lang === 'zh-CN' ? 'EN' : '中';
    i18n.apply();
    prevPhase = null;
    loggedLog = 0;
    clearNode(ui.log);
    render();
  });

  document.documentElement.lang = i18n.lang;
  ui.langButton.textContent = i18n.lang === 'zh-CN' ? 'EN' : '中';
  i18n.apply();
  play.start({ channelId });
})();
