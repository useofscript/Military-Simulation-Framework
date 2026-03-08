import Entity from '../core/Entity.js';
import Combat from '../utils/Combat.js';

/**
 * LandWarfare - Module handling ground forces: infantry, armor, artillery, SAM.
 */

const LAND_UNIT_TEMPLATES = {
  infantry: {
    name: 'Infantry Platoon', speed: 2, attack: 12, defense: 8,
    range: 3, health: 80, maxHealth: 80, detectionRange: 6, domain: 'land',
    properties: { canCapture: true, antiAir: false }
  },
  armor: {
    name: 'Armored Company', speed: 4, attack: 35, defense: 25,
    range: 6, health: 200, maxHealth: 200, detectionRange: 8, domain: 'land',
    properties: { canCapture: false, antiAir: false }
  },
  artillery: {
    name: 'Artillery Battery', speed: 1.5, attack: 50, defense: 5,
    range: 18, health: 60, maxHealth: 60, detectionRange: 4, domain: 'land',
    properties: { canCapture: false, antiAir: false, aoe: 3 }
  },
  sam: {
    name: 'SAM Site', speed: 1, attack: 45, defense: 10,
    range: 15, health: 80, maxHealth: 80, detectionRange: 20, domain: 'land',
    properties: { canCapture: false, antiAir: true, antiGround: false }
  },
  recon: {
    name: 'Recon Team', speed: 5, attack: 5, defense: 3,
    range: 2, health: 30, maxHealth: 30, detectionRange: 15, domain: 'land',
    properties: { canCapture: false, antiAir: false, stealth: true }
  },
  mlrs: {
    name: 'MLRS Battery', speed: 2, attack: 65, defense: 4,
    range: 25, health: 50, maxHealth: 50, detectionRange: 5, domain: 'land',
    properties: { canCapture: false, antiAir: false, aoe: 5, salvoSize: 12 }
  }
};

export default class LandWarfare {
  constructor() {
    this.engine = null;
    this.name = 'land';
  }

  init(engine) {
    this.engine = engine;
    engine.events.on('order:land:move', (data) => this.handleMoveOrder(data));
    engine.events.on('order:land:attack', (data) => this.handleAttackOrder(data));
  }

  spawnUnit(templateKey, faction, x, y, nameOverride = null) {
    const template = LAND_UNIT_TEMPLATES[templateKey];
    if (!template) throw new Error(`Unknown land unit template: ${templateKey}`);

    // Validate placement on land
    if (this.engine.terrain.isWater(x, y)) {
      // Find nearest land
      for (let r = 1; r < 20; r++) {
        for (let a = 0; a < 8; a++) {
          const nx = x + Math.cos(a * Math.PI / 4) * r;
          const ny = y + Math.sin(a * Math.PI / 4) * r;
          if (this.engine.terrain.isLand(nx, ny)) {
            x = nx; y = ny; r = 999; break;
          }
        }
      }
    }

    const entity = new Entity({
      ...template,
      name: nameOverride || `${template.name} [${faction}]`,
      type: templateKey,
      faction,
      x: Math.round(x),
      y: Math.round(y)
    });

    return this.engine.addEntity(entity);
  }

  handleMoveOrder({ entityId, x, y }) {
    const entity = this.engine.getEntity(entityId);
    if (!entity || entity.domain !== 'land') return;
    if (this.engine.terrain.isWater(x, y)) return; // Can't move to water
    entity.moveTo(x, y);
  }

  handleAttackOrder({ entityId, targetId }) {
    const attacker = this.engine.getEntity(entityId);
    const target = this.engine.getEntity(targetId);
    if (!attacker || !target) return;
    attacker.target = targetId;
    attacker.status = 'engaging';
  }

  update(tick, dt) {
    const landUnits = this.engine.getEntitiesByDomain('land');

    for (const unit of landUnits) {
      if (!unit.alive) continue;

      // Process engagement
      if (unit.target) {
        const target = this.engine.getEntity(unit.target);
        if (!target || !target.alive) {
          unit.target = null;
          unit.status = 'idle';
          continue;
        }

        const dist = unit.distanceTo(target);

        // SAM units only attack air targets
        if (unit.properties.antiAir && !unit.properties.antiGround && target.domain !== 'air') {
          unit.target = null;
          continue;
        }

        if (dist <= unit.range) {
          // In range - fire
          const result = Combat.resolveAttack(unit, target, this.engine.terrain);
          if (result.hit) {
            this.engine.events.emit('combat:hit', {
              attacker: unit.serialize(),
              defender: target.serialize(),
              damage: result.damage,
              critical: result.critical,
              domain: 'land'
            });

            // AOE for artillery
            if (unit.properties.aoe && result.hit) {
              const aoeResults = Combat.resolveAOE(
                target.x, target.y, unit.properties.aoe,
                unit.attack * 0.5, [...this.engine.entities.values()],
                unit.faction
              );
              if (aoeResults.length > 0) {
                this.engine.events.emit('combat:aoe', {
                  source: unit.serialize(),
                  x: target.x, y: target.y,
                  radius: unit.properties.aoe,
                  hits: aoeResults.length,
                  domain: 'land'
                });
              }
            }

            if (result.killed) {
              this.engine.events.emit('combat:kill', {
                killer: unit.serialize(),
                victim: target.serialize(),
                domain: 'land'
              });
              this.engine.removeEntity(target.id);
              unit.target = null;
              unit.status = 'idle';
            }
          }
        } else {
          // Move toward target
          unit.moveTo(target.x, target.y);
        }
      }

      // Auto-acquire targets if idle
      if (unit.status === 'idle' && !unit.target) {
        const nearbyEnemies = this.engine.getEntitiesInRadius(unit.x, unit.y, unit.detectionRange)
          .filter(e => e.alive && this.engine.isHostile(unit.faction, e.faction));

        // SAM units prefer air targets
        if (unit.properties.antiAir) {
          const airTarget = nearbyEnemies.find(e => e.domain === 'air');
          if (airTarget) {
            unit.target = airTarget.id;
            unit.status = 'engaging';
            continue;
          }
          if (!unit.properties.antiGround) continue;
        }

        // Filter by domain appropriateness
        const validTargets = nearbyEnemies.filter(e => {
          if (unit.properties.antiAir && !unit.properties.antiGround) return e.domain === 'air';
          return true;
        });

        if (validTargets.length > 0) {
          const closest = validTargets.reduce((a, b) =>
            unit.distanceTo(a) < unit.distanceTo(b) ? a : b
          );
          unit.target = closest.id;
          unit.status = 'engaging';
        }
      }
    }
  }
}
