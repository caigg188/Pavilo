(() => {
  'use strict';

  const play = PaviloPlay.createPlayClient();
  const stateEl = document.getElementById('state');
  const logEl = document.getElementById('log');
  const statusEl = document.getElementById('status');
  const channelsEl = document.getElementById('channels');
  const params = new URLSearchParams(location.search);
  const channelId = params.get('channel');
  const embedded = params.get('embed') === '1';
  if (embedded) {
    const home = document.querySelector('.mark');
    if (home) {
      home.addEventListener('click', (event) => {
        event.preventDefault();
        location.assign(play.embedReturnUrl());
      });
    }
  }

  function log(line) {
    const item = document.createElement('li');
    item.textContent = line;
    logEl.prepend(item);
  }

  function renderChannels() {
    const current = play.currentChannel()?.id || channelId;
    channelsEl.replaceChildren(...(play.channels || []).filter((channel) => channel.enabled).map((channel) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = channel.name;
      button.className = channel.id === current ? 'active' : '';
      button.addEventListener('click', () => play.switchToChannel(channel));
      return button;
    }));
  }

  play.subscribe((event) => {
    if (event.type === 'connecting') statusEl.textContent = 'connecting';
    if (event.type === 'open' || event.type === 'stateStart') statusEl.textContent = 'online';
    if (event.type === 'stateStart') renderChannels();
    if (event.type === 'playState') {
      stateEl.textContent = JSON.stringify(event.state, null, 2);
      log(`playState ${event.visibility} seq=${event.seq}`);
    }
    if (event.type === 'message') log(`${event.message.author.username}: ${event.message.text || ''}`);
    if (event.type === 'error') log(`error ${event.code}: ${event.message}`);
  });

  document.getElementById('echoForm').addEventListener('submit', (event) => {
    event.preventDefault();
    play.playAction('echo', { text: document.getElementById('echoText').value });
  });
  document.getElementById('shoutForm').addEventListener('submit', (event) => {
    event.preventDefault();
    play.playAction('shout', { text: document.getElementById('shoutText').value });
  });
  document.getElementById('summon').addEventListener('click', () => play.playAction('summon', {}));
  document.getElementById('leave').addEventListener('click', () => {
    const next = play.embedReturnUrl();
    play.leave();
    location.assign(next);
  });

  play.start({ channelId });
})();
