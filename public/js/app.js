/**
 * Military Simulation - Client Application
 * Handles WebSocket communication, canvas rendering, map layers, and UI controls.
 */

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

const state = {
  ws: null,
  connected: false,
  terrain: null,
  entities: new Map(),
  factions: {},
  clock: { tick: 0, elapsed: 0, running: false, paused: false },
  stats: { totalEntities: 0, totalDestroyed: 0, combatEngagements: 0, nuclearStrikes: 0 },
  selectedUnit: null,
  layers: {
    terrain: true, elevation: true, water: true, grid: false,
    units: true, features: true, detection: false, ranges: false,
    radiation: true, missiles: true, effects: true, labels: true
  },
  camera: { x: 0, y: 0, zoom: 4 },
  mapPixelWidth: 0,
  mapPixelHeight: 0,
  effects: [],       // visual effects (explosions, trails)
  missiles: [],      // in-flight nuclear missiles
  eventLog: [],
  logFilter: 'all',
  defcon: { red: 5, blue: 5 },
  terrainImageData: null,
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  cameraStart: { x: 0, y: 0 },
  mouseWorld: { x: 0, y: 0 }
};

// ═══════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const canvas = $('#map-canvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = $('#minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');

// ═══════════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════════

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}`);

  state.ws.onopen = () => {
    state.connected = true;
    console.log('[WS] Connected');
    state.ws.send(JSON.stringify({ action: 'getTerrain' }));
  };

  state.ws.onclose = () => {
    state.connected = false;
    console.log('[WS] Disconnected, reconnecting...');
    setTimeout(connectWebSocket, 2000);
  };

  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };
}

function send(action, data = {}) {
  if (state.ws?.readyState === 1) {
    state.ws.send(JSON.stringify({ action, ...data }));
  }
}

// ═══════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════

function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      if (msg.data.state) {
        applyState(msg.data.state);
      }
      break;

    case 'terrain':
      state.terrain = msg.data;
      buildTerrainImage();
      renderMinimap();
      break;

    case 'sim:tick':
      state.clock.tick = msg.data.tick;
      state.clock.elapsed = msg.data.elapsed;
      state.stats = msg.data.stats;
      updateTickDisplay();
      updateStats();
      break;

    case 'sim:started':
    case 'sim:start':
      state.clock.running = true;
      state.clock.paused = false;
      updateSimStatus('running');
      break;

    case 'sim:paused':
      state.clock.paused = true;
      updateSimStatus('paused');
      break;

    case 'sim:resumed':
      state.clock.paused = false;
      updateSimStatus('running');
      break;

    case 'sim:stopped':
      state.clock.running = false;
      updateSimStatus('stopped');
      if (msg.data) applyState(msg.data);
      break;

    case 'sim:reset':
      applyState(msg.data);
      state.effects = [];
      state.missiles = [];
      state.eventLog = [];
      $('#event-log').innerHTML = '';
      buildTerrainImage();
      send('getTerrain');
      break;

    case 'entity:added':
      state.entities.set(msg.data.id, msg.data);
      break;

    case 'entity:destroyed':
      state.entities.delete(msg.data.id);
      addEffect('explosion', msg.data.x, msg.data.y, 15, 30);
      break;

    case 'combat:hit':
      state.stats.combatEngagements++;
      addEffect('hit', msg.data.defender.x, msg.data.defender.y, 8, 15);
      if (msg.data.critical) {
        addEffect('critical', msg.data.defender.x, msg.data.defender.y, 12, 20);
      }
      logEvent('combat', `${msg.data.attacker.name} hit ${msg.data.defender.name} for ${msg.data.damage.toFixed(0)} dmg${msg.data.critical ? ' CRIT!' : ''}`, msg.tick);
      // Update entity health
      if (state.entities.has(msg.data.defender.id)) {
        state.entities.get(msg.data.defender.id).health = msg.data.defender.health;
      }
      break;

    case 'combat:kill':
      state.entities.delete(msg.data.victim.id);
      addEffect('explosion', msg.data.victim.x, msg.data.victim.y, 20, 40);
      logEvent('kill', `${msg.data.killer?.name || 'Unknown'} destroyed ${msg.data.victim.name}`, msg.tick);
      break;

    case 'combat:aoe':
      addEffect('aoe', msg.data.x, msg.data.y, msg.data.radius * state.camera.zoom, 25);
      logEvent('combat', `AOE blast at (${msg.data.x.toFixed(0)},${msg.data.y.toFixed(0)}) - ${msg.data.hits} hit`, msg.tick);
      break;

    case 'combat:air_strike':
      addEffect('airstrike', msg.data.x, msg.data.y, 25, 35);
      logEvent('combat', `Air strike by ${msg.data.source.name} at (${msg.data.x.toFixed(0)},${msg.data.y.toFixed(0)})`, msg.tick);
      break;

    case 'combat:naval_strike':
      addEffect('aoe', msg.data.x, msg.data.y, 20, 30);
      logEvent('combat', `Naval strike by ${msg.data.source.name}`, msg.tick);
      break;

    case 'nuclear:launch':
      state.missiles.push({
        id: msg.data.missile.id,
        launchX: msg.data.missile.launchX,
        launchY: msg.data.missile.launchY,
        targetX: msg.data.missile.targetX,
        targetY: msg.data.missile.targetY,
        progress: 0,
        faction: msg.data.faction,
        type: msg.data.missile.warheadType,
        startTick: msg.tick
      });
      logEvent('nuclear', `☢ NUCLEAR LAUNCH by ${msg.data.faction.toUpperCase()}: ${msg.data.missile.warheadType}`, msg.tick);
      break;

    case 'nuclear:tracking':
      const missile = state.missiles.find(m => m.id === msg.data.missileId);
      if (missile) {
        missile.progress = msg.data.progress;
        missile.currentX = msg.data.x;
        missile.currentY = msg.data.y;
      }
      break;

    case 'nuclear:impact':
      state.missiles = state.missiles.filter(m => m.id !== msg.data.missile?.id);
      addEffect('nuke', msg.data.x, msg.data.y, msg.data.radius * state.camera.zoom, 120);
      logEvent('nuclear impact', `💥 NUCLEAR IMPACT at (${msg.data.x.toFixed(0)},${msg.data.y.toFixed(0)}) - ${msg.data.entitiesKilled} killed`, msg.tick);
      // Rebuild terrain after nuke
      setTimeout(() => send('getTerrain'), 500);
      break;

    case 'nuclear:intercepted':
      state.missiles = state.missiles.filter(m => m.id !== msg.data.missile?.id);
      addEffect('intercept', msg.data.position.x, msg.data.position.y, 15, 30);
      logEvent('nuclear', `Missile intercepted by ${msg.data.interceptedBy.name}`, msg.tick);
      break;

    case 'nuclear:defcon_change':
      state.defcon[msg.data.faction] = msg.data.current;
      updateDefconDisplay();
      logEvent('nuclear', `${msg.data.faction.toUpperCase()} DEFCON changed: ${msg.data.previous} → ${msg.data.current}`, msg.tick);
      break;

    case 'nuclear:warning':
      logEvent('nuclear', `⚠ ${msg.data.detectedBy.toUpperCase()} detects nuclear launch by ${msg.data.launchFaction.toUpperCase()}!`, msg.tick);
      break;

    case 'commander:decision':
      const dec = msg.data.decision;
      const factionKey = msg.data.faction;
      const statusEl = $(`#${factionKey}-commander-status`);
      if (statusEl) {
        statusEl.textContent = `[${dec.mode}] ${dec.actions || 0} orders | Ratio: ${dec.situation?.strengthRatio || '?'}`;
      }
      if (dec.decisions) {
        const types = dec.decisions.map(d => d.type);
        const summary = [...new Set(types)].map(t => `${t}(${types.filter(x => x === t).length})`).join(' ');
        logEvent('commander', `${factionKey.toUpperCase()} CMD: ${summary}`, msg.tick);
      }
      break;

    case 'commanders':
      // Commander state update
      for (const [faction, data] of Object.entries(msg.data)) {
        const el = $(`#${faction}-commander-status`);
        if (el) el.textContent = `${data.personality} | ${data.historyLength} decisions`;
      }
      break;
  }
}

function applyState(s) {
  state.clock = s.clock || state.clock;
  state.stats = s.stats || state.stats;
  state.factions = s.factions || state.factions;
  state.entities.clear();
  if (s.entities) {
    for (const e of s.entities) {
      state.entities.set(e.id, e);
    }
  }
  updateForceOverview();
  updateStats();
  updateSimStatus(state.clock.running ? (state.clock.paused ? 'paused' : 'running') : 'stopped');
}

// ═══════════════════════════════════════════════════════════
// TERRAIN RENDERING
// ═══════════════════════════════════════════════════════════

const BIOME_COLORS = {
  deep_water:    [15, 30, 80],
  shallow_water: [30, 60, 140],
  beach:         [194, 178, 128],
  plains:        [74, 124, 60],
  forest:        [34, 85, 40],
  hills:         [100, 90, 60],
  mountains:     [130, 115, 90],
  peaks:         [200, 200, 210],
  wasteland:     [60, 50, 45],
  void:          [0, 0, 0]
};

function buildTerrainImage() {
  if (!state.terrain) return;
  const { width, height, biome, elevation, water, radiation } = state.terrain;

  const imgData = new ImageData(width, height);
  const d = imgData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const b = biome[y][x];
      const elev = elevation[y][x];
      const rad = radiation[y]?.[x] || 0;
      let [r, g, bl] = BIOME_COLORS[b] || [0, 0, 0];

      // Elevation shading
      if (state.layers.elevation) {
        const shade = 0.6 + elev * 0.5;
        r = Math.floor(r * shade);
        g = Math.floor(g * shade);
        bl = Math.floor(bl * shade);
      }

      // Water depth effect
      if (water[y][x] > 0.5 && state.layers.water) {
        const depth = 1 - elev;
        r = Math.floor(10 + depth * 15);
        g = Math.floor(20 + depth * 40);
        bl = Math.floor(60 + depth * 100);
      }

      // Radiation overlay
      if (rad > 0.05 && state.layers.radiation) {
        const radIntensity = Math.min(1, rad);
        r = Math.floor(r * (1 - radIntensity * 0.5) + 120 * radIntensity);
        g = Math.floor(g * (1 - radIntensity * 0.7));
        bl = Math.floor(bl * (1 - radIntensity * 0.5) + 80 * radIntensity);
      }

      d[idx] = Math.min(255, r);
      d[idx + 1] = Math.min(255, g);
      d[idx + 2] = Math.min(255, bl);
      d[idx + 3] = 255;
    }
  }

  state.terrainImageData = imgData;

  // Create offscreen canvas for terrain
  if (!state.terrainCanvas) {
    state.terrainCanvas = document.createElement('canvas');
  }
  state.terrainCanvas.width = width;
  state.terrainCanvas.height = height;
  state.terrainCanvas.getContext('2d').putImageData(imgData, 0, 0);
}

// ═══════════════════════════════════════════════════════════
// MAIN RENDER LOOP
// ═══════════════════════════════════════════════════════════

function resizeCanvas() {
  const container = $('#map-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
}

function render() {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cam = state.camera;

  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  ctx.scale(cam.zoom, cam.zoom);

  // Layer: Terrain
  if (state.layers.terrain && state.terrainCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.terrainCanvas, 0, 0);
  }

  // Layer: Grid
  if (state.layers.grid && state.terrain) {
    drawGrid();
  }

  // Layer: Features (cities/bases)
  if (state.layers.features && state.terrain) {
    drawFeatures();
  }

  // Layer: Detection ranges
  if (state.layers.detection) {
    drawDetectionRanges();
  }

  // Layer: Weapon ranges
  if (state.layers.ranges) {
    drawWeaponRanges();
  }

  // Layer: Units
  if (state.layers.units) {
    drawUnits();
  }

  // Layer: Labels
  if (state.layers.labels) {
    drawLabels();
  }

  // Layer: Missiles
  if (state.layers.missiles) {
    drawMissiles();
  }

  // Layer: Effects
  if (state.layers.effects) {
    drawEffects();
  }

  ctx.restore();

  // Update minimap periodically
  if (state.clock.tick % 5 === 0) renderMinimap();
  // Update force overview
  if (state.clock.tick % 10 === 0) updateForceOverview();

  requestAnimationFrame(render);
}

function drawGrid() {
  const t = state.terrain;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.1;
  for (let x = 0; x <= t.width; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, t.height);
    ctx.stroke();
  }
  for (let y = 0; y <= t.height; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(t.width, y);
    ctx.stroke();
  }
}

function drawFeatures() {
  for (const f of state.terrain.features) {
    const size = f.type === 'city' ? 2.5 : (f.type === 'military_base' ? 2 : 1.5);

    ctx.fillStyle = f.destroyed ? '#444' :
      f.type === 'city' ? '#fbbf24' :
      f.type === 'military_base' ? '#ef4444' : '#22d3ee';

    if (f.type === 'city') {
      ctx.fillRect(f.x - size / 2, f.y - size / 2, size, size);
    } else if (f.type === 'military_base') {
      ctx.beginPath();
      ctx.moveTo(f.x, f.y - size);
      ctx.lineTo(f.x + size, f.y + size);
      ctx.lineTo(f.x - size, f.y + size);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(f.x, f.y, size * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.camera.zoom > 3) {
      ctx.fillStyle = f.destroyed ? '#666' : '#fff';
      ctx.font = '2px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.name, f.x, f.y + size + 3);
    }
  }
}

function drawDetectionRanges() {
  for (const [, e] of state.entities) {
    if (!e.alive) continue;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.detectionRange, 0, Math.PI * 2);
    const color = e.faction === 'red' ? 'rgba(220,38,38,0.06)' : 'rgba(37,99,235,0.06)';
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = e.faction === 'red' ? 'rgba(220,38,38,0.15)' : 'rgba(37,99,235,0.15)';
    ctx.lineWidth = 0.3;
    ctx.stroke();
  }
}

function drawWeaponRanges() {
  for (const [, e] of state.entities) {
    if (!e.alive || e.attack === 0) continue;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.range, 0, Math.PI * 2);
    ctx.strokeStyle = e.faction === 'red' ? 'rgba(248,113,113,0.2)' : 'rgba(96,165,250,0.2)';
    ctx.lineWidth = 0.2;
    ctx.setLineDash([1, 1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

const UNIT_SHAPES = {
  // Land
  infantry: (ctx, x, y, s) => { ctx.fillRect(x - s, y - s * 0.7, s * 2, s * 1.4); },
  armor: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.6);
    ctx.lineTo(x - s * 0.6, y - s * 0.6);
    ctx.lineTo(x + s * 0.6, y - s * 0.6);
    ctx.lineTo(x + s, y + s * 0.6);
    ctx.closePath();
    ctx.fill();
  },
  artillery: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x, y - s * 0.2, s * 1.2, s * 0.4);
  },
  sam: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y + s * 0.5);
    ctx.lineTo(x - s, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  recon: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
  },
  mlrs: (ctx, x, y, s) => {
    ctx.fillRect(x - s * 0.8, y - s * 0.5, s * 1.6, s);
    ctx.fillRect(x - s * 0.3, y - s, s * 0.6, s * 0.5);
  },
  // Naval
  destroyer: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.6, y + s * 0.6);
    ctx.lineTo(x - s * 0.6, y + s * 0.6);
    ctx.closePath();
    ctx.fill();
  },
  carrier: (ctx, x, y, s) => {
    ctx.fillRect(x - s * 1.2, y - s * 0.4, s * 2.4, s * 0.8);
    ctx.fillRect(x - s * 0.3, y - s * 0.7, s * 0.6, s * 0.3);
  },
  submarine: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  cruiser: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.8, y + s * 0.4);
    ctx.lineTo(x - s * 0.8, y + s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - s * 0.2, y - s * 0.3, s * 0.4, s * 0.6);
  },
  patrol: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.7);
    ctx.lineTo(x + s * 0.5, y + s * 0.5);
    ctx.lineTo(x - s * 0.5, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  amphibious: (ctx, x, y, s) => {
    ctx.fillRect(x - s, y - s * 0.5, s * 2, s);
  },
  missile_sub: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.ellipse(x, y, s * 1.1, s * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - s * 0.2, y - s * 0.6, s * 0.4, s * 0.3);
  },
  // Air
  fighter: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.8, y + s * 0.3);
    ctx.lineTo(x + s * 0.3, y + s * 0.3);
    ctx.lineTo(x, y + s * 0.8);
    ctx.lineTo(x - s * 0.3, y + s * 0.3);
    ctx.lineTo(x - s * 0.8, y + s * 0.3);
    ctx.closePath();
    ctx.fill();
  },
  bomber: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 1.2, y);
    ctx.lineTo(x + s * 0.4, y + s * 0.5);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * 0.4, y + s * 0.5);
    ctx.lineTo(x - s * 1.2, y);
    ctx.closePath();
    ctx.fill();
  },
  stealth_bomber: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.5);
    ctx.lineTo(x + s * 1.3, y + s * 0.2);
    ctx.lineTo(x + s * 0.4, y + s * 0.6);
    ctx.lineTo(x - s * 0.4, y + s * 0.6);
    ctx.lineTo(x - s * 1.3, y + s * 0.2);
    ctx.closePath();
    ctx.fill();
  },
  helicopter: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.stroke();
  },
  drone: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.6);
    ctx.lineTo(x + s * 0.6, y + s * 0.3);
    ctx.lineTo(x, y + s * 0.6);
    ctx.lineTo(x - s * 0.6, y + s * 0.3);
    ctx.closePath();
    ctx.fill();
  },
  awacs: (ctx, x, y, s) => {
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y - s * 0.3, s * 0.4, 0, Math.PI * 2);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.3;
    ctx.stroke();
  },
  transport: (ctx, x, y, s) => {
    ctx.fillRect(x - s * 0.4, y - s, s * 0.8, s * 2);
    ctx.fillRect(x - s, y - s * 0.2, s * 2, s * 0.4);
  }
};

function drawUnits() {
  for (const [, e] of state.entities) {
    if (!e.alive) continue;

    const isSelected = state.selectedUnit === e.id;
    const factionColor = e.faction === 'red' ? '#ef4444' : '#3b82f6';
    const factionColorBright = e.faction === 'red' ? '#fca5a5' : '#93c5fd';
    const size = isSelected ? 2.5 : 1.8;

    // Health-based tint
    const healthPct = e.health / e.maxHealth;
    ctx.globalAlpha = 0.4 + healthPct * 0.6;

    ctx.fillStyle = factionColor;

    const drawFn = UNIT_SHAPES[e.type];
    if (drawFn) {
      drawFn(ctx, e.x, e.y, size);
    } else {
      ctx.beginPath();
      ctx.arc(e.x, e.y, size * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    // Selected unit highlight
    if (isSelected) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(e.x, e.y, size + 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Health bar (show when damaged)
    if (healthPct < 1) {
      const barW = 4;
      const barH = 0.5;
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(e.x - barW / 2, e.y + size + 1, barW, barH);
      ctx.fillStyle = healthPct > 0.5 ? '#16a34a' : healthPct > 0.25 ? '#eab308' : '#ef4444';
      ctx.fillRect(e.x - barW / 2, e.y + size + 1, barW * healthPct, barH);
    }

    // Engagement line
    if (e.status === 'engaging' && e.target) {
      const target = state.entities.get(e.target);
      if (target) {
        ctx.strokeStyle = factionColor;
        ctx.lineWidth = 0.2;
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([1, 1]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // Movement line
    if (e.destination) {
      ctx.strokeStyle = factionColorBright;
      ctx.lineWidth = 0.15;
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([0.5, 0.5]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.destination.x, e.destination.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }
}

function drawLabels() {
  if (state.camera.zoom < 4) return;
  ctx.font = '1.5px sans-serif';
  ctx.textAlign = 'center';

  for (const [, e] of state.entities) {
    if (!e.alive) continue;
    ctx.fillStyle = e.faction === 'red' ? '#fca5a5' : '#93c5fd';
    ctx.globalAlpha = 0.7;
    const label = e.name.replace(/\[.*?\]/, '').trim();
    ctx.fillText(label.length > 16 ? label.slice(0, 16) + '..' : label, e.x, e.y - 3.5);
    ctx.globalAlpha = 1;
  }
}

function drawMissiles() {
  for (const m of state.missiles) {
    const x = m.currentX || (m.launchX + (m.targetX - m.launchX) * m.progress);
    const y = m.currentY || (m.launchY + (m.targetY - m.launchY) * m.progress);

    // Trail
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 0.4;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([1, 0.5]);
    ctx.beginPath();
    ctx.moveTo(m.launchX, m.launchY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Missile head
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Pulsing glow
    ctx.fillStyle = 'rgba(245, 158, 11, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, 3 + Math.sin(Date.now() / 100) * 1, 0, Math.PI * 2);
    ctx.fill();

    // Target reticle
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 0.3;
    ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 200) * 0.3;
    ctx.beginPath();
    ctx.arc(m.targetX, m.targetY, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.targetX - 4, m.targetY); ctx.lineTo(m.targetX + 4, m.targetY);
    ctx.moveTo(m.targetX, m.targetY - 4); ctx.lineTo(m.targetX, m.targetY + 4);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawEffects() {
  const now = Date.now();
  state.effects = state.effects.filter(e => now - e.created < e.duration * 16);

  for (const fx of state.effects) {
    const age = (now - fx.created) / (fx.duration * 16);
    const alpha = 1 - age;

    switch (fx.type) {
      case 'explosion':
        ctx.fillStyle = `rgba(255, 100, 0, ${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.size / state.camera.zoom * (0.5 + age * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 200, 0, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.size / state.camera.zoom * 0.3 * (1 + age), 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'hit':
        ctx.fillStyle = `rgba(255, 255, 0, ${alpha})`;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.size / state.camera.zoom * 0.5 * (1 + age * 0.3), 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'critical':
        ctx.strokeStyle = `rgba(255, 50, 50, ${alpha})`;
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.size / state.camera.zoom * (0.5 + age), 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'nuke':
        // Massive expanding blast
        const nukePhase = age < 0.3 ? age / 0.3 : 1;
        const nukeRadius = (fx.size / state.camera.zoom) * nukePhase;
        
        // White flash
        if (age < 0.15) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(1 - age / 0.15) * 0.8})`;
          ctx.fillRect(fx.x - nukeRadius * 3, fx.y - nukeRadius * 3, nukeRadius * 6, nukeRadius * 6);
        }
        
        // Fireball
        const grad = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, nukeRadius);
        grad.addColorStop(0, `rgba(255, 200, 50, ${alpha * 0.8})`);
        grad.addColorStop(0.4, `rgba(255, 80, 0, ${alpha * 0.6})`);
        grad.addColorStop(0.7, `rgba(150, 30, 0, ${alpha * 0.4})`);
        grad.addColorStop(1, `rgba(80, 0, 80, ${alpha * 0.1})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, nukeRadius, 0, Math.PI * 2);
        ctx.fill();

        // Shockwave ring
        ctx.strokeStyle = `rgba(255, 200, 100, ${alpha * 0.5})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, nukeRadius * (1 + age * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'aoe':
        ctx.strokeStyle = `rgba(255, 150, 0, ${alpha * 0.6})`;
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.size / state.camera.zoom * (0.5 + age * 0.5), 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'airstrike':
        ctx.fillStyle = `rgba(255, 180, 0, ${alpha * 0.6})`;
        for (let i = 0; i < 3; i++) {
          const ox = Math.cos(i * 2.1 + age * 5) * 2;
          const oy = Math.sin(i * 2.1 + age * 5) * 2;
          ctx.beginPath();
          ctx.arc(fx.x + ox, fx.y + oy, 1.5 * (1 - age), 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case 'intercept':
        ctx.fillStyle = `rgba(0, 255, 100, ${alpha * 0.8})`;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 2 + age * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(100, 255, 150, ${alpha * 0.5})`;
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 4 + age * 6, 0, Math.PI * 2);
        ctx.stroke();
        break;
    }
  }
}

function addEffect(type, x, y, size, duration) {
  state.effects.push({ type, x, y, size, duration, created: Date.now() });
}

// ═══════════════════════════════════════════════════════════
// MINIMAP
// ═══════════════════════════════════════════════════════════

function renderMinimap() {
  if (!state.terrainCanvas) return;

  minimapCtx.clearRect(0, 0, 180, 135);

  // Draw terrain scaled down
  minimapCtx.drawImage(state.terrainCanvas, 0, 0, 180, 135);

  // Draw units as dots
  const sx = 180 / (state.terrain?.width || 200);
  const sy = 135 / (state.terrain?.height || 150);

  for (const [, e] of state.entities) {
    if (!e.alive) continue;
    minimapCtx.fillStyle = e.faction === 'red' ? '#ef4444' : '#3b82f6';
    minimapCtx.fillRect(e.x * sx - 1, e.y * sy - 1, 2, 2);
  }

  // Camera viewport rect
  if (state.terrain) {
    const vx = state.camera.x / state.camera.zoom * sx;
    const vy = state.camera.y / state.camera.zoom * sy;
    const vw = canvas.width / state.camera.zoom * sx;
    const vh = canvas.height / state.camera.zoom * sy;
    minimapCtx.strokeStyle = '#fbbf24';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(vx, vy, vw, vh);
  }
}

// ═══════════════════════════════════════════════════════════
// UI UPDATES
// ═══════════════════════════════════════════════════════════

function updateSimStatus(status) {
  const el = $('#sim-status');
  el.textContent = status.toUpperCase();
  el.className = 'status-badge ' + status;

  $('#btn-start').disabled = status === 'running';
  $('#btn-pause').disabled = status !== 'running';
  $('#btn-resume').disabled = status !== 'paused';
  $('#btn-stop').disabled = status === 'stopped';
}

function updateTickDisplay() {
  $('#tick-display').textContent = `Tick: ${state.clock.tick}`;
  const secs = Math.floor(state.clock.elapsed);
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  $('#time-display').textContent = `${h}:${m}:${s}`;
}

function updateStats() {
  $('#stat-total').textContent = state.entities.size;
  $('#stat-destroyed').textContent = state.stats.totalDestroyed;
  $('#stat-engagements').textContent = state.stats.combatEngagements;
  $('#stat-nukes').textContent = state.stats.nuclearStrikes;
}

function updateForceOverview() {
  let redLand = 0, redSea = 0, redAir = 0;
  let blueLand = 0, blueSea = 0, blueAir = 0;

  for (const [, e] of state.entities) {
    if (!e.alive) continue;
    if (e.faction === 'red') {
      if (e.domain === 'land') redLand++;
      else if (e.domain === 'sea') redSea++;
      else if (e.domain === 'air') redAir++;
    } else if (e.faction === 'blue') {
      if (e.domain === 'land') blueLand++;
      else if (e.domain === 'sea') blueSea++;
      else if (e.domain === 'air') blueAir++;
    }
  }

  $('#red-land').textContent = redLand;
  $('#red-sea').textContent = redSea;
  $('#red-air').textContent = redAir;
  $('#blue-land').textContent = blueLand;
  $('#blue-sea').textContent = blueSea;
  $('#blue-air').textContent = blueAir;
}

function updateDefconDisplay() {
  const rEl = $('#defcon-red span');
  const bEl = $('#defcon-blue span');
  rEl.textContent = state.defcon.red;
  bEl.textContent = state.defcon.blue;

  // Color coding by DEFCON level
  const defconColor = (level) => {
    if (level <= 1) return '#ef4444';
    if (level <= 2) return '#f97316';
    if (level <= 3) return '#eab308';
    return '#22c55e';
  };
  rEl.style.color = defconColor(state.defcon.red);
  bEl.style.color = defconColor(state.defcon.blue);
}

function logEvent(category, text, tick) {
  const entry = { category, text, tick: tick || state.clock.tick, time: Date.now() };
  state.eventLog.push(entry);
  if (state.eventLog.length > 500) state.eventLog.shift();

  if (state.logFilter !== 'all' && !category.includes(state.logFilter)) return;

  const log = $('#event-log');
  const div = document.createElement('div');
  div.className = `log-entry ${category}`;
  div.innerHTML = `<span class="log-tick">[${entry.tick}]</span> ${escapeHTML(text)}`;
  log.appendChild(div);

  // Auto-scroll
  if (log.scrollHeight - log.scrollTop - log.clientHeight < 80) {
    log.scrollTop = log.scrollHeight;
  }

  // Limit DOM entries
  while (log.children.length > 300) {
    log.removeChild(log.firstChild);
  }
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showUnitDetail(unitId) {
  const e = state.entities.get(unitId);
  const panel = $('#unit-detail');
  if (!e) {
    panel.innerHTML = '<p class="placeholder">Click a unit on the map to inspect</p>';
    return;
  }

  const healthPct = (e.health / e.maxHealth * 100).toFixed(0);
  const healthColor = healthPct > 50 ? '#16a34a' : healthPct > 25 ? '#eab308' : '#ef4444';

  panel.innerHTML = `
    <div style="color: ${e.faction === 'red' ? '#f87171' : '#60a5fa'}; font-weight: bold; margin-bottom: 4px;">
      ${escapeHTML(e.name)}
    </div>
    <div class="unit-detail-grid">
      <span class="label">Type:</span><span class="value">${e.type}</span>
      <span class="label">Domain:</span><span class="value">${e.domain}</span>
      <span class="label">Status:</span><span class="value">${e.status}</span>
      <span class="label">Position:</span><span class="value">(${e.x.toFixed(0)}, ${e.y.toFixed(0)})</span>
      <span class="label">Health:</span><span class="value">${e.health.toFixed(0)}/${e.maxHealth}</span>
      <span class="label">Attack:</span><span class="value">${e.attack}</span>
      <span class="label">Defense:</span><span class="value">${e.defense}</span>
      <span class="label">Range:</span><span class="value">${e.range}</span>
      <span class="label">Speed:</span><span class="value">${e.speed}</span>
      <span class="label">Kills:</span><span class="value">${e.kills}</span>
    </div>
    <div class="health-bar">
      <div class="health-bar-fill" style="width: ${healthPct}%; background: ${healthColor}"></div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// CAMERA & INPUT
// ═══════════════════════════════════════════════════════════

function screenToWorld(sx, sy) {
  return {
    x: (sx + state.camera.x) / state.camera.zoom,
    y: (sy + state.camera.y) / state.camera.zoom
  };
}

function setupInputHandlers() {
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      state.isDragging = true;
      state.dragStart = { x: e.clientX, y: e.clientY };
      state.cameraStart = { x: state.camera.x, y: state.camera.y };
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    state.mouseWorld = world;
    $('#coord-display').textContent = `${world.x.toFixed(0)}, ${world.y.toFixed(0)}`;

    if (state.isDragging) {
      const dx = e.clientX - state.dragStart.x;
      const dy = e.clientY - state.dragStart.y;
      state.camera.x = state.cameraStart.x - dx;
      state.camera.y = state.cameraStart.y - dy;
    }

    // Tooltip on hover
    updateTooltip(sx, sy, world);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (state.isDragging) {
      const dx = Math.abs(e.clientX - state.dragStart.x);
      const dy = Math.abs(e.clientY - state.dragStart.y);
      if (dx < 3 && dy < 3) {
        // Click - select unit
        handleClick(state.mouseWorld);
      }
    }
    state.isDragging = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldZoom = state.camera.zoom;
    const zoomDelta = e.deltaY > 0 ? 0.85 : 1.18;
    state.camera.zoom = Math.max(1, Math.min(20, state.camera.zoom * zoomDelta));

    // Zoom toward mouse position
    state.camera.x = mx - (mx - state.camera.x) * (state.camera.zoom / oldZoom);
    state.camera.y = my - (my - state.camera.y) * (state.camera.zoom / oldZoom);
  }, { passive: false });

  // Minimap click
  minimapCanvas.addEventListener('click', (e) => {
    const rect = minimapCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const tw = state.terrain?.width || 200;
    const th = state.terrain?.height || 150;
    const worldX = (mx / 180) * tw;
    const worldY = (my / 135) * th;

    state.camera.x = worldX * state.camera.zoom - canvas.width / 2;
    state.camera.y = worldY * state.camera.zoom - canvas.height / 2;
  });

  // Zoom buttons
  $('#btn-zoom-in').addEventListener('click', () => {
    state.camera.zoom = Math.min(20, state.camera.zoom * 1.3);
  });
  $('#btn-zoom-out').addEventListener('click', () => {
    state.camera.zoom = Math.max(1, state.camera.zoom * 0.75);
  });
  $('#btn-zoom-fit').addEventListener('click', () => {
    if (!state.terrain) return;
    const fitZoom = Math.min(
      canvas.width / state.terrain.width,
      canvas.height / state.terrain.height
    );
    state.camera.zoom = fitZoom;
    state.camera.x = 0;
    state.camera.y = 0;
  });

  // Sim controls
  $('#btn-start').addEventListener('click', () => send('start'));
  $('#btn-pause').addEventListener('click', () => send('pause'));
  $('#btn-resume').addEventListener('click', () => send('resume'));
  $('#btn-stop').addEventListener('click', () => send('stop'));
  $('#btn-reset').addEventListener('click', () => send('reset'));

  // Speed slider
  $('#speed-slider').addEventListener('input', (e) => {
    const scale = parseFloat(e.target.value);
    $('#speed-value').textContent = scale + 'x';
    send('setTimeScale', { scale });
  });

  // Layer toggles
  document.querySelectorAll('.layer-toggle').forEach(el => {
    const checkbox = el.querySelector('input');
    const layer = el.dataset.layer;
    checkbox.addEventListener('change', () => {
      state.layers[layer] = checkbox.checked;
      el.classList.toggle('active', checkbox.checked);
      if (layer === 'terrain' || layer === 'elevation' || layer === 'water' || layer === 'radiation') {
        buildTerrainImage();
      }
    });
  });

  // Log filters
  document.querySelectorAll('.log-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.log-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.logFilter = btn.dataset.filter;
      rerenderLog();
    });
  });
}

function handleClick(world) {
  // Find closest entity to click
  let closest = null;
  let closestDist = 5; // minimum distance to select

  for (const [, e] of state.entities) {
    if (!e.alive) continue;
    const dx = e.x - world.x;
    const dy = e.y - world.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closest = e;
      closestDist = dist;
    }
  }

  state.selectedUnit = closest?.id || null;
  showUnitDetail(state.selectedUnit);
}

function updateTooltip(sx, sy, world) {
  const tooltip = $('#map-tooltip');
  if (state.isDragging) {
    tooltip.classList.add('hidden');
    return;
  }

  // Check for nearby entity
  let hoverUnit = null;
  let hoverDist = 3;
  for (const [, e] of state.entities) {
    if (!e.alive) continue;
    const dx = e.x - world.x;
    const dy = e.y - world.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < hoverDist) {
      hoverUnit = e;
      hoverDist = dist;
    }
  }

  if (hoverUnit) {
    const hp = `${hoverUnit.health.toFixed(0)}/${hoverUnit.maxHealth}`;
    tooltip.innerHTML = `<b style="color:${hoverUnit.faction === 'red' ? '#f87171' : '#60a5fa'}">${escapeHTML(hoverUnit.name)}</b><br>${hoverUnit.type} | ${hoverUnit.domain} | ${hoverUnit.status}<br>HP: ${hp} | ATK: ${hoverUnit.attack} | DEF: ${hoverUnit.defense}`;
    tooltip.style.left = (sx + 15) + 'px';
    tooltip.style.top = (sy - 10) + 'px';
    tooltip.classList.remove('hidden');
  } else {
    tooltip.classList.add('hidden');
  }
}

function rerenderLog() {
  const log = $('#event-log');
  log.innerHTML = '';
  const filtered = state.logFilter === 'all'
    ? state.eventLog
    : state.eventLog.filter(e => e.category.includes(state.logFilter));

  for (const entry of filtered.slice(-200)) {
    const div = document.createElement('div');
    div.className = `log-entry ${entry.category}`;
    div.innerHTML = `<span class="log-tick">[${entry.tick}]</span> ${escapeHTML(entry.text)}`;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}

// ═══════════════════════════════════════════════════════════
// PERIODIC STATE SYNC
// ═══════════════════════════════════════════════════════════

function startStateSync() {
  setInterval(() => {
    if (!state.connected) return;

    // Fetch full entity state periodically for sync
    fetch('/api/state')
      .then(r => r.json())
      .then(data => {
        if (data.entities) {
          state.entities.clear();
          for (const e of data.entities) {
            state.entities.set(e.id, e);
          }
        }
        if (data.stats) state.stats = data.stats;
      })
      .catch(() => {});

    // Fetch nuclear state
    fetch('/api/nuclear')
      .then(r => r.json())
      .then(data => {
        if (data.defcon) {
          state.defcon.red = data.defcon.red || 5;
          state.defcon.blue = data.defcon.blue || 5;
          updateDefconDisplay();
        }
      })
      .catch(() => {});
  }, 2000);
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

function init() {
  resizeCanvas();
  setupInputHandlers();
  connectWebSocket();
  startStateSync();
  requestAnimationFrame(render);

  // Center camera on map
  setTimeout(() => {
    if (state.terrain) {
      state.camera.x = 0;
      state.camera.y = 0;
      state.camera.zoom = Math.min(
        canvas.width / state.terrain.width,
        canvas.height / state.terrain.height
      ) * 0.95;
    }
  }, 1500);
}

window.addEventListener('resize', resizeCanvas);
init();
