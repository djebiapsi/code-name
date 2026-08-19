/* ── État local ─────────────────────────────────────────────────────────────── */
let myName = '';
let myRoom = '';
let myTeam = null;
let myRole = 'agent';
let isHost = false;
let gameMode = 'classic'; // 'classic' | 'duo'
let myDuoIndex = -1;      // 0 ou 1 en mode duo

/* ── Socket ─────────────────────────────────────────────────────────────────── */
const socket = io({ reconnectionAttempts: 10 });
socket.on('connect_error', () => toast('Connexion perdue…', 'error'));

/* ── Screens ────────────────────────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

/* ══════════════════════════════════════════════════════════════════════════════
   HOME
══════════════════════════════════════════════════════════════════════════════ */
document.getElementById('btn-create').addEventListener('click', () => showScreen('screen-create'));
document.getElementById('btn-create-duo').addEventListener('click', () => showScreen('screen-create-duo'));
document.getElementById('btn-join-nav').addEventListener('click', () => showScreen('screen-join'));
document.getElementById('btn-rules-nav').addEventListener('click', () => showScreen('screen-rules'));

/* ══════════════════════════════════════════════════════════════════════════════
   MODE CLASSIQUE
══════════════════════════════════════════════════════════════════════════════ */

// ── Create ───────────────────────────────────────────────────────────────────
document.getElementById('btn-create-room').addEventListener('click', () => {
  const name = document.getElementById('create-name').value.trim();
  if (!name) return toast('Entre ton prénom.', 'error');
  myName = name; gameMode = 'classic';
  socket.emit('create-room', { playerName: name });
});

socket.on('room-created', ({ code, player }) => {
  myRoom = code; isHost = true; myTeam = null; myRole = 'agent';
  document.getElementById('lobby-code').textContent = code;
  updateClassicLobby([player], true);
  showLobbyButtons(true);
  showScreen('screen-lobby');
});

// ── Join ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-join-room').addEventListener('click', () => {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return toast('Entre ton prénom.', 'error');
  if (code.length !== 6) return toast('Le code fait 6 caractères.', 'error');
  myName = name;
  socket.emit('join-room', { code, playerName: name });
});

socket.on('room-joined', ({ code, player }) => {
  myRoom = code; isHost = false; myTeam = null; myRole = 'agent'; gameMode = 'classic';
  document.getElementById('lobby-code').textContent = code;
  updateClassicLobby([player], false);
  showLobbyButtons(false);
  showScreen('screen-lobby');
});

socket.on('room-updated', ({ players, state }) => {
  if (state === 'lobby') {
    const me = players.find(p => p.id === socket.id);
    if (me) { myTeam = me.team; myRole = me.role; }
    updateClassicLobby(players, isHost);
    showLobbyButtons(isHost);
    showScreen('screen-lobby');
    return;
  }
  const me = players.find(p => p.id === socket.id);
  if (me) { myTeam = me.team; myRole = me.role; }
  updateClassicLobby(players, isHost);
  refreshStartButton(players);
});

socket.on('room-error', ({ message }) => toast(message, 'error'));

// ── Leave lobby ──────────────────────────────────────────────────────────────
document.getElementById('btn-leave-lobby').addEventListener('click', resetAndHome);

function showLobbyButtons(host) {
  document.getElementById('btn-start').style.display = host ? '' : 'none';
  document.getElementById('lobby-guest-msg').style.display = host ? 'none' : '';
}

function updateClassicLobby(players, host) {
  const redEl  = document.getElementById('lobby-red-players');
  const blueEl = document.getElementById('lobby-blue-players');
  const unEl   = document.getElementById('lobby-unassigned');
  redEl.innerHTML = ''; blueEl.innerHTML = ''; unEl.innerHTML = '';

  players.forEach(p => {
    const isMe = p.id === socket.id;
    const chip = document.createElement('div');
    chip.className = 'player-chip' + (isMe ? ' me' : '');
    chip.innerHTML = `<span>${p.name}</span><span class="role-badge">${p.role === 'spymaster' ? '👁' : '🕵'} ${p.role === 'spymaster' ? 'Maître' : 'Agent'}</span>`;
    if (p.team === 'red') redEl.appendChild(chip);
    else if (p.team === 'blue') blueEl.appendChild(chip);
    else { const c = document.createElement('div'); c.className = 'unassigned-chip'; c.textContent = p.name; unEl.appendChild(c); }
  });
  refreshStartButton(players);
  highlightMyPick();
}

function refreshStartButton(players) {
  const redSpy  = players.find(p => p.team === 'red'  && p.role === 'spymaster');
  const blueSpy = players.find(p => p.team === 'blue' && p.role === 'spymaster');
  const hasRed  = players.some(p => p.team === 'red');
  const hasBlue = players.some(p => p.team === 'blue');
  const btn = document.getElementById('btn-start');
  const ok = redSpy && blueSpy && hasRed && hasBlue;
  btn.disabled = !ok;
  btn.textContent = ok ? 'Démarrer la partie' : 'En attente des équipes…';
}

// ── Role picker ──────────────────────────────────────────────────────────────
document.querySelectorAll('#team-picker .role-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const team = btn.dataset.team; const role = btn.dataset.role;
    myTeam = team; myRole = role;
    socket.emit('set-team-role', { code: myRoom, team, role });
    highlightMyPick();
  });
});

function highlightMyPick() {
  document.querySelectorAll('#team-picker .role-btn').forEach(btn => {
    const match = btn.dataset.team === myTeam && btn.dataset.role === myRole;
    btn.className = 'role-btn' + (match ? ` active-${myTeam}` : '');
  });
}

document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('start-game', { code: myRoom });
});

// ── Game classique ───────────────────────────────────────────────────────────
socket.on('game-started', (state) => {
  const me = state.players.find(p => p.id === socket.id);
  if (me) { myTeam = me.team; myRole = me.role; }
  renderClassicGame(state);
  showScreen('screen-game');
});

socket.on('state-update', (state) => {
  if (state.state === 'finished') {
    renderClassicGame(state);
    setTimeout(() => showClassicEnd(state), 700);
    return;
  }
  renderClassicGame(state);
});

socket.on('hint-given', (data) => {
  renderHintBanner('classic', data.currentTeam, data.word, data.count, data.guessesLeft);
  const isMyAgent = myRole === 'agent' && myTeam === data.currentTeam;
  document.getElementById('agent-zone').style.display = isMyAgent ? '' : 'none';
});

function renderClassicGame(state) {
  document.getElementById('score-red-num').textContent  = state.redLeft;
  document.getElementById('score-blue-num').textContent = state.blueLeft;
  document.getElementById('score-red').className  = 'team-score red'  + (state.currentTeam === 'red'  ? ' active-red'  : '');
  document.getElementById('score-blue').className = 'team-score blue' + (state.currentTeam === 'blue' ? ' active-blue' : '');

  const teamLabel = state.currentTeam === 'red' ? 'ROUGE' : 'BLEU';
  const ti = document.getElementById('turn-indicator');
  ti.textContent = `${teamLabel} joue`;
  ti.className = `turn-indicator ${state.currentTeam}`;

  document.getElementById('my-role-tag').textContent = myRole === 'spymaster' ? '👁 Maître-espion' : '🕵 Agent';

  if (state.currentHint) {
    renderHintBanner('classic', state.currentTeam, state.currentHint.word, state.currentHint.count, state.guessesLeft);
  } else {
    const b = document.getElementById('hint-banner');
    b.className = 'hint-banner waiting'; b.textContent = 'En attente de l\'indice…';
  }

  renderClassicGrid(state.grid, state.currentTeam, state.currentHint, state.players);

  const isMySpy   = myRole === 'spymaster' && myTeam === state.currentTeam;
  const hintGiven = !!state.currentHint;
  const myTeammates = state.players.filter(q => q.team === myTeam);
  const spyAlone    = myRole === 'spymaster' && !myTeammates.some(q => q.role === 'agent');
  const isMyAgent   = (myRole === 'agent' || spyAlone) && myTeam === state.currentTeam;

  document.getElementById('spymaster-zone').style.display = (isMySpy && !hintGiven) ? '' : 'none';
  document.getElementById('agent-zone').style.display     = (isMyAgent && hintGiven) ? '' : 'none';
}

function renderClassicGrid(grid, currentTeam, hint, players) {
  const el = document.getElementById('grid');
  el.innerHTML = '';
  const isMySpy  = myRole === 'spymaster';
  const myTeammates = players ? players.filter(q => q.team === myTeam) : [];
  const spyAlone = isMySpy && !myTeammates.some(q => q.role === 'agent');
  const isMyTurn = myTeam === currentTeam && (myRole === 'agent' || spyAlone) && !!hint;

  grid.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'grid-card';
    div.textContent = card.word;

    if (card.revealed) {
      div.classList.add('revealed', `color-${card.color}`);
    } else if (isMySpy) {
      div.classList.add(`spy-${card.color}`);
    } else {
      div.classList.add('hidden', isMyTurn ? 'my-turn' : 'not-my-turn');
      if (isMyTurn) {
        div.addEventListener('click', () => socket.emit('guess-word', { code: myRoom, index: i }));
      }
    }
    el.appendChild(div);
  });
}

document.getElementById('btn-give-hint').addEventListener('click', () => {
  const word = document.getElementById('hint-word-input').value.trim();
  const count = parseInt(document.getElementById('hint-count-input').value, 10);
  if (!word) return toast('Écris un indice.', 'error');
  if (word.includes(' ')) return toast('Un seul mot.', 'error');
  socket.emit('give-hint', { code: myRoom, word, count });
  document.getElementById('hint-word-input').value = '';
  document.getElementById('spymaster-zone').style.display = 'none';
});

document.getElementById('btn-end-turn').addEventListener('click', () => {
  socket.emit('end-turn', { code: myRoom });
});

function showClassicEnd(state) {
  const team = state.winner;
  document.getElementById('end-emoji').textContent     = team === 'red' ? '🔴' : '🔵';
  document.getElementById('end-team-name').textContent = `Équipe ${team === 'red' ? 'Rouge' : 'Bleu'}`;
  document.getElementById('end-team-name').className   = `winner-name ${team}`;
  document.getElementById('end-cause').textContent     = state.winCause === 'assassin'
    ? "L'équipe adverse a touché l'assassin 💀"
    : "Tous les mots de l'équipe ont été trouvés !";
  showScreen('screen-end');
}

document.getElementById('btn-rematch').addEventListener('click', () => {
  if (isHost) socket.emit('rematch', { code: myRoom });
  else toast('Seul l\'hôte peut relancer.', 'info');
});
document.getElementById('btn-back-lobby').addEventListener('click', () => {
  if (isHost) socket.emit('back-to-lobby', { code: myRoom });
  else toast('Seul l\'hôte peut faire ça.', 'info');
});
document.getElementById('btn-home-end').addEventListener('click', resetAndHome);

/* ══════════════════════════════════════════════════════════════════════════════
   MODE DUO
══════════════════════════════════════════════════════════════════════════════ */

// ── Create duo ───────────────────────────────────────────────────────────────
document.getElementById('btn-create-duo-room').addEventListener('click', () => {
  const name = document.getElementById('duo-create-name').value.trim();
  if (!name) return toast('Entre ton prénom.', 'error');
  myName = name; gameMode = 'duo';
  socket.emit('create-duo-room', { playerName: name });
});

socket.on('duo-room-created', ({ code }) => {
  myRoom = code; isHost = true; myDuoIndex = 0;
  document.getElementById('duo-lobby-code').textContent = code;
  renderDuoLobby([{ name: myName }]);
  document.getElementById('btn-start-duo').style.display = '';
  document.getElementById('duo-lobby-guest-msg').style.display = 'none';
  document.getElementById('btn-start-duo').disabled = true;
  document.getElementById('btn-start-duo').textContent = 'En attente du 2ème joueur…';
  showScreen('screen-duo-lobby');
});

socket.on('duo-room-joined', ({ code, myIndex }) => {
  myRoom = code; isHost = false; myDuoIndex = myIndex; gameMode = 'duo';
  document.getElementById('duo-lobby-code').textContent = code;
  document.getElementById('btn-start-duo').style.display = 'none';
  document.getElementById('duo-lobby-guest-msg').style.display = '';
  showScreen('screen-duo-lobby');
});

socket.on('duo-lobby-updated', ({ players }) => {
  renderDuoLobby(players);
  if (isHost) {
    const ready = players.length >= 2;
    document.getElementById('btn-start-duo').disabled = !ready;
    document.getElementById('btn-start-duo').textContent = ready ? 'Démarrer la mission' : 'En attente du 2ème joueur…';
  }
});

function renderDuoLobby(players) {
  const el = document.getElementById('duo-lobby-players');
  el.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-chip';
    div.innerHTML = `<span>${p.name}</span><span class="role-badge">Joueur ${i + 1}</span>`;
    el.appendChild(div);
  });
}

document.getElementById('btn-leave-duo-lobby').addEventListener('click', resetAndHome);

document.getElementById('btn-start-duo').addEventListener('click', () => {
  socket.emit('start-duo', { code: myRoom });
});

// ── Duo game ─────────────────────────────────────────────────────────────────
socket.on('duo-started', (state) => {
  myDuoIndex = state.myIndex;
  renderDuoGame(state);
  showScreen('screen-duo-game');
});

socket.on('duo-state-update', (state) => {
  if (state.state === 'finished') {
    renderDuoGame(state);
    setTimeout(() => showDuoEnd(state), 700);
    return;
  }
  renderDuoGame(state);
});

function renderDuoGame(state) {
  myDuoIndex = state.myIndex;
  const isSpy   = state.isSpy;
  const spyName  = state.players[state.currentSpyIndex]?.name || 'Joueur ' + (state.currentSpyIndex + 1);
  const agentIdx = 1 - state.currentSpyIndex;
  const agentName = state.players[agentIdx]?.name || 'Joueur ' + (agentIdx + 1);

  // Header
  document.getElementById('duo-contacts-left').textContent = state.contactsLeft;
  document.getElementById('duo-tokens-left').textContent   = state.timeTokens;

  const roleTag = document.getElementById('duo-role-tag');
  roleTag.textContent = isSpy ? '👁 Espion' : '🕵 Agent';
  roleTag.className = 'duo-role-tag ' + (isSpy ? 'spy' : 'agent');

  document.getElementById('duo-partner-label').textContent = isSpy
    ? `${agentName} devine`
    : `${spyName} donne l'indice`;

  // Jetons visuels
  const tokensRow = document.getElementById('duo-tokens-row');
  tokensRow.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const t = document.createElement('div');
    t.className = 'token' + (i < state.timeTokens ? '' : ' used');
    tokensRow.appendChild(t);
  }

  // Indice
  if (state.currentHint) {
    renderHintBanner('duo', null, state.currentHint.word, state.currentHint.count, state.guessesLeft);
  } else {
    const b = document.getElementById('duo-hint-banner');
    b.className = 'hint-banner waiting';
    b.textContent = isSpy ? 'Donne ton indice ci-dessous…' : 'En attente de l\'indice de ton partenaire…';
  }

  // Grille
  renderDuoGrid(state.grid, isSpy, !!state.currentHint && !isSpy);

  // Zones
  const hintGiven = !!state.currentHint;
  document.getElementById('duo-spy-zone').style.display   = (isSpy && !hintGiven) ? '' : 'none';
  document.getElementById('duo-agent-zone').style.display = (!isSpy && hintGiven) ? '' : 'none';
}

function renderDuoGrid(grid, isSpy, isMyTurn) {
  const el = document.getElementById('duo-grid');
  el.innerHTML = '';

  grid.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'grid-card';
    div.textContent = card.word;

    if (card.revealed) {
      div.classList.add('revealed', `duo-color-${card.color}`);
    } else if (isSpy && card.keyColor) {
      div.classList.add(`duo-spy-${card.keyColor}`);
    } else {
      div.classList.add('hidden', isMyTurn ? 'my-turn' : 'not-my-turn');
      if (isMyTurn) {
        div.addEventListener('click', () => socket.emit('duo-guess-word', { code: myRoom, index: i }));
      }
    }
    el.appendChild(div);
  });
}

document.getElementById('btn-duo-give-hint').addEventListener('click', () => {
  const word  = document.getElementById('duo-hint-word').value.trim();
  const count = parseInt(document.getElementById('duo-hint-count').value, 10);
  if (!word) return toast('Écris un indice.', 'error');
  if (word.includes(' ')) return toast('Un seul mot.', 'error');
  socket.emit('duo-give-hint', { code: myRoom, word, count });
  document.getElementById('duo-hint-word').value = '';
  document.getElementById('duo-spy-zone').style.display = 'none';
});

document.getElementById('btn-duo-end-turn').addEventListener('click', () => {
  socket.emit('duo-end-turn', { code: myRoom });
});

function showDuoEnd(state) {
  const won = state.winner === 'players';
  document.getElementById('duo-end-emoji').textContent = won ? '🏆' : '💀';
  document.getElementById('duo-end-label').textContent = won ? 'Mission accomplie !' : 'Mission échouée';
  document.getElementById('duo-end-title').textContent = won
    ? 'Vous avez trouvé tous les contacts !'
    : (state.winCause === 'assassin' ? 'Vous avez touché un assassin.' : 'Le temps est écoulé.');
  document.getElementById('duo-end-cause').textContent = won
    ? ''
    : `Il restait ${state.contactsLeft} contact${state.contactsLeft > 1 ? 's' : ''} à trouver.`;
  showScreen('screen-duo-end');
}

document.getElementById('btn-duo-rematch').addEventListener('click', () => {
  if (isHost) socket.emit('duo-rematch', { code: myRoom });
  else toast('Seul le Joueur 1 peut relancer.', 'info');
});
document.getElementById('btn-duo-home').addEventListener('click', resetAndHome);

/* ══════════════════════════════════════════════════════════════════════════════
   COMMUN
══════════════════════════════════════════════════════════════════════════════ */

function renderHintBanner(mode, team, word, count, guessesLeft) {
  const id  = mode === 'duo' ? 'duo-hint-banner' : 'hint-banner';
  const cls = mode === 'duo' ? 'duo-hint' : (team === 'red' ? 'red-hint' : 'blue-hint');
  const banner = document.getElementById(id);
  const countLabel    = count === 0 ? '∞' : count;
  const guessesLabel  = guessesLeft === 99 ? '∞' : guessesLeft;
  banner.className = `hint-banner ${cls}`;
  banner.innerHTML = `
    <span class="hint-word">${word}</span>
    <span class="hint-count">${countLabel} mot${count > 1 ? 's' : ''} &nbsp;·&nbsp; <span class="hint-guesses">${guessesLabel} restant${guessesLeft > 1 ? 's' : ''}</span></span>
  `;
}

socket.on('player-disconnected', ({ name, players, host }) => {
  isHost = socket.id === host;
  toast(`${name} a quitté la partie.`, 'info');
  const active = document.querySelector('.screen.active');
  if (active?.id === 'screen-lobby')     { updateClassicLobby(players, isHost); showLobbyButtons(isHost); }
  if (active?.id === 'screen-duo-lobby') { renderDuoLobby(players); }
});

function resetAndHome() {
  socket.disconnect(); socket.connect();
  myRoom = ''; myName = ''; isHost = false; myTeam = null; myRole = 'agent';
  gameMode = 'classic'; myDuoIndex = -1;
  showScreen('screen-home');
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
