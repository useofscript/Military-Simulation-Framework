import SimClock from './Clock.js';
import EventBus from './EventBus.js';
import Terrain from './Terrain.js';

/**
 * Engine - Main simulation engine orchestrating all modules, entities, and the game loop.
 */
export default class Engine {
  constructor(config = {}) {
    this.config = {
      mapWidth: config.mapWidth || 200,
      mapHeight: config.mapHeight || 150,
      tickRate: config.tickRate || 500,
      timeScale: config.timeScale || 1,
      ...config
    };

    this.events = new EventBus();
    this.clock = new SimClock({
      tickRate: this.config.tickRate,
      timeScale: this.config.timeScale
    });
    this.terrain = new Terrain(this.config.mapWidth, this.config.mapHeight);

    this.entities = new Map();
    this.factions = new Map();
    this.modules = new Map();
    this.commanders = new Map();

    this.stats = {
      totalEntities: 0,
      totalDestroyed: 0,
      combatEngagements: 0,
      nuclearStrikes: 0,
      ticksProcessed: 0
    };
  }

  registerModule(name, module) {
    this.modules.set(name, module);
    module.init(this);
    this.events.emit('module:registered', { name });
  }

  registerCommander(faction, commander) {
    this.commanders.set(faction, commander);
    commander.init(this, faction);
    this.events.emit('commander:registered', { faction });
  }

  addFaction(id, data) {
    this.factions.set(id, {
      id,
      name: data.name || id,
      color: data.color || '#888888',
      relations: data.relations || {},
      resources: data.resources || { funds: 10000, fuel: 5000, ammo: 8000 },
      score: 0,
      ...data
    });
    this.events.emit('faction:added', this.factions.get(id));
  }

  addEntity(entity) {
    this.entities.set(entity.id, entity);
    this.stats.totalEntities++;
    this.events.emit('entity:added', entity.serialize());
    return entity;
  }

  removeEntity(id) {
    const entity = this.entities.get(id);
    if (!entity) return;
    entity.alive = false;
    entity.status = 'destroyed';
    this.stats.totalDestroyed++;
    this.events.emit('entity:destroyed', entity.serialize());
    this.entities.delete(id);
  }

  getEntity(id) {
    return this.entities.get(id);
  }

  getEntitiesByFaction(faction) {
    return [...this.entities.values()].filter(e => e.faction === faction && e.alive);
  }

  getEntitiesByDomain(domain) {
    return [...this.entities.values()].filter(e => e.domain === domain && e.alive);
  }

  getEntitiesInRadius(x, y, radius) {
    return [...this.entities.values()].filter(e => {
      if (!e.alive) return false;
      const dx = e.x - x, dy = e.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= radius;
    });
  }

  isHostile(factionA, factionB) {
    if (factionA === factionB) return false;
    const fa = this.factions.get(factionA);
    if (!fa) return true;
    return fa.relations[factionB] === 'hostile';
  }

  start() {
    this.events.emit('sim:start', { tick: 0 });
    this.clock.start((tick, dt, elapsed) => {
      this._update(tick, dt, elapsed);
    });
  }

  pause() {
    this.clock.pause();
    this.events.emit('sim:paused', this.clock.getState());
  }

  resume() {
    this.clock.resume();
    this.events.emit('sim:resumed', this.clock.getState());
  }

  stop() {
    this.clock.stop();
    this.events.emit('sim:stopped', this.getState());
  }

  _update(tick, dt, elapsed) {
    this.stats.ticksProcessed++;

    // Update all entities' movement
    for (const entity of this.entities.values()) {
      if (!entity.alive) continue;
      entity.updateMovement(dt);
    }

    // Update all registered modules
    for (const [name, module] of this.modules) {
      try {
        module.update(tick, dt, elapsed);
      } catch (err) {
        console.error(`[Engine] Module "${name}" update error:`, err);
      }
    }

    // Radiation decay
    if (tick % 20 === 0) {
      for (let y = 0; y < this.terrain.height; y++) {
        for (let x = 0; x < this.terrain.width; x++) {
          if (this.terrain.radiation[y][x] > 0.01) {
            this.terrain.radiation[y][x] *= 0.995;
          }
        }
      }
    }

    // Radiation damage to entities
    for (const entity of this.entities.values()) {
      if (!entity.alive) continue;
      const rad = this.terrain.getRadiation(entity.x, entity.y);
      if (rad > 0.1) {
        const radDamage = rad * 5 * dt;
        entity.takeDamage(radDamage);
        if (!entity.alive) {
          this.events.emit('entity:radiation_kill', { entity: entity.serialize() });
          this.removeEntity(entity.id);
        }
      }
    }

    // Commander AI decisions (every 10 ticks)
    if (tick % 10 === 0) {
      for (const [faction, commander] of this.commanders) {
        try {
          commander.evaluate(tick, dt);
        } catch (err) {
          console.error(`[Engine] Commander "${faction}" error:`, err);
        }
      }
    }

    // Emit tick update
    this.events.emit('sim:tick', {
      tick,
      dt,
      elapsed,
      stats: { ...this.stats },
      entitiesAlive: [...this.entities.values()].filter(e => e.alive).length,
      entities: [...this.entities.values()].filter(e => e.alive).map(e => ({
        id: e.id, x: e.x, y: e.y, health: e.health, status: e.status
      }))
    });
  }

  getState() {
    const entities = [];
    for (const e of this.entities.values()) {
      entities.push(e.serialize());
    }
    return {
      clock: this.clock.getState(),
      stats: { ...this.stats },
      factions: Object.fromEntries(this.factions),
      entities,
      terrain: {
        width: this.terrain.width,
        height: this.terrain.height,
        features: this.terrain.features
      }
    };
  }

  getFullTerrainData() {
    return this.terrain.serialize();
  }
}
