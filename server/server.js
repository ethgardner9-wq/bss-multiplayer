const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const BROADCAST_RATE = 50; // ms between broadcasts (20 Hz)

const wss = new WebSocketServer({ port: PORT });

const players = new Map();
let nextId = 1;

const COLORS = [
  [1, 0.3, 0.3],   // red
  [0.3, 0.6, 1],   // blue
  [0.3, 1, 0.4],   // green
  [1, 0.8, 0.2],   // yellow
  [1, 0.5, 0],     // orange
  [0.8, 0.3, 1],   // purple
  [0, 1, 1],       // cyan
  [1, 0.4, 0.7],   // pink
  [0.6, 0.4, 0.2], // brown
  [0.9, 0.9, 0.9], // white
];

console.log(`BSS Multiplayer Server starting on port ${PORT}...`);

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'error', message: 'Server is full' }));
    ws.close();
    return;
  }

  const id = nextId++;
  const color = COLORS[id % COLORS.length];

  const playerData = {
    id,
    ws,
    name: 'Player ' + id,
    color,
    x: 8, y: 2, z: 7,
    yaw: 0,
    gear: 'shovel',
    mask: 'none',
    lastUpdate: Date.now(),
  };

  players.set(id, playerData);

  // Send welcome message with player ID and existing players
  const existingPlayers = [];
  for (const [pid, p] of players) {
    if (pid !== id) {
      existingPlayers.push({
        id: pid,
        name: p.name,
        color: p.color,
        x: p.x, y: p.y, z: p.z,
        yaw: p.yaw,
        gear: p.gear,
        mask: p.mask,
      });
    }
  }

  ws.send(JSON.stringify({
    type: 'welcome',
    id,
    color,
    players: existingPlayers,
  }));

  // Notify others of new player
  broadcast({
    type: 'join',
    id,
    name: playerData.name,
    color,
    x: playerData.x,
    y: playerData.y,
    z: playerData.z,
    yaw: 0,
  }, id);

  console.log(`Player ${id} (${playerData.name}) connected. Total: ${players.size}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'update':
          // Update player position/state
          playerData.x = msg.x;
          playerData.y = msg.y;
          playerData.z = msg.z;
          playerData.yaw = msg.yaw;
          playerData.gear = msg.gear || playerData.gear;
          playerData.mask = msg.mask || playerData.mask;
          playerData.lastUpdate = Date.now();
          break;

        case 'setname':
          playerData.name = (msg.name || 'Player ' + id).substring(0, 20);
          broadcast({
            type: 'name',
            id,
            name: playerData.name,
          }, null);
          console.log(`Player ${id} set name to: ${playerData.name}`);
          break;

        case 'chat':
          broadcast({
            type: 'chat',
            id,
            name: playerData.name,
            text: (msg.text || '').substring(0, 200),
          }, null);
          break;
      }
    } catch (e) {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id }, null);
    console.log(`Player ${id} disconnected. Total: ${players.size}`);
  });

  ws.on('error', () => {
    players.delete(id);
    broadcast({ type: 'leave', id }, null);
  });
});

function broadcast(msg, excludeId) {
  const data = JSON.stringify(msg);
  for (const [pid, p] of players) {
    if (pid !== excludeId && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  }
}

// Periodic state broadcast - send all player positions to everyone
setInterval(() => {
  if (players.size < 2) return;

  const allPlayers = [];
  const now = Date.now();

  for (const [pid, p] of players) {
    // Disconnect stale players (no update for 30 seconds)
    if (now - p.lastUpdate > 30000) {
      p.ws.close();
      players.delete(pid);
      broadcast({ type: 'leave', id: pid }, null);
      continue;
    }

    allPlayers.push({
      id: pid,
      name: p.name,
      color: p.color,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      gear: p.gear,
      mask: p.mask,
    });
  }

  const data = JSON.stringify({ type: 'state', players: allPlayers });

  for (const [pid, p] of players) {
    if (p.ws.readyState === 1) {
      p.ws.send(data);
    }
  }
}, BROADCAST_RATE);

console.log(`BSS Multiplayer Server running on ws://localhost:${PORT}`);
console.log(`Max players: ${MAX_PLAYERS}`);
