/**
 * Combat - Utility functions for combat resolution, line-of-sight, and damage calculation.
 */
export default class Combat {
  /**
   * Calculate hit probability based on attacker/defender stats, range, terrain.
   */
  static hitProbability(attacker, defender, terrain = null) {
    const dist = attacker.distanceTo(defender);
    if (dist > attacker.range) return 0;

    let baseHit = 0.7;

    // Range penalty
    const rangeFactor = 1 - (dist / attacker.range) * 0.4;
    baseHit *= rangeFactor;

    // Terrain cover bonus for defender
    if (terrain) {
      const biome = terrain.getBiome(defender.x, defender.y);
      const coverBonus = {
        'forest': 0.25,
        'hills': 0.2,
        'mountains': 0.35,
        'peaks': 0.4,
        'plains': 0.05,
        'beach': 0.05,
        'deep_water': 0.0,
        'shallow_water': 0.0,
        'wasteland': 0.0
      };
      baseHit -= (coverBonus[biome] || 0);
    }

    // Attacker moving penalty
    if (attacker.status === 'moving') baseHit *= 0.7;

    // Domain mismatch bonus/penalty
    if (attacker.domain === 'air' && defender.domain === 'land') baseHit *= 1.15;
    if (attacker.domain === 'land' && defender.domain === 'air') baseHit *= 0.4;
    if (attacker.domain === 'sea' && defender.domain === 'land') baseHit *= 0.9;

    return Math.max(0.05, Math.min(0.95, baseHit));
  }

  /**
   * Resolve a single combat exchange between attacker and defender.
   * Returns { hit, damage, critical, killed }
   */
  static resolveAttack(attacker, defender, terrain = null) {
    const hitChance = this.hitProbability(attacker, defender, terrain);
    const roll = Math.random();
    const hit = roll <= hitChance;

    if (!hit) {
      return { hit: false, damage: 0, critical: false, killed: false };
    }

    // Base damage
    let damage = attacker.attack * (0.8 + Math.random() * 0.4);

    // Critical hit (10% chance)
    const critical = Math.random() < 0.10;
    if (critical) damage *= 2;

    // Apply damage
    const actualDamage = defender.takeDamage(damage);
    attacker.damageDealt += actualDamage;

    const killed = !defender.alive;
    if (killed) attacker.kills++;

    return { hit: true, damage: actualDamage, critical, killed };
  }

  /**
   * Area-of-effect damage (for artillery, bombs, nuclear).
   */
  static resolveAOE(x, y, radius, baseDamage, entities, excludeFaction = null) {
    const results = [];
    for (const entity of entities) {
      if (!entity.alive) continue;
      if (excludeFaction && entity.faction === excludeFaction) continue;

      const dx = entity.x - x;
      const dy = entity.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const falloff = 1 - (dist / radius);
      const damage = baseDamage * falloff * (0.8 + Math.random() * 0.4);
      const actual = entity.takeDamage(damage);

      results.push({
        entityId: entity.id,
        damage: actual,
        killed: !entity.alive,
        distance: dist
      });
    }
    return results;
  }

  /**
   * Check line-of-sight between two points on terrain.
   */
  static hasLineOfSight(x1, y1, x2, y2, terrain) {
    const dx = x2 - x1, dy = y2 - y1;
    const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy));
    const startElev = terrain.getElevation(x1, y1);
    const endElev = terrain.getElevation(x2, y2);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const mx = x1 + dx * t;
      const my = y1 + dy * t;
      const expectedElev = startElev + (endElev - startElev) * t;
      const actualElev = terrain.getElevation(mx, my);
      if (actualElev > expectedElev + 0.08) return false;
    }
    return true;
  }
}
