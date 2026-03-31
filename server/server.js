const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const BROADCAST_RATE = 50; // ms (20 Hz)

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('BSS Multiplayer Server OK');
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
});

const players = new Map();
let nextId = 1;

const COLORS = [
  [1,0.3,0.3],[0.3,0.6,1],[0.3,1,0.4],[1,0.8,0.2],[1,0.5,0],
  [0.8,0.3,1],[0,1,1],[1,0.4,0.7],[0.6,0.4,0.2],[0.9,0.9,0.9],
];

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'error', message: 'Server is full' }));
    ws.close();
    return;
  }

  const id = nextId++;
  const color = COLORS[id % COLORS.length];
  const hiveSlot = id % MAX_PLAYERS; // Assign hive slot

  const pd = {
    id, ws, name: 'Player ' + id, color, hiveSlot,
    x: 8, y: 2, z: 7, yaw: 0,
    currentGear: { tool:'shovel',boots:'none',belt:'none',backpack:'pouch',mask:'none',leftGuard:'none',rightGuard:'none' },
    toolSwinging: false,
    hive: [], // [{type,gifted}...]
    bees: [],  // [{type,gifted,rx,ry,rz}...] relative positions
    lastUpdate: Date.now(),
  };

  players.set(id, pd);

  // Send welcome with existing players
  const existing = [];
  for (const [pid, p] of players) {
    if (pid !== id) existing.push(serializePlayer(p));
  }
  ws.send(JSON.stringify({ type: 'welcome', id, color, players: existing }));

  // Notify others
  broadcast({ type: 'join', ...serializePlayer(pd) }, id);
  console.log(`Player ${id} joined. Total: ${players.size}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'update':
          pd.x = msg.x; pd.y = msg.y; pd.z = msg.z;
          pd.yaw = msg.yaw;
          pd.toolSwinging = msg.toolSwinging || false;
          if (msg.currentGear) pd.currentGear = msg.currentGear;
          pd.lastUpdate = Date.now();
          break;
        case 'hivedata':
          if (msg.hive) pd.hive = msg.hive.slice(0, 200); // Cap size
          if (msg.bees) pd.bees = msg.bees.slice(0, 60);
          break;
        case 'setname':
          pd.name = (msg.name || 'Player ' + id).substring(0, 20);
          broadcast({ type: 'name', id, name: pd.name }, null);
          break;
        case 'chat':
          broadcast({ type: 'chat', id, name: pd.name, text: (msg.text || '').substring(0, 200) }, null);
          break;
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id }, null);
    console.log(`Player ${id} left. Total: ${players.size}`);
  });
  ws.on('error', () => {
    players.delete(id);
    broadcast({ type: 'leave', id }, null);
  });
});

function serializePlayer(p) {
  return {
    id: p.id, name: p.name, color: p.color, hiveSlot: p.hiveSlot,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw,
    currentGear: p.currentGear, toolSwinging: p.toolSwinging,
    hive: p.hive, bees: p.bees,
  };
}

function broadcast(msg, excludeId) {
  const data = JSON.stringify(msg);
  for (const [pid, p] of players) {
    if (pid !== excludeId && p.ws.readyState === 1) p.ws.send(data);
  }
}

// Periodic full state broadcast
setInterval(() => {
  if (players.size < 2) return;
  const all = [];
  const now = Date.now();
  for (const [pid, p] of players) {
    if (now - p.lastUpdate > 30000) {
      p.ws.close(); players.delete(pid);
      broadcast({ type: 'leave', id: pid }, null);
      continue;
    }
    all.push(serializePlayer(p));
  }
  const data = JSON.stringify({ type: 'state', players: all });
  for (const [, p] of players) {
    if (p.ws.readyState === 1) p.ws.send(data);
  }
}, BROADCAST_RATE);

console.log(`Max players: ${MAX_PLAYERS}`);
