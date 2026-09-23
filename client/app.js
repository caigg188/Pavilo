(() => {
  'use strict';

  const { PROTOCOL_VERSION, parseServerEvent, DEFERRED_EVENTS } = PaviloProtocol;
  const i18n = PaviloI18n.createI18n();
  const t = (key, vars) => i18n.t(key, vars);
  const store = PaviloState.createStore();
  const pendingQueue = PaviloPending.createPendingQueue();
  const { draftMatches } = PaviloPending;
  let maxImageBytes = 300_000;
  let maxImagePixels = 4_000_000;
  let maxGifDimension = 1_600;
  let roomInfo = null;
  let roomInfoReady = false;
  let roomInfoPromise = null;
  let roomInfoRetryTimer = null;
  let roomChannels = [];
  let selectedChannelId = null;
  let identity = null;
  let resumeToken = null;
  let resumeWatchdog = null;
  let reconnectingAfterClose = false;
  let replyTarget = null;
  let leaveTimer = null;
  let channelRenderKey = '';
  let composerPopoverOpen = false;
  let errorController = null;
  let lastConnection = { online: false, key: 'chat.connecting', vars: null, variant: 'connecting' };

  const $ = (selector) => document.querySelector(selector);
  const languageButton = $('#languageButton');
  const languageButtonLabel = $('#languageButtonLabel');
  const loginScreen = $('#loginScreen');
  const appShell = $('#appShell');
  const loginForm = $('#loginForm');
  const usernameInput = $('#usernameInput');
  const loginError = $('#loginError');
  const connectionDot = $('#connectionDot');
  const connectionText = $('#connectionText');
  const messageScroll = $('#messageScroll');
  const messageList = $('#messageList');
  const messageCount = $('#messageCount');
  const newMessageJump = $('#newMessageJump');
  const channelList = $('#channelList');
  const mobileChannelPicker = $('#mobileChannelPicker');
  const channelDescription = $('#channelDescription');
  const typingLine = $('#typingLine');
  const composer = $('#composer');
  const composerText = $('#composerText');
  const emojiButton = $('#emojiButton');
  const composerPopover = $('#composerPopover');
  const composerPicker = $('#composerPicker');
  const copyLinkButton = $('#copyLinkButton');
  const leaveButton = $('#leaveButton');
  const embedMode = PaviloEmbed.isEmbedDocument(window.location.pathname);
  let embedBridge = null;

  function storage() {
    if (embedMode) {
      const data = new Map();
      return {
        getItem(key) { return data.has(key) ? data.get(key) : null; },
        setItem(key, value) { data.set(key, String(value)); },
        removeItem(key) { data.delete(key); },
      };
    }
    try { return sessionStorage; } catch { return null; }
  }

  function iconMarkup(name, size) {
    const inner = globalThis.lucideCreateIcon?.(name) || '';
    if (!inner) return '';
    const dimension = size ? ` style="width:${size}px;height:${size}px"` : '';
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${dimension}>${inner}</svg>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character]));
  }

  const avatarColors = [
    ['#dceee9', '#0f7772', '#f4c85f'],
    ['#fbe4dc', '#b34d46', '#e86f57'],
    ['#fff3c8', '#8a6530', '#f0a647'],
    ['#e3e8f3', '#4a5f88', '#8299c4'],
    ['#e8e3f0', '#6f4c82', '#b28ac4'],
    ['#e2eee0', '#4d754d', '#9abe79'],
  ];

  function hashSeed(seed, salt = 0) {
    let value = (Number(seed) >>> 0) + salt * 2_654_435_761;
    value = Math.imul(value ^ value >>> 16, 2_246_828_519);
    value = Math.imul(value ^ value >>> 13, 3_266_489_917);
    return (value ^ value >>> 16) >>> 0;
  }

  function avatarMarkup(user = {}, sizeClass = '', interactive = true) {
    const seed = hashSeed(user.avatarSeed);
    const colors = avatarColors[seed % avatarColors.length];
    const x = 16 + hashSeed(seed, 1) % 8;
    const y = 15 + hashSeed(seed, 2) % 7;
    const tilt = hashSeed(seed, 3) % 18 - 9;
    const eyeOffset = hashSeed(seed, 4) % 3 - 1;
    const initial = escapeHtml((user.username || '?').slice(0, 1).toUpperCase());
    const tag = interactive ? 'button' : 'span';
    const attributes = interactive
      ? ` type="button" data-user-id="${escapeHtml(user.id || '')}" aria-label="${escapeHtml(t('people.aria', { name: user.username || '?' }))}"`
      : ' aria-hidden="true"';
    return `<${tag} class="avatar ${sizeClass}"${attributes} style="--avatar-bg:${colors[0]};--avatar-ink:${colors[1]};--avatar-accent:${colors[2]}">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="12" fill="var(--avatar-bg)"/>
        <path d="M-3 40C8 27 14 29 23 36s17 6 28-7v22H-3Z" fill="var(--avatar-accent)" opacity=".66"/>
        <path d="M${x - 10} ${y + 13}c0-10 7-16 14-16s14 6 14 16c0 8-6 13-14 13s-14-5-14-13Z" fill="var(--avatar-ink)" opacity=".92" transform="rotate(${tilt} 24 24)"/>
        <circle cx="${x - 4 + eyeOffset}" cy="${y + 1}" r="1.8" fill="var(--avatar-bg)"/>
        <circle cx="${x + 5 + eyeOffset}" cy="${y + 1}" r="1.8" fill="var(--avatar-bg)"/>
        <path d="M${x - 3} ${y + 8}q3 3 6 0" fill="none" stroke="var(--avatar-bg)" stroke-linecap="round" stroke-width="1.6"/>
        <text x="39" y="11" fill="var(--avatar-ink)" font-family="sans-serif" font-size="7" font-weight="800" text-anchor="middle">${initial}</text>
      </svg>
    </${tag}>`;
  }

  function localeTag() {
    return i18n.language === 'en' ? 'en' : 'zh-CN';
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat(localeTag(), {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(timestamp));
  }

  function formatDay(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const key = date.toLocaleDateString(localeTag());
    if (key === today.toLocaleDateString(localeTag())) return t('day.today');
    if (key === yesterday.toLocaleDateString(localeTag())) return t('day.yesterday');
    return t('day.date', { month: date.getMonth() + 1, day: date.getDate() });
  }

  function formatDuration(joinedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - joinedAt) / 1_000));
    if (seconds < 60) return t('time.seconds', { n: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('time.minutes', { n: minutes });
    const hours = Math.floor(minutes / 60);
    return t('time.hours', { h: hours, m: minutes % 60 });
  }

  function positiveLimit(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function channelById(channelId) {
    const fromRoom = roomChannels.find((channel) => channel.id === channelId);
    if (fromRoom) return fromRoom;
    return store.getState().channels?.find((channel) => channel.id === channelId) || null;
  }

  function hasStoredLanguage() {
    try { return Boolean(globalThis.localStorage?.getItem(PaviloI18n.STORAGE_KEY)); }
    catch { return false; }
  }

  function notifyButtonMode() {
    if (!window.isSecureContext || !('Notification' in window)) return 'unavailable';
    if (window.Notification.permission === 'granted') return 'on';
    if (window.Notification.permission === 'denied') return 'denied';
    return 'off';
  }

  function applyStaticCopy() {
    document.documentElement.lang = t('html.lang');
    if (!embedMode) document.title = t('brand.title');
    const picker = $('#composerPicker');
    if (picker) picker.setAttribute('locale', i18n.language === 'en' ? 'en' : 'zh');
    const guests = roomInfo?.identity?.guests !== false;
    for (const node of document.querySelectorAll('[data-i18n]')) {
      if (node.id === 'messageCount' || node.id === 'connectionText') continue;
      if (node.id === 'loginCopy' && embedMode) {
        node.textContent = t('login.embedCopy');
        continue;
      }
      if (node.id === 'loginCopy' && !guests) {
        node.textContent = t('login.hostRequired');
        continue;
      }
      node.textContent = t(node.dataset.i18n);
    }
    const note = document.querySelector('.ephemeral-note');
    if (note) {
      const forever = roomInfo && roomInfo.ephemeral === false && roomInfo.retentionDays == null;
      const persisted = roomInfo && roomInfo.ephemeral === false;
      const days = roomInfo?.retentionDays ?? 30;
      note.querySelector('strong').textContent = t(persisted ? 'persisted.strong' : 'ephemeral.strong');
      note.querySelector('p').textContent = t(forever ? 'persisted.copyForever' : persisted ? 'persisted.copy' : 'ephemeral.copy', { days });
      note.querySelector('code').textContent = t(forever ? 'persisted.codeForever' : persisted ? 'persisted.code' : 'ephemeral.code', { days });
    }
    for (const node of document.querySelectorAll('[data-i18n-html]')) {
      node.innerHTML = t(node.dataset.i18nHtml);
    }
    usernameInput.placeholder = t('login.placeholder');
    composerText.placeholder = t('composer.placeholder');
    composerText.setAttribute('aria-label', t('composer.aria'));
    emojiButton.setAttribute('aria-label', t('composer.emoji'));
    $('#mentionButton')?.setAttribute('aria-label', t('composer.mention'));
    $('#mentionButton')?.setAttribute('title', t('composer.mentionTitle'));
    $('#attachmentButton')?.setAttribute('aria-label', t('composer.attach'));
    $('#composerAttachThumb')?.setAttribute('aria-label', t('attach.preview'));
    $('#composerAttachRemove')?.setAttribute('aria-label', t('attach.remove'));
    const retry = $('#composerAttachRetry');
    if (retry) retry.textContent = t('attach.retry');
    copyLinkButton.setAttribute('title', t('top.shareTitle'));
    $('#membersButton')?.setAttribute('title', t('top.membersTitle'));
    $('#membersButton')?.setAttribute('aria-label', t('top.membersTitle'));
    leaveButton.setAttribute('title', t('top.leaveTitle'));
    $('#cancelReplyButton')?.setAttribute('aria-label', t('reply.cancel'));
    $('#channelList')?.setAttribute('aria-label', t('channels.nav'));
    mobileChannelPicker.setAttribute('aria-label', t('channels.mobile'));
    $('#mentionList')?.setAttribute('aria-label', t('mention.list'));
    $('#reactionChoices')?.setAttribute('aria-label', t('reaction.group'));
    $('#toastRegion')?.setAttribute('aria-label', t('toast.region'));
    $('#newMessageJump')?.setAttribute('aria-label', t('chat.newJump'));
    $('#messageScroll')?.setAttribute('aria-label', t('chat.log'));
    $('#chat')?.setAttribute('aria-label', t('workspace.aria'));
    $('.brand')?.setAttribute('aria-label', t('brand.aria'));
    languageButton?.setAttribute('title', t('language.switch'));
    languageButton?.setAttribute('aria-label', t('language.switch'));
    if (languageButtonLabel) languageButtonLabel.textContent = i18n.language === 'en' ? t('language.zh') : t('language.en');
    const leaveLabel = leaveButton.querySelector('.top-action-label');
    if (leaveLabel && !leaveButton.classList.contains('confirming')) leaveLabel.textContent = t('top.leave');
    const shareLabel = copyLinkButton.querySelector('.top-action-label');
    if (shareLabel) shareLabel.textContent = t('top.share');
    const membersLabel = $('#membersButton')?.querySelector('.top-action-label');
    if (membersLabel) membersLabel.textContent = t('top.members');
    notificationsController?.paintNotifyButton?.(notifyButtonMode());
    if (errorController && lastConnection) {
      errorController.setConnectionStatus(lastConnection.online, t(lastConnection.key, lastConnection.vars), lastConnection.variant);
    }
    $('#mobileSheetBackdrop')?.setAttribute('aria-label', t('sheet.close'));
    $('#mobileSheetClose')?.setAttribute('aria-label', t('sheet.close'));
    $('#viewerClose')?.setAttribute('aria-label', t('viewer.close'));
    $('#viewerClose')?.setAttribute('title', t('viewer.closeTitle'));
    $('#viewerPrev')?.setAttribute('aria-label', t('viewer.prev'));
    $('#viewerPrev')?.setAttribute('title', t('viewer.prevTitle'));
    $('#viewerNext')?.setAttribute('aria-label', t('viewer.next'));
    $('#viewerNext')?.setAttribute('title', t('viewer.nextTitle'));
    $('#viewerZoomIn')?.setAttribute('aria-label', t('viewer.zoomIn'));
    $('#viewerZoomIn')?.setAttribute('title', t('viewer.zoomInTitle'));
    $('#viewerZoomOut')?.setAttribute('aria-label', t('viewer.zoomOut'));
    $('#viewerZoomOut')?.setAttribute('title', t('viewer.zoomOutTitle'));
    $('#viewerRotate')?.setAttribute('aria-label', t('viewer.rotate'));
    $('#viewerRotate')?.setAttribute('title', t('viewer.rotateTitle'));
    $('#viewerReset')?.setAttribute('aria-label', t('viewer.reset'));
    $('#viewerReset')?.setAttribute('title', t('viewer.resetTitle'));
    $('#viewerDownload')?.setAttribute('aria-label', t('viewer.download'));
    $('#viewerDownload')?.setAttribute('title', t('viewer.downloadTitle'));
    overlaysController?.renderPeople(store.getState());
    composerController?.update();
    renderChannels();
    renderTyping();
  }

  // 连接状态指示器的唯一写入点。errorController 建立后由其统一维护状态色与文案。
  function setConnection(online, key, variant = 'default', vars) {
    lastConnection = { online, key, variant, vars };
    errorController.setConnectionStatus(online, t(key, vars), variant);
    if (!embedMode || !embedBridge) return;
    const status = online ? 'online'
      : key === 'status.reconnecting' ? 'reconnecting'
        : key === 'status.offline' ? 'offline'
          : variant === 'connecting' ? 'connecting'
            : 'offline';
    embedBridge.post('connection', { status });
  }

  // Reveal the destination, move focus, then aria-hide the source. Chrome
  // blocks aria-hidden on an ancestor of document.activeElement.
  function moveFocusFrom(root, next) {
    if (!root.contains(document.activeElement)) return;
    if (next && !next.disabled) next.focus();
    if (root.contains(document.activeElement)) document.activeElement.blur();
  }

  function showChat() {
    appShell.hidden = false;
    appShell.setAttribute('aria-hidden', 'false');
    moveFocusFrom(loginScreen, composerText);
    loginScreen.hidden = true;
    loginScreen.setAttribute('aria-hidden', 'true');
    document.body.classList.add('chat-active');
  }

  function showEmbedWaiting(message = '') {
    loginForm.hidden = true;
    copyLinkButton.hidden = true;
    $('#notifyButton').hidden = true;
    $('#loginTitle').dataset.i18nHtml = 'login.embedTitle';
    $('#loginTitle').innerHTML = t('login.embedTitle');
    $('#loginCopy').textContent = message || t('login.embedCopy');
    loginScreen.hidden = false;
    loginScreen.setAttribute('aria-hidden', 'false');
    document.body.classList.remove('chat-active', 'sheet-open', 'viewer-open');
    moveFocusFrom(appShell);
    appShell.hidden = true;
    appShell.setAttribute('aria-hidden', 'true');
  }

  function showLogin(message = '', focus = true) {
    if (embedMode) {
      showEmbedWaiting(message);
      return;
    }
    loginScreen.hidden = false;
    loginScreen.setAttribute('aria-hidden', 'false');
    document.body.classList.remove('chat-active', 'sheet-open', 'viewer-open');
    loginError.textContent = message;
    loginForm.querySelector('.enter-button').disabled = false;
    loginError.textContent = message;
    if (focus) usernameInput.focus();
    else moveFocusFrom(appShell);
    appShell.hidden = true;
    appShell.setAttribute('aria-hidden', 'true');
  }

  function finishResume() {
    if (resumeWatchdog) window.clearTimeout(resumeWatchdog);
    resumeWatchdog = null;
    document.documentElement.classList.remove('resuming');
  }

  function renderChannelChrome(state = store.getState()) {
    const channel = channelById(state.channelId || selectedChannelId);
    $('#roomTitle').textContent = roomInfo?.roomTitle || t('room.defaultTitle');
    if (!channel) return;
    $('#roomHeading').textContent = `${channel.name} · ${channel.id}`;
    const channelIndex = roomChannels.indexOf(channel);
    const totalChannels = roomChannels.length;
    const kicker = $('#roomKicker');
    if (totalChannels > 1) {
      kicker.textContent = t('room.kickerCount', { index: channelIndex + 1, total: totalChannels });
      kicker.hidden = false;
    } else {
      kicker.textContent = '';
      kicker.hidden = true;
    }
    if (channel.description) {
      channelDescription.textContent = channel.description;
      channelDescription.hidden = false;
    } else {
      channelDescription.textContent = '';
      channelDescription.hidden = true;
    }
  }

  function updateChannelOccupancy(state = store.getState()) {
    for (const channel of roomChannels) {
      const meta = channelList.querySelector(`[data-channel-id="${CSS.escape(channel.id)}"] .channel-meta`);
      if (!meta || !channel.enabled) continue;
      const online = state.channelOccupancy?.[channel.id];
      const known = Number.isSafeInteger(online) && online >= 0;
      const count = known ? online : 0;
      const full = known && count >= channel.maxUsers;
      const ariaLabel = known
        ? t('channels.occupancyKnown', { count, max: channel.maxUsers, full: full ? t('channels.fullMark') : '' })
        : t('channels.occupancySyncing', { max: channel.maxUsers });
      const title = known
        ? t('channels.occupancyTitle', { count, max: channel.maxUsers, full: full ? t('channels.fullTitleMark') : '' })
        : t('channels.occupancySyncingTitle');
      const markup = `${iconMarkup('users-round', 12)}<span class="channel-meta-value"><strong>${known ? count : '–'}</strong><span aria-hidden="true">/</span><span>${channel.maxUsers}</span></span>`;
      // 每次占用广播都会走到这里；人数没变时不要重写 innerHTML 与属性。
      PaviloPerformance.smartUpdate(meta, {
        className: `channel-meta${known && count > 0 && !full ? ' occupied' : ''}${full ? ' full' : ''}`,
        title,
        innerHTML: markup,
      });
      if (meta.getAttribute('aria-label') !== ariaLabel) meta.setAttribute('aria-label', ariaLabel);
    }
  }

  function renderChannels(state = store.getState()) {
    const channelId = state.channelId || selectedChannelId;
    const switching = Boolean(state.channel?.switching);
    const joined = Boolean(state.connection?.joined);
    const authorized = joined && Array.isArray(state.channels) && state.channels.length ? state.channels : null;
    const list = authorized
      ? authorized.map((channel) => roomChannels.find((item) => item.id === channel.id) || channel)
      : roomChannels;
    const enabledCount = list.filter((channel) => channel.enabled).length;
    const channelCountEl = $('#channelCount');
    if (enabledCount > 1) {
      channelCountEl.textContent = t('channels.count', { count: enabledCount });
      channelCountEl.hidden = false;
    } else {
      channelCountEl.hidden = true;
    }
    channelList.replaceChildren(...list.map((channel) => {
      const button = document.createElement('button');
      const active = channel.id === channelId;
      button.className = `channel${active ? ' active' : ''}`;
      button.dataset.channelId = channel.id;
      button.type = 'button';
      button.disabled = switching || !channel.enabled;
      button.title = !channel.enabled
        ? t('channels.disabledTitle', { name: channel.name })
        : channel.readOnly
          ? t('channels.readOnlyTitle', { name: channel.name })
          : channel.description || channel.name;
      button.setAttribute('aria-current', active ? 'page' : 'false');
      const badge = channel.readOnly
        ? `<span class="channel-hash channel-hash-readonly">${iconMarkup('megaphone', 13)}</span>`
        : `<span class="channel-hash">#</span>`;
      button.innerHTML = `${badge}<span class="channel-name">${escapeHtml(channel.name)} · ${escapeHtml(channel.id)}</span><span class="channel-meta${channel.enabled ? '' : ' unavailable'}">${channel.enabled ? '' : t('channels.disabled')}</span>`;
      button.addEventListener('click', () => switchChannel(channel.id));
      return button;
    }));
    mobileChannelPicker.replaceChildren(...list.map((channel) => {
      const option = document.createElement('option');
      option.value = channel.id;
      option.disabled = !channel.enabled;
      option.textContent = `${channel.name} · ${channel.id}${channel.enabled ? '' : t('channels.disabledSuffix')}${channel.readOnly ? t('channels.readOnlySuffix') : ''}`;
      return option;
    }));
    if (channelId) mobileChannelPicker.value = channelId;
    mobileChannelPicker.disabled = switching || !joined || !list.some((channel) => channel.enabled);
    updateChannelOccupancy(state);
    renderChannelChrome(state);
    channelRenderKey = `${channelId || ''}|${switching}|${joined}|${list.length}`;
  }

  function applyRoomInfo(info) {
    if (!info || typeof info.defaultChannelId !== 'string' || !Array.isArray(info.channels)) throw new Error('invalid room info');
    const guests = info.identity?.guests !== false;
    const channels = info.channels.filter((channel) => channel && typeof channel.id === 'string' && typeof channel.name === 'string');
    const defaultChannel = channels.find((channel) => channel.id === info.defaultChannelId && channel.enabled);
    if (guests && !defaultChannel) throw new Error('invalid default channel');
    const loginForm = $('#loginForm');
    if (loginForm) loginForm.hidden = !guests;
    roomInfo = info;
    roomChannels = channels;
    maxImageBytes = positiveLimit(info.limits?.maxImageBytes, maxImageBytes);
    maxImagePixels = positiveLimit(info.limits?.maxImagePixels, maxImagePixels);
    maxGifDimension = positiveLimit(info.limits?.maxImageDimension, maxGifDimension);
    const saved = channelById(connection.readChannelId());
    if (!selectedChannelId || !channelById(selectedChannelId)?.enabled) {
      selectedChannelId = saved?.enabled ? saved.id : (defaultChannel?.id || info.defaultChannelId);
    }
    roomInfoReady = true;
    if (info.defaultLanguage && !hasStoredLanguage()) {
      i18n.setLanguage(info.defaultLanguage);
    }
    store.dispatch({ type: 'room/info', channels, limits: info.limits || {} });
    applyStaticCopy();
    composerController?.update();
  }

  function scheduleRoomInfoRetry() {
    if (roomInfoRetryTimer || store.getState().connection.intentionalLeave) return;
    roomInfoRetryTimer = window.setTimeout(() => {
      roomInfoRetryTimer = null;
      loadRoomInfo().then((info) => { if (info && identity && !connection.isReady()) connection.connect(identity); });
    }, 2_000);
  }

  function loadRoomInfo() {
    if (roomInfoReady) return Promise.resolve(roomInfo);
    if (roomInfoPromise) return roomInfoPromise;
    roomInfoPromise = fetch('/room-info', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`room info ${response.status}`);
        return response.json();
      })
      .then((info) => {
        applyRoomInfo(info);
        loginError.textContent = '';
        return info;
      })
      .catch(() => {
        roomInfoReady = false;
        setConnection(false, 'login.configRetryStatus');
        loginError.textContent = t('login.configRetry');
        loginForm.querySelector('.enter-button').disabled = false;
        scheduleRoomInfoRetry();
        return null;
      })
      .finally(() => { roomInfoPromise = null; });
    return roomInfoPromise;
  }

  function checkHealth() {
    return fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
      .then((response) => response.ok)
      .catch(() => false);
  }

  function renderTyping(state = store.getState()) {
    const names = Object.entries(state.typing || {})
      .filter(([id]) => id !== state.self?.id)
      .map(([, item]) => item.username)
      .filter(Boolean);
    if (!names.length) typingLine.textContent = '';
    else if (names.length === 1) typingLine.textContent = t('typing.one', { name: names[0] });
    else if (names.length === 2) typingLine.textContent = t('typing.two', { a: names[0], b: names[1] });
    else typingLine.textContent = t('typing.many', { a: names[0], b: names[1] });
  }

  function pendingSnapshot(item) {
    if (!item) return null;
    const { timer, ...snapshot } = item;
    return snapshot;
  }

  function clearDraftFor(item) {
    if (!draftMatches(item, composerText.value)) return;
    composerText.value = '';
    mentionController.clear();
    if (replyTarget?.id === item.replyToId) composerController?.clearReply();
    composerController?.update();
  }

  function bridgePendingEvent(event) {
    const item = event.item;
    if (event.type === 'added') {
      const snapshot = pendingSnapshot(item);
      if (snapshot) store.dispatch({ type: 'pending/add', item: snapshot });
      return;
    }
    if (event.type === 'rekeyed') {
      if (event.oldId) store.dispatch({ type: 'pending/remove', id: event.oldId });
      const snapshot = pendingSnapshot(item);
      if (snapshot) store.dispatch({ type: 'pending/add', item: snapshot });
      return;
    }
    if (event.type === 'removed') {
      if (item) store.dispatch({ type: 'pending/remove', id: item.id });
      if (event.canonical) clearDraftFor(item);
      return;
    }
    if (event.type === 'reconciled') {
      clearDraftFor(item);
      return;
    }
    if (['changed', 'accepted'].includes(event.type)) {
      const snapshot = pendingSnapshot(item);
      if (snapshot) store.dispatch({ type: 'pending/update', id: item.id, item: snapshot });
      if (event.type === 'accepted') clearDraftFor(item);
    }
  }

  pendingQueue.subscribe(bridgePendingEvent);

  const imagePipeline = PaviloImages.createImages({ getLimits: () => ({
    maxImageBytes,
    maxImageDimension: maxGifDimension,
    maxImagePixels,
  }) });

  function identityForJoin() {
    if (embedMode && embedBridge) {
      const current = embedBridge.current();
      const joined = {
        username: current.username || '',
        resumeToken: current.resumeToken || undefined,
        channelId: PaviloEmbed.channelFromSearch(window.location.search) || current.channelId || selectedChannelId || roomInfo?.defaultChannelId,
      };
      if (current.identityToken) joined.identityToken = current.identityToken;
      return joined;
    }
    const state = store.getState();
    const current = state.self || identity || {};
    return {
      username: current.username || usernameInput.value.trim(),
      avatarSeed: current.avatarSeed,
      resumeToken: state.room?.resumeToken || resumeToken || current.resumeToken,
      channelId: state.channelId || selectedChannelId || roomInfo?.defaultChannelId,
    };
  }

  const connection = PaviloConnection.createConnection({
    location: window.location,
    storage: storage(),
    online: () => navigator.onLine !== false,
    getIdentity: identityForJoin,
  });

  function positionPopover(popover, anchor, heightHint) {
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth || 344;
    const height = popover.offsetHeight || heightHint;
    const gutter = 8;
    const column = document.querySelector('.chat') || document.querySelector('.composer-wrap') || composer;
    const columnRect = column?.getBoundingClientRect();
    const maxRight = Math.min(window.innerWidth - gutter, columnRect ? columnRect.right : window.innerWidth - gutter);
    const minLeft = Math.max(gutter, columnRect ? columnRect.left : gutter);
    let left = maxRight - width;
    if (left < minLeft) left = minLeft;
    if (left + width > window.innerWidth - gutter) left = Math.max(gutter, window.innerWidth - width - gutter);
    let top = rect.top - height - 6;
    if (top < gutter) top = Math.min(rect.bottom + 6, window.innerHeight - height - gutter);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(Math.max(gutter, top))}px`;
  }

  function closeComposerPopover(restoreFocus = false) {
    if (!composerPopoverOpen) return;
    composerPopover.hidden = true;
    composerPopoverOpen = false;
    emojiButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus) emojiButton.focus();
  }

  function openComposerPopover() {
    if (composerPopoverOpen) {
      closeComposerPopover();
      return;
    }
    messagesController?.closeReactionPopover();
    mentionController.close();
    composerPopover.hidden = false;
    composerPopoverOpen = true;
    emojiButton.setAttribute('aria-expanded', 'true');
    positionPopover(composerPopover, emojiButton, 360);
    queueMicrotask(() => {
      const input = composerPicker.shadowRoot?.querySelector('input[type="search"]');
      if (input) input.focus();
      else composerPicker.focus?.();
    });
  }

  function findMessage(id) {
    return store.getState().messages.find((message) => message.id === id) || null;
  }

  function retryPending(id) {
    if (!id || !pendingQueue.get(id)) return false;
    return pendingQueue.retry(id, {
      roomEpoch: store.getState().room?.epoch,
      send: (command) => connection.send(command),
      isReady: () => connection.isReady(),
      now: Date.now,
    });
  }

  function handleModularAction(action) {
    if (!action) return;
    if (action.type === 'retry') return retryPending(action.pendingId);
    if (action.type === 'image') return overlaysController?.openImageViewer(action.messageId, action.anchor);
    if (action.type === 'profile') {
      if (!store.getState().users.some((user) => user.id === action.userId)) return notificationsController.toast(t('toast.memberLeft'));
      return overlaysController?.openProfile(action.userId, action.anchor);
    }
    if (action.type === 'reply') {
      const channel = roomChannels.find((item) => item.id === store.getState().channelId);
      if (channel?.readOnly) return;
      const message = findMessage(action.messageId);
      if (message) composerController?.setReply(message);
      return;
    }
    if (action.type === 'reaction') return connection.send({ type: 'reaction', messageId: action.messageId, emoji: action.emoji, active: action.active });
    if (action.type === 'report') {
      connection.send({ type: 'report', messageId: action.messageId });
      return;
    }
    if (action.type === 'unread/clear') return notificationsController?.clearUnread();
    if (action.type === 'typing/stop') return composerController?.stopTyping();
  }

  const controllerElements = {
    messageList, messageScroll, messageCount,
    reactionPopover: $('#reactionPopover'), reactionChoices: $('#reactionChoices'),
    mentionPopover: $('#mentionPopover'), mentionList: $('#mentionList'), mentionButton: $('#mentionButton'), mentionStatus: $('#mentionStatus'),
    peopleList: $('#peopleList'), mobilePeopleList: $('#mobilePeopleList'), peopleCount: $('#peopleCount'),
    profile: $('#profile'), profileEmpty: $('#profileEmpty'), profileAvatar: $('#profileAvatar'), profileName: $('#profileName'),
    profileYou: $('#profileYou'), profileIp: $('#profileIp'), profileDuration: $('#profileDuration'), profileJoined: $('#profileJoined'),
    mobileProfile: $('#mobileProfile'), mobileSheet: $('#mobileSheet'), mobileSheetBackdrop: $('#mobileSheetBackdrop'),
    membersButton: $('#membersButton'), mobileSheetClose: $('#mobileSheetClose'), imageViewer: $('#imageViewer'), viewerImage: $('#viewerImage'),
    viewerStage: $('#viewerStage'), viewerStatus: $('#viewerStatus'), viewerZoomLabel: $('#viewerZoomLabel'), viewerZoomIn: $('#viewerZoomIn'),
    viewerZoomOut: $('#viewerZoomOut'), viewerAuthor: $('#viewerAuthor'), viewerAvatar: $('#viewerAvatar'), viewerWhen: $('#viewerWhen'),
    viewerDimension: $('#viewerDimension'), viewerPrev: $('#viewerPrev'), viewerNext: $('#viewerNext'), viewerIndex: $('#viewerIndex'),
    viewerDownload: $('#viewerDownload'), viewerRotate: $('#viewerRotate'), viewerReset: $('#viewerReset'), viewerClose: $('#viewerClose'),
    toastRegion: $('#toastRegion'), newMessageJump, newMessageCount: $('#newMessageCount'), notifyButton: $('#notifyButton'), appFavicon: $('#appFavicon'),
    composer, composerText, sendButton: $('#sendButton'), emojiButton, attachmentButton: $('#attachmentButton'), imageInput: $('#imageInput'),
    composerWrap: $('#composerWrap'), composerAttach: $('#composerAttach'), composerAttachThumb: $('#composerAttachThumb'),
    composerAttachImage: $('#composerAttachImage'), composerAttachStatus: $('#composerAttachStatus'),
    composerAttachLabel: $('#composerAttachLabel'), composerAttachHint: $('#composerAttachHint'),
    composerAttachMeta: $('#composerAttachMeta'), composerAttachRetry: $('#composerAttachRetry'),
    composerAttachRemove: $('#composerAttachRemove'),
    composerDrop: $('#composerDrop'), composerHint: $('#composerHint'),
    replyingBar: $('#replyingBar'), replyingName: $('#replyingName'), replyingText: $('#replyingText'), cancelReplyButton: $('#cancelReplyButton'),
    channelReadonlyNotice: $('#channelReadonlyNotice'), appShell,
    errorOverlay: $('#errorOverlay'),
  };

  let messagesController = PaviloMessages.createMessages({
    elements: controllerElements,
    getSelf: () => store.getState().self,
    getState: () => store.getState(),
    onAction: handleModularAction,
    iconMarkup, avatarMarkup, escapeHtml, formatTime, formatDay, t,
    renderMentionText: (text, mentions) => PaviloMentions.renderMentionText(text, mentions, escapeHtml, store.getState().self?.id, t),
  });
  let overlaysController = PaviloOverlays.createOverlays({
    elements: controllerElements,
    getState: () => store.getState(),
    avatarMarkup, escapeHtml, formatTime, formatDay, formatDuration, t,
  });
  let notificationsController = PaviloNotifications.createNotifications({
    elements: controllerElements,
    getState: () => store.getState(),
    onAction: (action) => {
      if (embedMode && action?.type === 'unread') embedBridge?.post('unread', { count: action.count });
      else store.dispatch(action);
    },
    iconMarkup, escapeHtml, t,
    embed: embedMode,
  });
  errorController = PaviloErrorStates.createErrorStates({
    elements: { connectionDot, connectionText, errorOverlay: controllerElements.errorOverlay },
    toast: (...args) => notificationsController.toast(...args),
    iconMarkup, escapeHtml, t,
  });
  const mentionController = PaviloMentions.createMentions({ elements: controllerElements,
    getUsers: () => store.getState().users, getSelf: () => store.getState().self,
    isReady: () => connection.isReady() && !store.getState().channel.switching
      && !Boolean(roomChannels.find((channel) => channel.id === store.getState().channelId)?.readOnly),
    avatarMarkup, t,
    onOpen: () => { closeComposerPopover(); messagesController.closeReactionPopover(); },
    onLimit: () => notificationsController.toast(t('toast.mentionLimit'), 'error'),
    onCandidates: (users) => { window.__paviloMentionCandidates = users; },
  });
  mentionController.bind();
  let composerController = PaviloComposer.createComposer({
    elements: controllerElements,
    getState: () => store.getState(),
    dispatch: (event) => store.dispatch(event),
    connection: { send: (command) => connection.send(command), isReady: () => connection.isReady() },
    pending: pendingQueue,
    mentions: mentionController,
    images: imagePipeline,
    toast: (...args) => notificationsController.toast(...args),
    clearReply: () => { replyTarget = null; },
    getReplyTarget: () => replyTarget,
    setReplyTarget: (value) => { replyTarget = value; },
    getLimits: () => ({ maxTextLength: roomInfo?.limits?.maxTextLength }),
    t,
    canCapturePaste: () => !appShell.hidden && !document.body.classList.contains('viewer-open') && $('#errorOverlay')?.hidden !== false,
    openLocalPreview: (image, opener) => overlaysController?.openLocalImage(image, opener),
    closeLocalPreview: () => overlaysController?.closeImageViewer(false),
  });
  composerController.bind();

  function syncChrome(next, event, previous) {
    if (next.channelId) selectedChannelId = next.channelId;
    const key = `${next.channelId || selectedChannelId || ''}|${Boolean(next.channel?.switching)}|${Boolean(next.connection?.joined)}|${roomChannels.length}`;
    if (key !== channelRenderKey) renderChannels(next);
    else if (next.channelOccupancy !== previous?.channelOccupancy) updateChannelOccupancy(next);
    renderChannelChrome(next);
    switch (event.type) {
      case 'connection/connect': setConnection(false, previous?.connection?.joined ? 'status.reconnecting' : 'status.connecting', 'connecting'); break;
      case 'connection/open': setConnection(false, 'status.entering', 'connecting'); break;
      case 'connection/retry': setConnection(false, 'status.reconnecting', 'connecting'); break;
      case 'connection/error': setConnection(false, 'status.connectError', 'warning'); break;
      case 'connection/close': setConnection(false, event.wasJoined ? 'status.disconnected' : 'status.cannotConnect', 'warning'); break;
      case 'stateStart': showChat(); setConnection(false, next.channel?.switching ? 'status.switching' : 'status.syncing', 'connecting'); break;
      case 'historyEnd':
      case 'state':
        if (next.connection.joined) { showChat(); finishResume(); setConnection(true, 'status.connected'); }
        break;
      case 'channel/request': {
        const target = channelById(next.channel?.requestedId);
        setConnection(true, target ? 'status.switchingTo' : 'status.switching', 'default', target ? { name: target.name } : undefined);
        break;
      }
      case 'error': if (next.connection.joined && !next.channel?.switching) setConnection(true, 'status.connected'); break;
      case 'serviceStopped':
      case 'service/stopped':
      case 'connection/leave': setConnection(false, event.type === 'connection/leave' ? 'status.left' : 'status.stopped'); break;
    }
  }

  store.subscribe((next, event, previous) => {
    if (next.channelId !== previous.channelId || next.self?.id !== previous.self?.id
      || previous.room.epoch && next.room.epoch && next.room.epoch !== previous.room.epoch
      || next.connection.status === 'stopped') {
      mentionController.clear();
      closeComposerPopover();
    }
    syncChrome(next, event, previous);
    messagesController.onState(next, event, previous);
    overlaysController.onState(next, event, previous);
    notificationsController.onState(next, event, previous);
    composerController.update();
    renderTyping(next);
  });

  function finishJoined(epoch, authoritativeMessages, reconnect) {
    const joinedId = store.getState().channelId;
    if (redirectIfPlayChannel(joinedId) || consumePlayNext()) return;
    connection.markJoined(true);
    // 重连成功后收起任何阻塞性错误覆盖层。
    errorController.clearError();
    pendingQueue.reconcile(authoritativeMessages, {
      roomEpoch: epoch,
      allowRetry: reconnect,
      send: (command) => connection.send(command),
      isReady: () => connection.isReady(),
    });
    reconnectingAfterClose = false;
    composerController.update();
    window.requestAnimationFrame(() => composerText.focus());
  }

  function persistJoin(event, state) {
    if (event.channelId) {
      selectedChannelId = event.channelId;
      connection.writeChannelId(event.channelId);
    }
    if (event.self) identity = { ...(identity || {}), username: event.self.username, avatarSeed: event.self.avatarSeed, channelId: event.channelId || selectedChannelId };
    if (typeof event.resumeToken === 'string' && event.resumeToken) {
      resumeToken = event.resumeToken;
      identity = { ...(identity || {}), resumeToken };
      connection.setSession({ token: resumeToken, username: event.self.username });
      embedBridge?.setResumeToken(resumeToken);
    }
    if (state.channelId) selectedChannelId = state.channelId;
  }

  function returnToLoginForError(event, message) {
    connection.close({ intentional: true });
    pendingQueue.clear();
    composerController.clearReply();
    connection.clearSession();
    connection.clearChannelId();
    resumeToken = null;
    identity = null;
    showLogin(message || event.message);
  }

  function handleProtocolError(event, before) {
    if (embedMode && !before.connection.joined) {
      embedBridge?.post('error', { code: event.code });
      connection.close({ intentional: true });
      showEmbedWaiting(event.message || '');
      return;
    }
    if (event.code === 'PROTOCOL_NOT_SUPPORTED') {
      errorController.showErrorOverlay('PROTOCOL_NOT_SUPPORTED', {
        onAction: () => window.location.reload(),
      });
      connection.close({ intentional: true });
      return;
    }
    if (event.code === 'IP_DENIED' || event.code === 'KICKED') {
      returnToLoginForError(event);
      errorController.showErrorOverlay(event.code === 'KICKED' ? 'KICKED' : 'IP_DENIED', {
        onAction: () => errorController.hideErrorOverlay(),
      });
      return;
    }
    if (event.clientMessageId) {
      pendingQueue.markError(event.clientMessageId, event.message);
      notificationsController.toast(event.message, 'error');
      return;
    }
    if (before.channel?.switching && ['CHANNEL_FULL', 'CHANNEL_UNAVAILABLE', 'NAME_TAKEN', 'RATE_LIMITED', 'SYNC_IN_PROGRESS'].includes(event.code)) {
      const target = channelById(before.channel.requestedId);
      const fallback = event.code === 'CHANNEL_FULL'
        ? t('error.switchFull')
        : event.code === 'CHANNEL_UNAVAILABLE'
          ? t('error.switchUnavailable')
          : event.code === 'NAME_TAKEN'
            ? t('error.switchNameTaken')
            : t('error.switchGeneric');
      notificationsController.toast(event.message
        ? t('toast.switchKeep', { detail: event.message })
        : t('toast.switchKeepNamed', { name: target?.name || t('channels.heading'), fallback }), 'error');
      return;
    }
    if (!before.connection.joined && ['CHANNEL_FULL', 'CHANNEL_UNAVAILABLE', 'SERVER_FULL'].includes(event.code)) {
      returnToLoginForError(event, event.message || (event.code === 'CHANNEL_FULL'
        ? t('error.channelFullJoin') : t('error.channelUnavailableJoin')));
      return;
    }
    if (['NAME_TAKEN', 'INVALID_NAME', 'SESSION_CONFLICT'].includes(event.code)) {
      const wasVisible = !appShell.hidden || Boolean(before.connection.joined);
      if (event.code !== 'NAME_TAKEN') connection.clearSession();
      connection.close({ intentional: true });
      pendingQueue.clear();
      composerController.clearReply();
      if (wasVisible) notificationsController.toast(event.message, 'error');
      showLogin(wasVisible ? '' : event.message);
      return;
    }
    notificationsController.toast(event.message, 'error');
    if (!loginScreen.hidden) loginForm.querySelector('.enter-button').disabled = false;
  }

  function handlePresence(event, before) {
    if (before.sync?.active || event.action === 'reconnect' || appShell.hidden) return;
    if (event.userId === before.self?.id) {
      if (event.action !== 'leave') notificationsController.toast(event.username ? t('toast.youBackNamed', { name: event.username }) : t('toast.youBack'), 'success');
      return;
    }
    if (event.action === 'join' && event.user) notificationsController.toast(t('toast.userJoined', { name: event.user.username }), 'presence');
    else if (event.action === 'leave') notificationsController.toast(t('toast.userLeft', { name: event.username }), 'presence');
  }

  function handleServerMessage(payload) {
    const parsedEvent = parseServerEvent(payload);
    if (!parsedEvent) return;
    const before = store.getState();
    const event = parsedEvent.type === 'message'
      ? { ...parsedEvent, canMarkRead: notificationsController.canMarkRead() }
      : parsedEvent;
    const authoritativeMessages = event.type === 'historyEnd' ? [...(before.sync?.messages || [])] : null;
    store.dispatch(event);
    const after = store.getState();

    if (event.type === 'stateStart') {
      persistJoin(event, after);
      showChat();
      if (embedMode) embedBridge?.post('ready', { channelId: event.channelId });
      return;
    }
    if (event.type === 'historyEnd') {
      finishJoined(after.room?.epoch || event.roomEpoch, authoritativeMessages || [], reconnectingAfterClose);
      return;
    }
    if (event.type === 'state') {
      persistJoin(event, after);
      finishJoined(after.room?.epoch || event.roomEpoch, event.messages || [], reconnectingAfterClose);
      return;
    }
    if (event.type === 'ack') {
      pendingQueue.settleAck(event, after.messages || []);
      return;
    }
    if (event.type === 'message') {
      pendingQueue.reconcile([event.message], { roomEpoch: after.room?.epoch });
      return;
    }
    if (event.type === 'reportReceived') {
      notificationsController.toast(t('toast.reported'));
      return;
    }
    if (event.type === 'error') {
      handleProtocolError(event, before);
      return;
    }
    if (event.type === 'moderation') {
      composerController.update();
      return;
    }
    if (event.type === 'presence') handlePresence(event, before);
  }

  connection.subscribe((event) => {
    if (event.type === 'connecting') { store.dispatch({ type: 'connection/connect' }); return; }
    if (event.type === 'open') { store.dispatch({ type: 'connection/open' }); return; }
    if (event.type === 'payload') { handleServerMessage(event.payload); return; }
    if (event.type === 'error') { store.dispatch({ type: 'connection/error', error: event.error || event.event || null }); return; }
    if (event.type === 'retryScheduled') {
      store.dispatch({ type: 'connection/retry', attempt: event.attempt, max: event.max });
      // 如果尚未加入（登录阶段），在登录页显示重试进度
      if (!store.getState().connection.joined) {
        loginError.textContent = t('login.retrying', { attempt: event.attempt, max: event.max });
      }
      return;
    }
    if (event.type === 'maxRetriesReached') {
      store.dispatch({ type: 'connection/failed' });
      if (!store.getState().connection.joined) {
        showLogin(t('login.serviceDown'));
        errorController.handleError('CONNECTION_FAILED', { onAction: () => window.location.reload() });
      } else {
        errorController.showErrorOverlay('CONNECTION_FAILED', {
          message: t('error.overlayBrokenTitle'),
          detail: t('error.overlayBrokenDetail'),
          action: t('error.overlayRefresh'),
          onAction: () => window.location.reload(),
        });
        setConnection(false, 'status.broken', 'warning');
      }
      return;
    }
    if (event.type === 'close') {
      reconnectingAfterClose = Boolean(event.wasJoined) && !event.terminal;
      pendingQueue.disconnect();
      store.dispatch({ type: 'connection/close', code: event.code, reason: event.reason, intentional: event.intentional, wasJoined: event.wasJoined, terminal: event.terminal });
      if (event.wasJoined && !event.intentional && !event.terminal) {
        notificationsController.toast(t('toast.disconnectedKeep'), 'error');
      }
      return;
    }
    if (event.type === 'moderationClose') {
      pendingQueue.clear();
      connection.clearSession();
      connection.clearChannelId();
      resumeToken = null;
      identity = null;
      if (embedMode && event.reason === 'identity') {
        embedBridge?.clear();
        embedBridge?.post('identity-expired');
        showEmbedWaiting(t('login.embedExpired'));
        embedBridge?.hello();
        return;
      }
      composerController.clearReply();
      composerController.clearAttachment();
      showLogin();
      const type = event.reason === 'denied' ? 'IP_DENIED'
        : event.reason === 'user' ? 'USER_DENIED'
          : event.reason === 'identity' ? 'IDENTITY_EXPIRED'
            : 'KICKED';
      if (errorController.getCurrentError() !== type) {
        errorController.showErrorOverlay(type, { onAction: () => errorController.hideErrorOverlay() });
      }
      return;
    }
    if (event.type === 'serviceStopped') {
      pendingQueue.clear();
      errorController.clearError();
      if (store.getState().connection.status !== 'stopped') store.dispatch({ type: 'serviceStopped' });
      connection.clearSession();
      connection.clearChannelId();
      resumeToken = null;
      identity = null;
      composerController.clearReply();
      composerController.clearAttachment();
      finishResume();
      showLogin(t('login.serviceStopped'));
    }
  });

  function playPageUrl(channel) {
    if (!embedMode) return `/plays/${channel.play}/?channel=${encodeURIComponent(channel.id)}`;
    return PaviloEmbed.withCredential(
      PaviloEmbed.playEmbedUrl(channel.play, channel.id),
      embedBridge?.current()?.identityToken,
    );
  }

  function leaveForNavigation() {
    if (connection.getSocket()?.readyState === WebSocket.OPEN) connection.sendRaw({ type: 'leave' });
    connection.close({ intentional: true });
  }

  function redirectIfPlayChannel(channelId) {
    const channel = channelById(channelId);
    if (!channel?.play) return false;
    if (embedMode) leaveForNavigation();
    window.location.replace(playPageUrl(channel));
    return true;
  }

  function consumePlayNext() {
    if (embedMode) return false;
    try {
      const next = sessionStorage.getItem('pavilo.next');
      if (next && next.startsWith('/plays/')) {
        sessionStorage.removeItem('pavilo.next');
        window.location.replace(next);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  function switchChannel(channelId) {
    const channel = channelById(channelId);
    const state = store.getState();
    if (!channel || channel.id === state.channelId) { renderChannels(state); return; }
    if (channel.play) {
      if (embedMode) leaveForNavigation();
      window.location.assign(playPageUrl(channel));
      return;
    }
    if (!channel.enabled) {
      notificationsController.toast(t('toast.channelDisabled'), 'error');
      renderChannels(state);
      return;
    }
    if (state.channel?.switching) {
      notificationsController.toast(t('toast.channelBusy'));
      return;
    }
    if (pendingQueue.unsafeChannelWork(composerText.value, composerController.imageProcessingCount)
      || composerController.hasAttachment) {
      const pendingWork = pendingQueue.pendingChannelWork();
      const reason = composerController.imageProcessingCount
        ? t('toast.channelBlockedImage')
        : pendingWork ? t('toast.channelBlockedPending')
          : composerController.hasAttachment ? t('toast.channelBlockedAttach')
            : t('toast.channelBlockedDraft');
      notificationsController.toast(t('toast.channelBlocked', { reason }), 'error');
      return;
    }
    if (!connection.isReady()) {
      notificationsController.toast(t('toast.switchNotReady'), 'error');
      return;
    }
    composerController.stopTyping();
    store.dispatch({ type: 'channel/request', channelId: channel.id });
    if (!connection.sendRaw({ type: 'switchChannel', channelId: channel.id })) {
      store.dispatch({ type: 'error', code: 'CHANNEL_UNAVAILABLE', message: t('error.switchSendFailed') });
    }
  }

  function submitLogin(event) {
    event.preventDefault();
    const username = usernameInput.value.trim();
    if (!username) { loginError.textContent = t('login.emptyName'); return; }

    loginForm.querySelector('.enter-button').disabled = true;
    loginError.textContent = t('login.checking');

    checkHealth().then((healthy) => {
      if (!healthy) {
        loginError.textContent = t('login.serviceDown');
        loginForm.querySelector('.enter-button').disabled = false;
        return;
      }

      if (!roomInfoReady) {
        loginError.textContent = t('login.loadingRoom');
        loadRoomInfo().then((info) => {
          if (info) {
            loginError.textContent = '';
            submitLogin({ preventDefault() {} });
          } else {
            loginForm.querySelector('.enter-button').disabled = false;
            loginError.textContent = t('login.roomFailed');
          }
        });
        return;
      }

      const saved = connection.readSession();
      if (saved && saved.username !== username) {
        connection.clearSession();
        connection.clearChannelId();
        resumeToken = null;
      }
      identity = { username, channelId: selectedChannelId || roomInfo.defaultChannelId };
      resumeToken = null;
      loginError.textContent = t('login.connecting');
      connection.connect(identity);
    });
  }

  function leaveRoom() {
    if (leaveTimer) { window.clearTimeout(leaveTimer); leaveTimer = null; }
    if (connection.getSocket()?.readyState === WebSocket.OPEN) connection.sendRaw({ type: 'leave' });
    connection.close({ intentional: true });
    connection.clearSession();
    connection.clearChannelId();
    pendingQueue.clear();
    composerController.clearReply();
    composerController.clearAttachment();
    resumeToken = null;
    identity = null;
    selectedChannelId = roomInfo?.defaultChannelId || null;
    composerText.value = '';
    store.dispatch({ type: 'connection/leave' });
    if (embedMode) {
      embedBridge?.clear();
      embedBridge?.post('left');
      showEmbedWaiting('');
      return;
    }
    showLogin('');
    usernameInput.value = '';
  }

  loginForm.addEventListener('submit', submitLogin);
  mobileChannelPicker.addEventListener('change', () => switchChannel(mobileChannelPicker.value));
  emojiButton.addEventListener('click', openComposerPopover);
  composerPicker.addEventListener('emoji-click', (event) => {
    const emoji = event.detail?.unicode || event.detail?.emoji?.emoji;
    if (!emoji) return;
    const start = composerText.selectionStart;
    const end = composerText.selectionEnd;
    composerText.value = `${composerText.value.slice(0, start)}${emoji}${composerText.value.slice(end)}`;
    composerText.selectionStart = composerText.selectionEnd = start + emoji.length;
    composerText.focus();
    composerText.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.addEventListener('pointerdown', (event) => {
    if (mentionController.isOpen() && !$('#mentionPopover').contains(event.target) && event.target !== composerText) mentionController.close();
    if (!$('#reactionPopover').hidden && !$('#reactionPopover').contains(event.target)) messagesController.closeReactionPopover();
    if (composerPopoverOpen && !composerPopover.contains(event.target) && event.target !== emojiButton) closeComposerPopover();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !$('#mobileSheet').hidden) return;
    if (mentionController.isOpen()) mentionController.close();
    else if (!$('#reactionPopover').hidden) messagesController.closeReactionPopover();
    else if (composerPopoverOpen) closeComposerPopover(true);
  });
  function maybeLoadHistory() {
    const state = store.getState();
    if (!connection.isReady() || state.sync?.active || state.channel?.switching) return;
    if (state.historyPage?.loading || state.historyPage?.exhausted) return;
    if (!(state.room.capabilities || []).includes('historyPage')) return;
    if (messageScroll.scrollTop > 48) return;
    const oldest = state.messages[0];
    if (!Number.isSafeInteger(oldest?.seq) || oldest.seq < 1) {
      store.dispatch({ type: 'historyPage/request' });
      store.dispatch({ type: 'historyPageEnd', exhausted: true, beforeSeq: 0, roomEpoch: state.room.epoch });
      return;
    }
    store.dispatch({ type: 'historyPage/request' });
    connection.send({ type: 'historyPage', beforeSeq: oldest.seq, limit: 50 });
  }

  messageScroll.addEventListener('scroll', () => {
    mentionController.close();
    messagesController.closeReactionPopover();
    closeComposerPopover();
    maybeLoadHistory();
  }, { passive: true });
  window.addEventListener('online', () => {
    errorController.clearError();
    if (connection.handleOnline()) setConnection(false, 'status.reconnecting', 'connecting');
  });
  window.addEventListener('offline', () => {
    connection.handleOffline();
    errorController.handleError('OFFLINE', { statusText: t('status.offline'), showToast: false });
  });
  window.addEventListener('pagehide', () => {
    composerController.stopTyping();
    if (embedMode) connection.close({ intentional: true });
  });
  window.addEventListener('pageshow', (event) => {
    if (embedMode && event.persisted) embedBridge?.hello();
  });
  languageButton?.addEventListener('click', () => {
    i18n.setLanguage(i18n.language === 'en' ? 'zh-CN' : 'en');
  });
  leaveButton.addEventListener('click', () => {
    if (leaveButton.classList.contains('confirming')) {
      leaveButton.classList.remove('confirming');
      leaveButton.querySelector('.top-action-label').textContent = t('top.leave');
      leaveRoom();
      return;
    }
    leaveButton.classList.add('confirming');
    leaveButton.querySelector('.top-action-label').textContent = t('top.leaveConfirm');
    leaveTimer = window.setTimeout(() => {
      leaveTimer = null;
      leaveButton.classList.remove('confirming');
      leaveButton.querySelector('.top-action-label').textContent = t('top.leave');
    }, 3_000);
  });
  copyLinkButton.addEventListener('click', async () => {
    let url = window.location.href;
    try {
      if (!roomInfo) roomInfo = await fetch('/room-info', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null);
      if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') && roomInfo?.lanUrls?.length) url = roomInfo.lanUrls[0];
      if (navigator.share) await navigator.share({ title: t('toast.shareTitle'), text: t('toast.shareText'), url });
      else {
        await navigator.clipboard.writeText(url);
        notificationsController.toast(t('toast.copied'));
      }
    } catch (error) {
      if (error?.name !== 'AbortError') notificationsController.toast(t('toast.copyManual', { url }), 'error');
    }
  });

  window.setInterval(() => {
    if (store.getState().connection.joined) store.dispatch({ type: 'typing/expire' });
  }, 1_000);

  for (const host of document.querySelectorAll('[data-icon]')) {
    host.innerHTML = iconMarkup(host.dataset.icon, Number(host.dataset.iconSize) || 0);
  }
  i18n.subscribe(() => {
    applyStaticCopy();
    messagesController.renderHistory?.(true);
    notificationsController?.refreshCopy?.();
  });
  applyStaticCopy();
  if (embedMode) {
    embedBridge = PaviloEmbed.createEmbedBridge({
      window,
      parent: window.parent,
      ancestors: PaviloEmbed.ancestorsFrom(window),
    });
    embedBridge.subscribe((event) => {
      if (event.type !== 'identity') return;
      const next = event.identity;
      if (!next.username && !next.identityToken) return;
      const previousToken = identity?.identityToken || '';
      if (previousToken && previousToken !== (next.identityToken || '')) {
        resumeToken = null;
        connection.clearSession();
        connection.close({ intentional: true });
      }
      identity = {
        username: next.username,
        channelId: PaviloEmbed.channelFromSearch(window.location.search) || next.channelId,
        identityToken: next.identityToken,
        resumeToken: previousToken && previousToken === next.identityToken ? (resumeToken || '') : '',
      };
      if (identity.resumeToken) embedBridge.setResumeToken(identity.resumeToken);
      selectedChannelId = identity.channelId || selectedChannelId;
      usernameInput.value = identity.username;
      loadRoomInfo().then((info) => {
        if (!info) return;
        connection.connect(identity);
      });
    });
    window.addEventListener('message', (event) => embedBridge.handleMessage(event));
    showEmbedWaiting('');
    finishResume();
    const fragmentToken = PaviloEmbed.consumeFragmentToken(window);
    if (fragmentToken) {
      embedBridge.acceptFragment(fragmentToken, PaviloEmbed.channelFromSearch(window.location.search));
    }
    embedBridge.hello();
  } else {
  const savedResume = connection.readSession();
  if (savedResume) {
    resumeWatchdog = window.setTimeout(() => {
      finishResume();
      if (!store.getState().connection.joined) showLogin(t('login.resumeFailed'), false);
    }, 12_000);
    resumeToken = savedResume.token;
    identity = { username: savedResume.username, resumeToken, channelId: connection.readChannelId() || undefined };
    usernameInput.value = savedResume.username;
    showChat();
    messagesController.renderHistory(true);
    loadRoomInfo().then((info) => {
      if (info) {
        identity.channelId = selectedChannelId;
        connection.connect(identity);
      }
    });
  } else {
    usernameInput.focus();
    finishResume();
    loadRoomInfo();
  }
  }

  // The composition root imports these alongside the parser so ownership of the
  // protocol version and its exact deferred-event set remains explicit.
  void PROTOCOL_VERSION;
  void DEFERRED_EVENTS;
})();
