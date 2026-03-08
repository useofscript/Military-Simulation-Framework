import Entity from '../core/Entity.js';
import Combat from '../utils/Combat.js';

/**
 * NavalWarfare - Module handling naval forces: destroyers, carriers, submarines, patrol boats.
 */

const NAVAL_UNIT_TEMPLATES = {
  destroyer: {
    name: 'Destroyer', speed: 5, attack: 40, defense: 20,
    range: 12, health: 300, maxHealth: 300, detectionRange: 15, domain: 'sea',
    properties: { antiSub: true, antiAir: true, missileCapable: true }
  },
  carrier: {
    name: 'Aircraft Carrier', speed: 3, attack: 10, defense: 30,
    range: 5, health: 600, maxHealth: 600, detectionRange: 25, domain: 'sea',
    properties: { aircraftCapacity: 8, antiSub: false, antiAir: true, flagship: true }
  },
  submarine: {
    name: 'Attack Submarine', speed: 4, attack: 55, defense: 8,
    range: 10, health: 150, maxHealth: 150, detectionRange: 12, domain: 'sea',
    properties: { stealth: true, submerged: true, torpedoes: 20, antiSub: true }
  },
  cruiser: {
    name: 'Guided Missile Cruiser', speed: 4.5, attack: 50, defense: 25,
    range: 18, health: 350, maxHealth: 350, detectionRange: 20, domain: 'sea',
    properties: { antiAir: true, missileCapable: true, tomahawks: 30 }
  },
  patrol: {
    name: 'Patrol Boat', speed: 8, attack: 15, defense: 5,
    range: 4, health: 60, maxHealth: 60, detectionRange: 10, domain: 'sea',
    properties: { antiSub: false, antiAir: false }
  },
  amphibious: {
    name: 'Amphibious Assault Ship', speed: 3, attack: 20, defense: 15,
    range: 6, health: 250, maxHealth: 250, detectionRange: 10, domain: 'sea',
    properties: { troopCapacity: 4, canLandTroops: true }
  },
  missile_sub: {
    name: 'Ballistic Missile Sub', speed: 3, attack: 15, defense: 8,
    range: 8, health: 180, maxHealth: 180, detectionRange: 10, domain: 'sea',
    properties: { stealth: true, submerged: true, nuclearCapable: true, missiles: 16 }
  }
};

export default class NavalWarfare {
  constructor() {
    this.engine = null;
    this.name = 'naval';
  }

  init(engine) {
    this.engine = engine;
    engine.events.on('order:naval:move', (data) => this.handleMoveOrder(data));
    engine.events.on('order:naval:attack', (data) => this.handleAttackOrder(data));
    engine.events.on('order:naval:launch_strike', (data) => this.handleStrike(data));
  }

  spawnUnit(templateKey, faction, x, y, nameOverride = null) {
    const template = NAVAL_UNIT_TEMPLATES[templateKey];
    if (!template) throw new Error(`Unknown naval unit template: ${templateKey}`);

    // Validate placement on water
    if (this.engine.terrain.isLand(x, y)) {
      for (let r = 1; r < 30; r++) {
        for (let a = 0; a < 8; a++) {
          const nx = x + Math.cos(a * Math.PI / 4) * r;
          const ny = y + Math.sin(a * Math.PI / 4) * r;
          if (this.engine.terrain.isWater(nx, ny)) {
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
    if (!entity || entity.domain !== 'sea') return;
    entity.moveTo(x, y);
  }

  handleAttackOrder({ entityId, targetId }) {
    const attacker = this.engine.getEntity(entityId);
    const target = this.engine.getEntity(targetId);
    if (!attacker || !target) return;
    attacker.target = targetId;
    attacker.status = 'engaging';
  }

  handleStrike({ entityId, x, y }) {
    const unit = this.engine.getEntity(entityId);
    if (!unit || !unit.properties.missileCapable) return;

    // Cruise missile strike on coordinates
    const entities = [...this.engine.entities.values()];
    const results = Combat.resolveAOE(x, y, 4, 60, entities, unit.faction);
    this.engine.events.emit('combat:naval_strike', {
      source: unit.serialize(),
      x, y,
      results,
      domain: 'sea'
    });
  }

  update(tick, dt) {
    const navalUnits = this.engine.getEntitiesByDomain('sea');

    for (const unit of navalUnits) {
      if (!unit.alive) continue;

      // Submarine detection
      if (unit.properties.submerged && tick % 5 === 0) {
        const nearbyASW = this.engine.getEntitiesInRadius(unit.x, unit.y, 6)
          .filter(e => e.alive && e.properties.antiSub && this.engine.isHostile(unit.faction, e.faction));
        if (nearbyASW.length > 0 && Math.random() < 0.15) {
          unit.properties.detected = true;
          this.engine.events.emit('naval:sub_detected', {
            submarine: unit.serialize(),
            detectedBy: nearbyASW[0].serialize()
          });
        }
      }

      // Combat engagement
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
              domain: 'sea'
            });
            if (result.killed) {
              this.engine.events.emit('combat:kill', {
                killer: unit.serialize(),
                victim: target.serialize(),
                domain: 'sea'
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

      // Auto-target
      if (unit.status === 'idle' && !unit.target) {
        const nearby = this.engine.getEntitiesInRadius(unit.x, unit.y, unit.detectionRange)
          .filter(e => e.alive && this.engine.isHostile(unit.faction, e.faction));

        // Skip stealthed subs that aren't detected
        const visible = nearby.filter(e => !(e.properties.submerged && !e.properties.detected));

        if (visible.length > 0) {
          const closest = visible.reduce((a, b) =>
            unit.distanceTo(a) < unit.distanceTo(b) ? a : b
          );
          unit.target = closest.id;
          unit.status = 'engaging';
        }
      }
    }
  }
}
