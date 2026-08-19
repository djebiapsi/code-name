const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const { WORDS } = require('./public/js/words.js');

// ─── Helpers communs ──────────────────────────────────────────────────────────
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXY23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Classique : génération grille ───────────────────────────────────────────
function generateClassicGrid() {
  const shuffled = [...WORDS].sort(() => Math.random() - 0.5).slice(0, 25);
  const colors = [
    ...Array(9).fill('red'),
    ...Array(8).fill('blue'),
    ...Array(7).fill('neutral'),
    'assassin',
  ].sort(() => Math.random() - 0.5);
  return shuffled.map((word, i) => ({ word, color: colors[i], revealed: false }));
}

function gridForAgent(grid) {
  return grid.map(c => ({ word: c.word, color: c.revealed ? c.color : null, revealed: c.revealed }));
}

function isSpymaster(room, socketId) {
  const p = room.players.find(p => p.id === socketId);
  return p && p.role === 'spymaster';
}

function classicSnapshot(room, socketId) {
  return {
    mode: 'classic',
    code: room.code, host: room.host,
    players: room.players, state: room.state,
    currentTeam: room.currentTeam,
    currentHint: room.currentHint,
    guessesLeft: room.guessesLeft,
    redLeft: room.redLeft, blueLeft: room.blueLeft,
    winner: room.winner, winCause: room.winCause,
    grid: room.state === 'playing'
      ? (isSpymaster(room, socketId) ? room.grid : gridForAgent(room.grid))
      : null,
  };
}

function broadcastClassic(room) {
  for (const p of room.players) {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('state-update', classicSnapshot(room, p.id));
  }
}

function switchTurnClassic(room) {
  room.currentTeam = room.currentTeam === 'red' ? 'blue' : 'red';
  room.currentHint = null; room.guessesLeft = 0;
  broadcastClassic(room);
}

// ─── Duo : génération grille ──────────────────────────────────────────────────
function generateDuoGrid() {
  const shuffled = [...WORDS].sort(() => Math.random() - 0.5).slice(0, 25);
  const perm = () => Array.from({ length: 25 }, (_, i) => i).sort(() => Math.random() - 0.5);

  const allPos     = perm();
  const contactPos  = new Set(allPos.slice(0, 15));
  const assassinPos = new Set(allPos.slice(15, 18));

  const contactArr  = allPos.slice(0, 15).sort(() => Math.random() - 0.5);
  const p1UniquePos = new Set(contactArr.slice(0, 6));
  const p2UniquePos = new Set(contactArr.slice(6, 12));
  const sharedPos   = new Set(contactArr.slice(12, 15));

  return shuffled.map((word, i) => ({
    word,
    isContact:  contactPos.has(i),
    isAssassin: assassinPos.has(i),
    p1Knows: p1UniquePos.has(i) || sharedPos.has(i),
    p2Knows: p2UniquePos.has(i) || sharedPos.has(i),
    revealed: false,
  }));
}

function duoSnapshot(room, socketId) {
  const pi    = room.players.findIndex(p => p.id === socketId);
  const isSpy = pi === room.currentSpyIndex;

  const grid = room.grid.map(c => {
    if (c.revealed) {
      return {
        word: c.word, revealed: true,
        color: c.isAssassin ? 'assassin' : c.isContact ? 'contact' : 'bystander',
      };
    }
    const myKeyColor = c.isAssassin ? 'assassin'
      : ((pi === 0 ? c.p1Knows : c.p2Knows) ? 'contact' : 'bystander');
    return { word: c.word, revealed: false, keyColor: isSpy ? myKeyColor : null };
  });

  return {
    mode: 'duo',
    code: room.code, host: room.host, state: room.state,
    players: room.players,
    grid, timeTokens: room.timeTokens, contactsLeft: room.contactsLeft,
    currentSpyIndex: room.currentSpyIndex,
    currentHint: room.currentHint, guessesLeft: room.guessesLeft,
    winner: room.winner, winCause: room.winCause,
    isSpy, myIndex: pi,
  };
}

function broadcastDuo(room) {
  for (const p of room.players) {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit('duo-state-update', duoSnapshot(room, p.id));
  }
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── Classique : créer ────────────────────────────────────────────────────────
  socket.on('create-room', ({ playerName }) => {
    let code;
    do { code = randomCode(); } while (rooms.has(code));
    const room = {
      code, host: socket.id, mode: 'classic',
      players: [{ id: socket.id, name: playerName, team: null, role: 'agent' }],
      state: 'lobby', grid: [],
      currentTeam: 'red', currentHint: null, guessesLeft: 0,
      redLeft: 9, blueLeft: 8, winner: null, winCause: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room-created', { code, player: room.players[0] });
  });

  // ── Duo : créer ───────────────────────────────────────────────────────────────
  socket.on('create-duo-room', ({ playerName }) => {
    let code;
    do { code = randomCode(); } while (rooms.has(code));
    const room = {
      code, host: socket.id, mode: 'duo',
      players: [{ id: socket.id, name: playerName }],
      state: 'lobby', grid: [],
      timeTokens: 9, contactsLeft: 15,
      currentSpyIndex: 0, currentHint: null, guessesLeft: 0,
      winner: null, winCause: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('duo-room-created', { code });
  });

  // ── Rejoindre (classique et duo) ──────────────────────────────────────────────
  socket.on('join-room', ({ code, playerName }) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) return socket.emit('room-error', { message: 'Partie introuvable. Vérifie le code.' });
    if (room.state !== 'lobby') return socket.emit('room-error', { message: 'Partie déjà commencée.' });

    if (room.mode === 'duo') {
      if (room.players.length >= 2) return socket.emit('room-error', { message: 'Partie Duo déjà complète (2 joueurs max).' });
      room.players.push({ id: socket.id, name: playerName });
      socket.join(code.toUpperCase());
      socket.emit('duo-room-joined', { code: code.toUpperCase(), myIndex: 1 });
      io.to(code.toUpperCase()).emit('duo-lobby-updated', { players: room.players });
      return;
    }

    // Classique
    if (room.players.length >= 12) return socket.emit('room-error', { message: 'Partie pleine (12 joueurs max).' });
    const player = { id: socket.id, name: playerName, team: null, role: 'agent' };
    room.players.push(player);
    socket.join(code.toUpperCase());
    socket.emit('room-joined', { code: code.toUpperCase(), player });
    io.to(code.toUpperCase()).emit('room-updated', { players: room.players });
  });

  // ── Classique : équipe / rôle ─────────────────────────────────────────────────
  socket.on('set-team-role', ({ code, team, role }) => {
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    if (role === 'spymaster') {
      const existing = room.players.find(p => p.team === team && p.role === 'spymaster' && p.id !== socket.id);
      if (existing) return socket.emit('room-error', { message: `L'équipe ${team === 'red' ? 'rouge' : 'bleue'} a déjà un maître-espion.` });
    }
    p.team = team; p.role = role;
    io.to(code).emit('room-updated', { players: room.players });
  });

  // ── Classique : démarrer ──────────────────────────────────────────────────────
  socket.on('start-game', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.mode !== 'classic') return;
    const redSpy  = room.players.find(p => p.team === 'red'  && p.role === 'spymaster');
    const blueSpy = room.players.find(p => p.team === 'blue' && p.role === 'spymaster');
    const hasRed  = room.players.some(p => p.team === 'red');
    const hasBlue = room.players.some(p => p.team === 'blue');
    if (!redSpy)  return socket.emit('room-error', { message: "L'équipe rouge n'a pas de maître-espion." });
    if (!blueSpy) return socket.emit('room-error', { message: "L'équipe bleue n'a pas de maître-espion." });
    if (!hasRed)  return socket.emit('room-error', { message: "L'équipe rouge est vide." });
    if (!hasBlue) return socket.emit('room-error', { message: "L'équipe bleue est vide." });

    room.grid = generateClassicGrid();
    room.state = 'playing';
    room.currentTeam = 'red'; room.currentHint = null; room.guessesLeft = 0;
    room.redLeft = 9; room.blueLeft = 8; room.winner = null; room.winCause = null;

    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.id);
      if (s) s.emit('game-started', classicSnapshot(room, p.id));
    }
  });

  // ── Classique : donner l'indice ───────────────────────────────────────────────
  socket.on('give-hint', ({ code, word, count }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'playing' || room.mode !== 'classic') return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p || p.role !== 'spymaster' || p.team !== room.currentTeam) return;
    if (room.currentHint) return;
    room.currentHint = { word: word.trim().toUpperCase(), count };
    room.guessesLeft = count === 0 ? 99 : count + 1;
    io.to(code).emit('hint-given', { word: room.currentHint.word, count, guessesLeft: room.guessesLeft, currentTeam: room.currentTeam });
  });

  // ── Classique : deviner ───────────────────────────────────────────────────────
  socket.on('guess-word', ({ code, index }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'playing' || room.mode !== 'classic' || !room.currentHint) return;
    if (room.guessesLeft <= 0) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p || p.team !== room.currentTeam) return;
    const teammates = room.players.filter(q => q.team === room.currentTeam);
    if (p.role === 'spymaster' && teammates.some(q => q.role === 'agent')) return;

    const card = room.grid[index];
    if (!card || card.revealed) return;
    card.revealed = true;
    let endTurn = false;

    if (card.color === 'assassin') {
      room.winner = room.currentTeam === 'red' ? 'blue' : 'red';
      room.winCause = 'assassin'; room.state = 'finished';
    } else if (card.color === 'red') {
      room.redLeft--;
      if (room.currentTeam === 'red') {
        room.guessesLeft--;
        if (room.redLeft === 0) { room.winner = 'red'; room.winCause = 'found'; room.state = 'finished'; }
        else if (room.guessesLeft <= 0) endTurn = true;
      } else { endTurn = true; }
    } else if (card.color === 'blue') {
      room.blueLeft--;
      if (room.currentTeam === 'blue') {
        room.guessesLeft--;
        if (room.blueLeft === 0) { room.winner = 'blue'; room.winCause = 'found'; room.state = 'finished'; }
        else if (room.guessesLeft <= 0) endTurn = true;
      } else { endTurn = true; }
    } else {
      endTurn = true;
    }

    if (room.state === 'finished') { broadcastClassic(room); return; }
    if (endTurn) switchTurnClassic(room);
    else broadcastClassic(room);
  });

  // ── Classique : passer le tour ────────────────────────────────────────────────
  socket.on('end-turn', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'playing' || room.mode !== 'classic' || !room.currentHint) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p || p.role !== 'agent' || p.team !== room.currentTeam) return;
    switchTurnClassic(room);
  });

  // ── Classique : revanche / retour lobby ───────────────────────────────────────
  socket.on('rematch', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.mode !== 'classic') return;
    room.grid = generateClassicGrid();
    room.state = 'playing'; room.currentTeam = 'red'; room.currentHint = null; room.guessesLeft = 0;
    room.redLeft = 9; room.blueLeft = 8; room.winner = null; room.winCause = null;
    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.id);
      if (s) s.emit('game-started', classicSnapshot(room, p.id));
    }
  });

  socket.on('back-to-lobby', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    room.state = 'lobby'; room.grid = []; room.currentHint = null; room.winner = null;
    io.to(code).emit('room-updated', { players: room.players, state: 'lobby' });
  });

  // ── Duo : démarrer ────────────────────────────────────────────────────────────
  socket.on('start-duo', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.mode !== 'duo') return;
    if (room.players.length < 2) return socket.emit('room-error', { message: 'En attente du 2ème joueur.' });

    room.grid = generateDuoGrid();
    room.state = 'playing';
    room.timeTokens = 9; room.contactsLeft = 15;
    room.currentSpyIndex = 0; room.currentHint = null; room.guessesLeft = 0;
    room.winner = null; room.winCause = null;

    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.id);
      if (s) s.emit('duo-started', duoSnapshot(room, p.id));
    }
  });

  // ── Duo : donner l'indice ─────────────────────────────────────────────────────
  socket.on('duo-give-hint', ({ code, word, count }) => {
    const room = rooms.get(code);
    if (!room || room.mode !== 'duo' || room.state !== 'playing') return;
    const pi = room.players.findIndex(p => p.id === socket.id);
    if (pi !== room.currentSpyIndex || room.currentHint) return;

    if (room.timeTokens <= 0) {
      room.winner = 'game'; room.winCause = 'time_out'; room.state = 'finished';
      broadcastDuo(room); return;
    }
    room.timeTokens--;
    room.currentHint = { word: word.trim().toUpperCase(), count };
    room.guessesLeft = count === 0 ? 99 : count + 1;
    broadcastDuo(room);
  });

  // ── Duo : deviner ─────────────────────────────────────────────────────────────
  socket.on('duo-guess-word', ({ code, index }) => {
    const room = rooms.get(code);
    if (!room || room.mode !== 'duo' || room.state !== 'playing' || !room.currentHint) return;
    if (room.guessesLeft <= 0) return;
    const pi = room.players.findIndex(p => p.id === socket.id);
    if (pi === room.currentSpyIndex) return; // l'espion ne devine pas

    const card = room.grid[index];
    if (!card || card.revealed) return;
    card.revealed = true;

    if (card.isAssassin) {
      room.winner = 'game'; room.winCause = 'assassin'; room.state = 'finished';
      broadcastDuo(room); return;
    }

    if (card.isContact) {
      room.contactsLeft--;
      if (room.contactsLeft <= 0) {
        room.winner = 'players'; room.winCause = 'found_all'; room.state = 'finished';
        broadcastDuo(room); return;
      }
      room.guessesLeft--;
      if (room.guessesLeft <= 0) {
        room.currentSpyIndex = 1 - room.currentSpyIndex;
        room.currentHint = null; room.guessesLeft = 0;
      }
    } else {
      // Passant → fin du tour
      room.currentSpyIndex = 1 - room.currentSpyIndex;
      room.currentHint = null; room.guessesLeft = 0;
    }

    broadcastDuo(room);
  });

  // ── Duo : passer ──────────────────────────────────────────────────────────────
  socket.on('duo-end-turn', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.mode !== 'duo' || room.state !== 'playing' || !room.currentHint) return;
    const pi = room.players.findIndex(p => p.id === socket.id);
    if (pi === room.currentSpyIndex) return;
    room.currentSpyIndex = 1 - room.currentSpyIndex;
    room.currentHint = null; room.guessesLeft = 0;
    broadcastDuo(room);
  });

  // ── Duo : rejouer ─────────────────────────────────────────────────────────────
  socket.on('duo-rematch', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.mode !== 'duo') return;
    room.grid = generateDuoGrid();
    room.state = 'playing';
    room.timeTokens = 9; room.contactsLeft = 15;
    room.currentSpyIndex = 0; room.currentHint = null; room.guessesLeft = 0;
    room.winner = null; room.winCause = null;
    for (const p of room.players) {
      const s = io.sockets.sockets.get(p.id);
      if (s) s.emit('duo-started', duoSnapshot(room, p.id));
    }
  });

  // ── Déconnexion ───────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    for (const [code, room] of rooms) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;
      const name = room.players[idx].name;
      const wasHost = room.host === socket.id;
      room.players.splice(idx, 1);
      if (room.players.length === 0) { rooms.delete(code); }
      else {
        if (wasHost) room.host = room.players[0].id;
        io.to(code).emit('player-disconnected', { name, players: room.players, host: room.host });
      }
      break;
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`✅ Code Name → http://localhost:${PORT}`));
