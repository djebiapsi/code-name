const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

// ─── Mots ─────────────────────────────────────────────────────────────────────
const { WORDS } = require('./public/js/words.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXY23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateGrid() {
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

function roomSnapshot(room, socketId) {
  return {
    code: room.code,
    host: room.host,
    players: room.players,
    state: room.state,
    currentTeam: room.currentTeam,
    currentHint: room.currentHint,
    guessesLeft: room.guessesLeft,
    redLeft: room.redLeft,
    blueLeft: room.blueLeft,
    winner: room.winner,
    winCause: room.winCause,
    grid: room.state === 'playing'
      ? (isSpymaster(room, socketId) ? room.grid : gridForAgent(room.grid))
      : null,
  };
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('create-room', ({ playerName }) => {
    let code;
    do { code = randomCode(); } while (rooms.has(code));

    const room = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name: playerName, team: null, role: 'agent' }],
      state: 'lobby',
      grid: [],
      currentTeam: 'red',
      currentHint: null,
      guessesLeft: 0,
      redLeft: 9,
      blueLeft: 8,
      winner: null,
      winCause: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room-created', { code, player: room.players[0] });
  });

  socket.on('join-room', ({ code, playerName }) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) return socket.emit('room-error', { message: 'Partie introuvable. Vérifie le code.' });
    if (room.state !== 'lobby') return socket.emit('room-error', { message: 'Partie déjà commencée.' });
    if (room.players.length >= 12) return socket.emit('room-error', { message: 'Partie pleine (12 joueurs max).' });

    const player = { id: socket.id, name: playerName, team: null, role: 'agent' };
    room.players.push(player);
    socket.join(code.toUpperCase());
    socket.emit('room-joined', { code: code.toUpperCase(), player });
    io.to(code.toUpperCase()).emit('room-updated', { players: room.players });
  });

  socket.on('set-team-role', ({ code, team, role }) => {
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;

    // Un seul maître-espion par équipe
    if (role === 'spymaster') {
      const existing = room.players.find(p => p.team === team && p.role === 'spymaster' && p.id !== socket.id);
      if (existing) return socket.emit('room-error', { message: `L'équipe ${team === 'red' ? 'rouge' : 'bleue'} a déjà un maître-espion.` });
    }

    p.team = team;
    p.role = role;
    io.to(code).emit('room-updated', { players: room.players });
  });

  socket.on('start-game', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;

    const redPlayers = room.players.filter(p => p.team === 'red');
    const bluePlayers = room.players.filter(p => p.team === 'blue');
    const redSpy = redPlayers.find(p => p.role === 'spymaster');
    const blueSpy = bluePlayers.find(p => p.role === 'spymaster');

    if (!redSpy) return socket.emit('room-error', { message: "L'équipe rouge n'a pas de maître-espion." });
    if (!blueSpy) return socket.emit('room-error', { message: "L'équipe bleue n'a pas de maître-espion." });
    if (redPlayers.length < 1) return socket.emit('room-error', { message: "L'équipe rouge n'a pas de joueurs." });
    if (bluePlayers.length < 1) return socket.emit('room-error', { message: "L'équipe bleue n'a pas de joueurs." });

    room.grid = generateGrid();
    room.state = 'playing';
    room.currentTeam = 'red';
    room.currentHint = null;
    room.guessesLeft = 0;
    room.redLeft = 9;
    room.blueLeft = 8;
    room.winner = null;
    room.winCause = null;

    // Envoie la grille personnalisée à chaque joueur
    for (const p of room.players) {
      const target = io.sockets.sockets.get(p.id);
      if (target) {
        target.emit('game-started', roomSnapshot(room, p.id));
      }
    }
  });

  socket.on('give-hint', ({ code, word, count }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'playing') return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p || p.role !== 'spymaster' || p.team !== room.currentTeam) return;
    if (room.currentHint) return; // indice déjà donné

    room.currentHint = { word: word.trim().toUpperCase(), count };
    room.guessesLeft = count === 0 ? 99 : count + 1;

    io.to(code).emit('hint-given', {
      word: room.currentHint.word,
      count: room.currentHint.count,
      guessesLeft: room.guessesLeft,
      currentTeam: room.currentTeam,
    });
  });

  socket.on('guess-word', ({ code, index }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'playing' || !room.currentHint) return;
    if (room.guessesLeft <= 0) return;

    const p = room.players.find(p => p.id === socket.id);
    if (!p || p.role !== 'agent' || p.team !== room.currentTeam) return;

    const card = room.grid[index];
    if (!card || card.revealed) return;

    card.revealed = true;
    let endTurn = false;

    if (card.color === 'assassin') {
      room.winner = room.currentTeam === 'red' ? 'blue' : 'red';
      room.winCause = 'assassin';
      room.state = 'finished';
    } else if (card.color === 'red') {
      room.redLeft--;
      if (room.currentTeam === 'red') {
        room.guessesLeft--;
        if (room.redLeft === 0) { room.winner = 'red'; room.winCause = 'found'; room.state = 'finished'; }
        else if (room.guessesLeft <= 0) endTurn = true;
      } else {
        endTurn = true;
      }
    } else if (card.color === 'blue') {
      room.blueLeft--;
      if (room.currentTeam === 'blue') {
        room.guessesLeft--;
        if (room.blueLeft === 0) { room.winner = 'blue'; room.winCause = 'found'; room.state = 'finished'; }
        else if (room.guessesLeft <= 0) endTurn = true;
      } else {
        endTurn = true;
      }
    } else {
      // neutre
      endTurn = true;
    }

    if (room.state === 'finished') {
      broadcastGridAndState(room);
      return;
    }

    if (endTurn) {
      switchTurn(room);
    } else {
      broadcastGridAndState(room);
    }
  });

  socket.on('end-turn', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'playing' || !room.currentHint) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p || p.role !== 'agent' || p.team !== room.currentTeam) return;
    switchTurn(room);
  });

  socket.on('rematch', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    room.grid = generateGrid();
    room.state = 'playing';
    room.currentTeam = 'red';
    room.currentHint = null;
    room.guessesLeft = 0;
    room.redLeft = 9;
    room.blueLeft = 8;
    room.winner = null;
    room.winCause = null;

    for (const p of room.players) {
      const target = io.sockets.sockets.get(p.id);
      if (target) target.emit('game-started', roomSnapshot(room, p.id));
    }
  });

  socket.on('back-to-lobby', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    room.state = 'lobby';
    room.grid = [];
    room.currentHint = null;
    room.winner = null;
    io.to(code).emit('room-updated', { players: room.players, state: 'lobby' });
  });

  socket.on('disconnect', () => {
    for (const [code, room] of rooms) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;

      const name = room.players[idx].name;
      const wasHost = room.host === socket.id;
      room.players.splice(idx, 1);

      if (room.players.length === 0) {
        rooms.delete(code);
      } else {
        if (wasHost) room.host = room.players[0].id;
        io.to(code).emit('player-disconnected', { name, players: room.players, host: room.host });
      }
      break;
    }
  });
});

// ─── Helpers internes ─────────────────────────────────────────────────────────
function switchTurn(room) {
  room.currentTeam = room.currentTeam === 'red' ? 'blue' : 'red';
  room.currentHint = null;
  room.guessesLeft = 0;
  broadcastGridAndState(room);
}

function broadcastGridAndState(room) {
  for (const p of room.players) {
    const target = io.sockets.sockets.get(p.id);
    if (target) target.emit('state-update', roomSnapshot(room, p.id));
  }
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`✅ Code Name → http://localhost:${PORT}`));
