/* ── État local ─────────────────────────────────────────────────────────────── */
let myName = '';
let myRoom = '';
let myTeam = null;
let myRole = 'agent';
let isHost = false;
let gameState = null; // snapshot serveur

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

/* ── Home ───────────────────────────────────────────────────────────────────── */
document.getElementById('btn-create').addEventListener('click', () => showScreen('screen-create'));
document.getElementById('btn-join-nav').addEventListener('click', () => showScreen('screen-join'));
document.getElementById('btn-rules-nav').addEventListener('click', () => showScreen('screen-rules'));

/* ── Create ─────────────────────────────────────────────────────────────────── */
document.getElementById('btn-create-room').addEventListener('click', () => {
  const name = document.getElementById('create-name').value.trim();
  if (!name) return toast('Entre ton prénom.', 'error');
  myName = name;
  socket.emit('create-room', { playerName: name });
});

/* ── Join ───────────────────────────────────────────────────────────────────── */
document.getElementById('btn-join-room').addEventListener('click', () => {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return toast('Entre ton prénom.', 'error');
  if (code.length !== 6) return toast('Le code fait 6 caractères.', 'error');
  myName = name;
  socket.emit('join-room', { code, playerName: name });
});

/* ── Room events ────────────────────────────────────────────────────────────── */
socket.on('room-created', ({ code, player }) => {
  myRoom = code;
  isHost = true;
  myTeam = null;
  myRole = 'agent';
  document.getElementById('lobby-code').textContent = code;
  updateLobby([player], true);
  showLobbyButtons(true);
  showScreen('screen-lobby');
});

socket.on('room-joined', ({ code, player }) => {
  myRoom = code;
  isHost = false;
  myTeam = null;
  myRole = 'agent';
  document.getElementById('lobby-code').textContent = code;
  updateLobby([player], false);
  showLobbyButtons(false);
  showScreen('screen-lobby');
});

socket.on('room-updated', ({ players, state }) => {
  if (state === 'lobby') {
    // retour au lobby après partie
    const me = players.find(p => p.id === socket.id);
    if (me) { myTeam = me.team; myRole = me.role; }
    updateLobby(players, isHost);
    showLobbyButtons(isHost);
    showScreen('screen-lobby');
    return;
  }
  const me = players.find(p => p.id === socket.id);
  if (me) { myTeam = me.team; myRole = me.role; }
  updateLobby(players, isHost);
  refreshStartButton(players);
});

socket.on('room-error', ({ message }) => toast(message, 'error'));

/* ── Leave lobby ────────────────────────────────────────────────────────────── */
document.getElementById('btn-leave-lobby').addEventListener('click', () => {
  socket.disconnect();
  socket.connect();
  myRoom = ''; myName = ''; isHost = false; myTeam = null; myRole = 'agent';
  showScreen('screen-home');
});

/* ── Lobby UI ───────────────────────────────────────────────────────────────── */
function showLobbyButtons(host) {
  document.getElementById('btn-start').style.display = host ? '' : 'none';
  document.getElementById('lobby-guest-msg').style.display = host ? 'none' : '';
}

function updateLobby(players, host) {
  const redEl   = document.getElementById('lobby-red-players');
  const blueEl  = document.getElementById('lobby-blue-players');
  const unEl    = document.getElementById('lobby-unassigned');
  redEl.innerHTML = ''; blueEl.innerHTML = ''; unEl.innerHTML = '';

  players.forEach(p => {
    const isMe = p.id === socket.id;
    const chip = document.createElement('div');
    chip.className = 'player-chip' + (isMe ? ' me' : '');
    const roleLabel = p.role === 'spymaster' ? 'Maître-espion' : 'Agent';
    chip.innerHTML = `<span>${p.name}</span><span class="role-badge">${p.role === 'spymaster' ? '👁' : '🕵'} ${roleLabel}</span>`;
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

/* ── Role picker ────────────────────────────────────────────────────────────── */
document.querySelectorAll('#team-picker .role-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const team = btn.dataset.team;
    const role = btn.dataset.role;
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

/* ── Start ──────────────────────────────────────────────────────────────────── */
document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('start-game', { code: myRoom });
});

/* ── Game started ───────────────────────────────────────────────────────────── */
socket.on('game-started', (state) => {
  gameState = state;
  const me = state.players.find(p => p.id === socket.id);
  if (me) { myTeam = me.team; myRole = me.role; }
  renderGame(state);
  showScreen('screen-game');
});

socket.on('state-update', (state) => {
  gameState = state;
  if (state.state === 'finished') {
    renderGame(state);
    setTimeout(() => showEndScreen(state), 800);
    return;
  }
  renderGame(state);
});

socket.on('hint-given', (data) => {
  if (gameState) { gameState.currentHint = { word: data.word, count: data.count }; gameState.guessesLeft = data.guessesLeft; gameState.currentTeam = data.currentTeam; }
  renderHintBanner(data.currentTeam, data.word, data.count, data.guessesLeft);
  renderAgentZone(data.currentTeam);
});

/* ── Render game ────────────────────────────────────────────────────────────── */
function renderGame(state) {
  // Scores
  document.getElementById('score-red-num').textContent  = state.redLeft;
  document.getElementById('score-blue-num').textContent = state.blueLeft;

  const scoreRed  = document.getElementById('score-red');
  const scoreBlue = document.getElementById('score-blue');
  scoreRed.className  = 'team-score red'  + (state.currentTeam === 'red'  ? ' active-red'  : '');
  scoreBlue.className = 'team-score blue' + (state.currentTeam === 'blue' ? ' active-blue' : '');

  // Tour
  const turnEl = document.getElementById('turn-indicator');
  const teamLabel = state.currentTeam === 'red' ? 'ROUGE' : 'BLEU';
  turnEl.textContent = `${teamLabel} joue`;
  turnEl.className = `turn-indicator ${state.currentTeam}`;

  // Mon rôle
  document.getElementById('my-role-tag').textContent = myRole === 'spymaster' ? '👁 Maître-espion' : '🕵 Agent';

  // Indice
  if (state.currentHint) {
    renderHintBanner(state.currentTeam, state.currentHint.word, state.currentHint.count, state.guessesLeft);
  } else {
    const banner = document.getElementById('hint-banner');
    banner.className = 'hint-banner waiting';
    banner.textContent = 'En attente de l\'indice…';
  }

  // Grille
  renderGrid(state.grid, state.currentTeam, state.currentHint);

  // Zones
  const isMySpy   = myRole === 'spymaster' && myTeam === state.currentTeam;
  const isMyAgent = myRole === 'agent'      && myTeam === state.currentTeam;
  const hintGiven = !!state.currentHint;

  document.getElementById('spymaster-zone').style.display = (isMySpy && !hintGiven) ? '' : 'none';
  document.getElementById('agent-zone').style.display     = (isMyAgent && hintGiven) ? '' : 'none';
}

function renderGrid(grid, currentTeam, hint) {
  const el = document.getElementById('grid');
  el.innerHTML = '';
  const isMySpy   = myRole === 'spymaster';
  const isMyTurn  = myTeam === currentTeam && myRole === 'agent' && !!hint;

  grid.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'grid-card';
    div.textContent = card.word;

    if (card.revealed) {
      div.classList.add('revealed', `color-${card.color}`);
    } else if (isMySpy) {
      div.classList.add(`spy-${card.color}`);
    } else {
      div.classList.add('hidden');
      div.classList.add(isMyTurn ? 'my-turn' : 'not-my-turn');
      if (isMyTurn) {
        div.addEventListener('click', () => socket.emit('guess-word', { code: myRoom, index: i }));
      }
    }
    el.appendChild(div);
  });
}

function renderHintBanner(team, word, count, guessesLeft) {
  const banner = document.getElementById('hint-banner');
  const countLabel = count === 0 ? '∞' : count;
  banner.className = `hint-banner ${team}-hint`;
  banner.innerHTML = `
    <span class="hint-word">${word}</span>
    <span class="hint-count">${countLabel} mot${count > 1 ? 's' : ''} &nbsp;·&nbsp; <span class="hint-guesses">${guessesLeft === 99 ? '∞' : guessesLeft} restant${guessesLeft > 1 ? 's' : ''}</span></span>
  `;
}

function renderAgentZone(currentTeam) {
  const isMyAgent = myRole === 'agent' && myTeam === currentTeam;
  document.getElementById('agent-zone').style.display = isMyAgent ? '' : 'none';
}

/* ── Hint input ──────────────────────────────────────────────────────────────── */
document.getElementById('btn-give-hint').addEventListener('click', () => {
  const word = document.getElementById('hint-word-input').value.trim();
  const count = parseInt(document.getElementById('hint-count-input').value, 10);
  if (!word) return toast('Écris un indice.', 'error');
  if (word.split(' ').length > 1) return toast('L\'indice doit être un seul mot.', 'error');

  socket.emit('give-hint', { code: myRoom, word, count });
  document.getElementById('hint-word-input').value = '';
  document.getElementById('spymaster-zone').style.display = 'none';
});

/* ── End turn ────────────────────────────────────────────────────────────────── */
document.getElementById('btn-end-turn').addEventListener('click', () => {
  socket.emit('end-turn', { code: myRoom });
});

/* ── End screen ─────────────────────────────────────────────────────────────── */
function showEndScreen(state) {
  const team = state.winner;
  const teamLabel = team === 'red' ? 'Rouge' : 'Bleu';
  document.getElementById('end-emoji').textContent    = team === 'red' ? '🔴' : '🔵';
  document.getElementById('end-team-name').textContent = `Équipe ${teamLabel}`;
  document.getElementById('end-team-name').className  = `winner-name ${team}`;
  document.getElementById('end-cause').textContent    = state.winCause === 'assassin'
    ? `L'équipe adverse a touché l'assassin 💀`
    : `Tous les mots de l'équipe ont été trouvés !`;
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

document.getElementById('btn-home-end').addEventListener('click', () => {
  socket.disconnect(); socket.connect();
  myRoom = ''; myName = ''; isHost = false; myTeam = null; myRole = 'agent'; gameState = null;
  showScreen('screen-home');
});

/* ── Disconnect ─────────────────────────────────────────────────────────────── */
socket.on('player-disconnected', ({ name, players, host }) => {
  isHost = socket.id === host;
  toast(`${name} a quitté la partie.`, 'info');
  const screen = document.querySelector('.screen.active');
  if (screen && screen.id === 'screen-lobby') {
    updateLobby(players, isHost);
    showLobbyButtons(isHost);
  }
});

/* ── Toast ──────────────────────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
