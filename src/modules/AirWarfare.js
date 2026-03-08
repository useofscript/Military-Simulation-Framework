import Entity from '../core/Entity.js';
import Combat from '../utils/Combat.js';

/**
 * AirWarfare - Module handling air forces: fighters, bombers, helicopters, drones, AWACS.
 */

const AIR_UNIT_TEMPLATES = {
  fighter: {
    name: 'Fighter Squadron', speed: 12, attack: 30, defense: 10,
    range: 10, health: 80, maxHealth: 80, detectionRange: 18, domain: 'air',
    properties: { antiAir: true, fuel: 100, maxFuel: 100, sortieRange: 50 }
  },
  bomber: {
    name: 'Strategic Bomber', speed: 7, attack: 65, defense: 8,
    range: 8, health: 120, maxHealth: 120, detectionRange: 10, domain: 'air',
    properties: { antiAir: false, fuel: 150, maxFuel: 150, bombLoad: 20, sortieRange: 80 }
  },
  helicopter: {
    name: 'Attack Helicopter', speed: 6, attack: 25, defense: 6,
    range: 5, health: 60, maxHealth: 60, detectionRange: 10, domain: 'air',
    properties: { antiAir: false, antiArmor: true, fuel: 60, maxFuel: 60, sortieRange: 25 }
  },
  drone: {
    name: 'Combat Drone', speed: 8, attack: 20, defense: 3,
    range: 7, health: 30, maxHealth: 30, detectionRange: 20, domain: 'air',
    properties: { antiAir: false, fuel: 200, maxFuel: 200, sortieRange: 60, stealth: true }
  },
  awacs: {
    name: 'AWACS', speed: 6, attack: 0, defense: 3,
    range: 0, health: 70, maxHealth: 70, detectionRange: 40, domain: 'air',
    properties: { antiAir: false, fuel: 120, maxFuel: 120, sortieRange: 60, earlyWarning: true }
  },
  transport: {
    name: 'Transport Aircraft', speed: 7, attack: 0, defense: 5,
    range: 0, health: 90, maxHealth: 90, detectionRange: 8, domain: 'air',
    properties: { antiAir: false, fuel: 130, maxFuel: 130, cargo: 6, paradroppable: true }
  },
  stealth_bomber: {
    name: 'Stealth Bomber', speed: 8, attack: 80, defense: 6,
    range: 10, health: 100, maxHealth: 100, detectionRange: 8, domain: 'air',
    properties: { antiAir: false, fuel: 180, maxFuel: 180, bombLoad: 16, stealth: true, nuclearCapable: true }
  }
};

export default class AirWarfare {
  constructor() {
    this.engine = null;
    this.name = 'air';
  }

  init(engine) {
    this.engine = engine;
    engine.events.on('order:air:move', (data) => this.handleMoveOrder(data));
    engine.events.on('order:air:attack', (data) => this.handleAttackOrder(data));
    engine.events.on('order:air:strike', (data) => this.handleAirStrike(data));
    engine.events.on('order:air:patrol', (data) => this.handlePatrolOrder(data));
  }

  spawnUnit(templateKey, faction, x, y, nameOverride = null) {
    const template = AIR_UNIT_TEMPLATES[templateKey];
    if (!template) throw new Error(`Unknown air unit template: ${templateKey}`);

    const entity = new Entity({
      ...template,
      name: nameOverride || `${template.name} [${faction}]`,
      type: templateKey,
      faction,
      x, y
    });

    return this.engine.addEntity(entity);
  }

  handleMoveOrder({ entityId, x, y }) {
    const entity = this.engine.getEntity(entityId);
    if (!entity || entity.domain !== 'air') return;
    entity.moveTo(x, y);
  }

  handleAttackOrder({ entityId, targetId }) {
    const entity = this.engine.getEntity(entityId);
    const target = this.engine.getEntity(targetId);
    if (!entity || !target) return;
    entity.target = targetId;
    entity.status = 'engaging';
  }

  handleAirStrike({ entityId, x, y }) {
    const unit = this.engine.getEntity(entityId);
    if (!unit || unit.domain !== 'air') return;
    if (!unit.properties.bombLoad || unit.properties.bombLoad <= 0) return;

    const entities = [...this.engine.entities.values()];
    const results = Combat.resolveAOE(x, y, 5, unit.attack, entities, unit.faction);
    unit.properties.bombLoad--;

    this.engine.events.emit('combat:air_strike', {
      source: unit.serialize(),
      x, y,
      results,
      domain: 'air'
    });
  }

  handlePatrolOrder({ entityId, waypoints }) {
    const entity = this.engine.getEntity(entityId);
    if (!entity || entity.domain !== 'air') return;
    entity.properties.patrolWaypoints = waypoints;
    entity.properties.currentWaypoint = 0;
    entity.status = 'moving';
    const wp = waypoints[0];
    entity.moveTo(wp.x, wp.y);
  }

  update(tick, dt) {
    const airUnits = this.engine.getEntitiesByDomain('air');

    for (const unit of airUnits) {
      if (!unit.alive) continue;

      // Fuel consumption
      if (unit.properties.fuel !== undefined) {
        unit.properties.fuel -= dt * 0.5;
        if (unit.properties.fuel <= 0) {
          unit.properties.fuel = 0;
          this.engine.events.emit('air:fuel_depleted', { unit: unit.serialize() });
          // Crash or RTB
          unit.takeDamage(unit.health);
          if (!unit.alive) {
            this.engine.events.emit('combat:kill', {
              killer: null,
              victim: unit.serialize(),
              cause: 'fuel_depletion',
              domain: 'air'
            });
            this.engine.removeEntity(unit.id);
            continue;
          }
        }
      }

      // AWACS - extend detection for friendlies
      if (unit.properties.earlyWarning && tick % 5 === 0) {
        const friendlies = this.engine.getEntitiesInRadius(unit.x, unit.y, unit.detectionRange)
          .filter(e => e.alive && e.faction === unit.faction);
        const enemies = this.engine.getEntitiesInRadius(unit.x, unit.y, unit.detectionRange)
          .filter(e => e.alive && this.engine.isHostile(unit.faction, e.faction));

        if (enemies.length > 0) {
          this.engine.events.emit('air:early_warning', {
            awacs: unit.serialize(),
            detectedCount: enemies.length,
            friendlyCount: friendlies.length
          });
        }
      }

      // Patrol waypoint cycling
      if (unit.properties.patrolWaypoints && unit.status === 'idle') {
        const wps = unit.properties.patrolWaypoints;
        unit.properties.currentWaypoint = (unit.properties.currentWaypoint + 1) % wps.length;
        const wp = wps[unit.properties.currentWaypoint];
        unit.moveTo(wp.x, wp.y);
        unit.status = 'moving';
      }

      // Engagement
      if (unit.target) {
        const target = this.engine.getEntity(unit.target);
        if (!target || !target.alive) {
          unit.target = null;
          unit.status = 'idle';
          continue;
        }

        const dist = unit.distanceTo(target);
        if (dist <= unit.range) {
          const result = Combat.resolveAttack(unit, target, this.engine.terrain);
          if (result.hit) {
            this.engine.events.emit('combat:hit', {
              attacker: unit.serialize(),
              defender: target.serialize(),
              damage: result.damage,
              critical: result.critical,
              domain: 'air'
            });
            if (result.killed) {
              this.engine.events.emit('combat:kill', {
                killer: unit.serialize(),
                victim: target.serialize(),
                domain: 'air'
              });
              this.engine.removeEntity(target.id);
              unit.target = null;
              unit.status = 'idle';
            }
          }
        } else {
          unit.moveTo(target.x, target.y);
        }
      }

      // Auto-acquire for fighter/attack aircraft
      if (unit.status === 'idle' && !unit.target && (unit.properties.antiAir || unit.attack > 0)) {
        const nearby = this.engine.getEntitiesInRadius(unit.x, unit.y, unit.detectionRange)
          .filter(e => e.alive && this.engine.isHostile(unit.faction, e.faction));

        // Fighters prefer air targets
        let candidates = nearby;
        if (unit.properties.antiAir) {
          const airTargets = nearby.filter(e => e.domain === 'air');
          if (airTargets.length > 0) candidates = airTargets;
        }

        // Anti-armor helicopters prefer armor
        if (unit.properties.antiArmor) {
          const armorTargets = nearby.filter(e => e.type === 'armor');
          if (armorTargets.length > 0) candidates = armorTargets;
        }

        if (candidates.length > 0 && unit.attack > 0) {
          const closest = candidates.reduce((a, b) =>
            unit.distanceTo(a) < unit.distanceTo(b) ? a : b
          );
          unit.target = closest.id;
          unit.status = 'engaging';
        }
      }
    }
  }
}
