import { v4 as uuidv4 } from 'uuid';

/**
 * Entity - Base class for all simulation entities (units, structures, weapons).
 */
export default class Entity {
  constructor({
    name = 'Unknown',
    type = 'generic',
    faction = 'neutral',
    x = 0,
    y = 0,
    health = 100,
    maxHealth = 100,
    speed = 0,
    attack = 0,
    defense = 0,
    range = 1,
    detectionRange = 5,
    domain = 'land',  // land | sea | air | space
    properties = {}
  } = {}) {
    this.id = uuidv4();
    this.name = name;
    this.type = type;
    this.faction = faction;
    this.x = x;
    this.y = y;
    this.health = health;
    this.maxHealth = maxHealth;
    this.speed = speed;
    this.attack = attack;
    this.defense = defense;
    this.range = range;
    this.detectionRange = detectionRange;
    this.domain = domain;
    this.alive = true;
    this.target = null;          // target entity id
    this.destination = null;     // {x, y} movement target
    this.orders = [];            // queue of orders
    this.status = 'idle';        // idle | moving | engaging | retreating | destroyed
    this.properties = properties;
    this.kills = 0;
    this.damageDealt = 0;
    this.created = Date.now();
  }

  distanceTo(other) {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  moveTo(x, y) {
    this.destination = { x, y };
    this.status = 'moving';
  }

  updateMovement(dt) {
    if (!this.destination || this.speed === 0) return;
    const dx = this.destination.x - this.x;
    const dy = this.destination.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.5) {
      this.x = this.destination.x;
      this.y = this.destination.y;
      this.destination = null;
      this.status = 'idle';
      return;
    }
    const step = this.speed * dt;
    const ratio = Math.min(step / dist, 1);
    this.x += dx * ratio;
    this.y += dy * ratio;
  }

  takeDamage(amount) {
    const mitigated = Math.max(0, amount - this.defense * 0.3);
    this.health -= mitigated;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.status = 'destroyed';
    }
    return mitigated;
  }

  repair(amount) {
    if (!this.alive) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  issueOrder(order) {
    this.orders.push(order);
  }

  serialize() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      faction: this.faction,
      x: this.x,
      y: this.y,
      health: this.health,
      maxHealth: this.maxHealth,
      speed: this.speed,
      attack: this.attack,
      defense: this.defense,
      range: this.range,
      detectionRange: this.detectionRange,
      domain: this.domain,
      alive: this.alive,
      status: this.status,
      kills: this.kills,
      damageDealt: this.damageDealt,
      properties: this.properties
    };
  }
}
