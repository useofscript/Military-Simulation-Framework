import Combat from '../utils/Combat.js';

/**
 * NuclearWarfare - Module handling nuclear weapons: ICBMs, tactical nukes, SLBM launches.
 * Includes launch authorization, flight simulation, impact, and fallout.
 */

const NUCLEAR_WARHEADS = {
  tactical: { yield: 0.5, radius: 8, damage: 500, falloutRadius: 15, flightTime: 5 },
  strategic: { yield: 5,   radius: 20, damage: 2000, falloutRadius: 40, flightTime: 15 },
  icbm:      { yield: 10,  radius: 30, damage: 5000, falloutRadius: 60, flightTime: 25 },
  slbm:      { yield: 8,   radius: 25, damage: 3500, falloutRadius: 50, flightTime: 12 }
};

export default class NuclearWarfare {
  constructor() {
    this.engine = null;
    this.name = 'nuclear';
    this.inFlight = [];          // missiles currently in flight
    this.launchHistory = [];     // all launches
    this.defconLevels = {};      // per-faction DEFCON
  }

  init(engine) {
    this.engine = engine;
    engine.events.on('order:nuclear:launch', (data) => this.handleLaunch(data));
    engine.events.on('order:nuclear:set_defcon', (data) => this.setDefcon(data));

    // Initialize DEFCON for all factions
    for (const [id] of engine.factions) {
      this.defconLevels[id] = 5; // Peacetime
    }
  }

  setDefcon({ faction, level }) {
    const prev = this.defconLevels[faction];
    this.defconLevels[faction] = Math.max(1, Math.min(5, level));
    this.engine.events.emit('nuclear:defcon_change', {
      faction,
      previous: prev,
      current: this.defconLevels[faction]
    });
  }

  handleLaunch({ faction, warheadType, targetX, targetY, launcherId = null }) {
    const warhead = NUCLEAR_WARHEADS[warheadType];
    if (!warhead) return;

    // DEFCON check - must be DEFCON 2 or 1 to launch
    if (this.defconLevels[faction] > 2) {
      this.engine.events.emit('nuclear:launch_denied', {
        faction,
        reason: `DEFCON ${this.defconLevels[faction]} - authorization denied`,
        warheadType
      });
      return;
    }

    // Determine launch position
    let launchX, launchY;
    if (launcherId) {
      const launcher = this.engine.getEntity(launcherId);
      if (launcher && launcher.alive) {
        launchX = launcher.x;
        launchY = launcher.y;
      } else return;
    } else {
      // Use a random friendly unit or base position
      const friendlies = this.engine.getEntitiesByFaction(faction);
      if (friendlies.length === 0) return;
      const source = friendlies[Math.floor(Math.random() * friendlies.length)];
      launchX = source.x;
      launchY = source.y;
    }

    const missile = {
      id: `nuke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      faction,
      warheadType,
      warhead,
      launchX, launchY,
      targetX, targetY,
      launchTick: this.engine.clock.tick,
      impactTick: this.engine.clock.tick + warhead.flightTime,
      intercepted: false
    };

    this.inFlight.push(missile);
    this.launchHistory.push(missile);
    this.engine.stats.nuclearStrikes++;

    this.engine.events.emit('nuclear:launch', {
      missile: { ...missile, warhead: { ...warhead } },
      faction
    });

    // Alert all factions about launch
    for (const [fid] of this.engine.factions) {
      if (fid === faction) continue;
      this.engine.events.emit('nuclear:warning', {
        detectedBy: fid,
        launchFaction: faction,
        estimatedImpact: warhead.flightTime,
        warheadType
      });
    }
  }

  update(tick, dt) {
    const landed = [];

    for (const missile of this.inFlight) {
      if (missile.intercepted) continue;

      // Interception check - SAM sites and anti-missile units
      if (tick < missile.impactTick) {
        // Calculate current approximate position (linear interpolation)
        const progress = (tick - missile.launchTick) / (missile.impactTick - missile.launchTick);
        const currentX = missile.launchX + (missile.targetX - missile.launchX) * progress;
        const currentY = missile.launchY + (missile.targetY - missile.launchY) * progress;

        const interceptors = this.engine.getEntitiesInRadius(currentX, currentY, 10)
          .filter(e => e.alive && e.properties.antiAir && this.engine.isHostile(e.faction, missile.faction));

        for (const interceptor of interceptors) {
          const interceptChance = 0.15; // 15% per tick per interceptor
          if (Math.random() < interceptChance) {
            missile.intercepted = true;
            this.engine.events.emit('nuclear:intercepted', {
              missile: { ...missile },
              interceptedBy: interceptor.serialize(),
              position: { x: currentX, y: currentY }
            });
            break;
          }
        }

        // Emit tracking update
        this.engine.events.emit('nuclear:tracking', {
          missileId: missile.id,
          x: currentX,
          y: currentY,
          progress,
          eta: missile.impactTick - tick
        });

        continue;
      }

      // Impact
      if (!missile.intercepted) {
        this._detonate(missile);
      }
      landed.push(missile);
    }

    // Remove landed missiles
    this.inFlight = this.inFlight.filter(m => !landed.includes(m) && !m.intercepted);
  }

  _detonate(missile) {
    const { targetX, targetY, warhead, faction, warheadType } = missile;

    // Apply terrain effects
    this.engine.terrain.applyNuclearStrike(targetX, targetY, warhead.radius, 1.0);

    // Damage entities
    const allEntities = [...this.engine.entities.values()];
    const results = Combat.resolveAOE(targetX, targetY, warhead.radius, warhead.damage, allEntities);

    // Remove killed entities
    const killed = [];
    for (const result of results) {
      if (result.killed) {
        const entity = this.engine.getEntity(result.entityId);
        if (entity) {
          killed.push(entity.serialize());
          this.engine.removeEntity(result.entityId);
        }
      }
    }

    this.engine.events.emit('nuclear:impact', {
      missile: { ...missile, warhead: { ...warhead } },
      x: targetX,
      y: targetY,
      radius: warhead.radius,
      falloutRadius: warhead.falloutRadius,
      totalDamageDealt: results.reduce((s, r) => s + r.damage, 0),
      entitiesHit: results.length,
      entitiesKilled: killed.length,
      killed
    });

    // Feature destruction
    for (const feature of this.engine.terrain.features) {
      const dx = feature.x - targetX, dy = feature.y - targetY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= warhead.radius * 0.5) {
        feature.destroyed = true;
        feature.name = `[DESTROYED] ${feature.name}`;
      }
    }
  }

  getDefconLevels() {
    return { ...this.defconLevels };
  }

  getInFlightMissiles() {
    return this.inFlight.map(m => ({
      ...m,
      warhead: { ...m.warhead },
      progress: Math.min(1, (this.engine.clock.tick - m.launchTick) / (m.impactTick - m.launchTick))
    }));
  }
}
