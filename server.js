import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createFullSpectrumScenario } from './src/scenarios/FullSpectrumWar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// ─── Simulation State ───────────────────────────────────────────────────
let sim = null;
let terrainCache = null;

function initSimulation(config = {}) {
  if (sim) sim.engine.stop();
  sim = createFullSpectrumScenario({
    tickRate: config.tickRate || 500,
    timeScale: config.timeScale || 1,
    useLLM: config.useLLM || false,
    ...config
  });
  terrainCache = sim.engine.getFullTerrainData();
  setupEventForwarding();
  return sim;
}

function setupEventForwarding() {
  const events = [
    'sim:tick', 'sim:start', 'sim:paused', 'sim:resumed', 'sim:stopped',
    'entity:added', 'entity:destroyed', 'entity:radiation_kill',
    'combat:hit', 'combat:kill', 'combat:aoe', 'combat:air_strike', 'combat:naval_strike',
    'nuclear:launch', 'nuclear:impact', 'nuclear:intercepted', 'nuclear:tracking',
    'nuclear:defcon_change', 'nuclear:warning', 'nuclear:launch_denied',
    'naval:sub_detected',
    'air:early_warning', 'air:fuel_depleted',
    'commander:decision',
    'faction:added', 'module:registered', 'commander:registered'
  ];

  for (const event of events) {
    sim.engine.events.on(event, (data) => {
      broadcast({ type: event, data, tick: sim.engine.clock.tick });
    });
  }
}

function broadcast(message) {
  const json = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(json);
    }
  }
}

// ─── REST API ───────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  if (!sim) return res.json({ error: 'No simulation running' });
  res.json(sim.engine.getState());
});

app.get('/api/terrain', (req, res) => {
  if (!terrainCache) return res.json({ error: 'No simulation running' });
  res.json(terrainCache);
});

app.get('/api/events', (req, res) => {
  if (!sim) return res.json([]);
  const filter = req.query.filter || null;
  const limit = parseInt(req.query.limit) || 100;
  res.json(sim.engine.events.getHistory(filter, limit));
});

app.get('/api/factions', (req, res) => {
  if (!sim) return res.json({});
  res.json(Object.fromEntries(sim.engine.factions));
});

app.get('/api/nuclear', (req, res) => {
  if (!sim) return res.json({});
  res.json({
    defcon: sim.nuclear.getDefconLevels(),
    inFlight: sim.nuclear.getInFlightMissiles(),
    history: sim.nuclear.launchHistory.length
  });
});

// ─── WebSocket Handler ──────────────────────────────────────────────────

wss.on('connection', (ws) => {
  console.log('[Server] Client connected');

  // Send initial state
  if (sim) {
    ws.send(JSON.stringify({ type: 'init', data: { state: sim.engine.getState(), hasTerrain: true } }));
  } else {
    ws.send(JSON.stringify({ type: 'init', data: { state: null, hasTerrain: false } }));
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.action) {
      case 'start':
        if (!sim) initSimulation(msg.config || {});
        sim.engine.start();
        ws.send(JSON.stringify({ type: 'sim:started' }));
        break;

      case 'pause':
        if (sim) sim.engine.pause();
        break;

      case 'resume':
        if (sim) sim.engine.resume();
        break;

      case 'stop':
        if (sim) sim.engine.stop();
        break;

      case 'reset':
        if (sim) sim.engine.stop();
        initSimulation(msg.config || {});
        ws.send(JSON.stringify({ type: 'sim:reset', data: sim.engine.getState() }));
        break;

      case 'setTimeScale':
        if (sim) sim.engine.clock.setTimeScale(msg.scale || 1);
        break;

      case 'getTerrain':
        if (terrainCache) ws.send(JSON.stringify({ type: 'terrain', data: terrainCache }));
        break;

      case 'order':
        if (sim && msg.event && msg.data) {
          sim.engine.events.emit(msg.event, msg.data);
        }
        break;

      case 'getCommanderState':
        if (sim) {
          const commanders = {};
          for (const [faction, cmd] of sim.engine.commanders) {
            commanders[faction] = {
              personality: cmd.personality,
              lastDecision: cmd.lastDecision,
              historyLength: cmd.decisionHistory.length
            };
          }
          ws.send(JSON.stringify({ type: 'commanders', data: commanders }));
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log('[Server] Client disconnected');
  });
});

// ─── Start Server ───────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║   MILITARY SIMULATION FRAMEWORK v1.0                    ║`);
  console.log(`║   Server running at http://localhost:${PORT}               ║`);
  console.log(`║   Open your browser to access the command interface     ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  // Auto-init simulation
  initSimulation();
  console.log('[Server] Simulation initialized and ready.');
  console.log(`[Server] Map: ${sim.engine.config.mapWidth}x${sim.engine.config.mapHeight}`);
  console.log(`[Server] Entities: ${sim.engine.entities.size}`);
  console.log(`[Server] Factions: ${[...sim.engine.factions.keys()].join(', ')}`);
});
