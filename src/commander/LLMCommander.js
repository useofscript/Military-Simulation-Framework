/**
 * LLMCommander - AI Commander that uses an LLM API (OpenAI-compatible) to make
 * strategic and tactical decisions. Falls back to rule-based AI when no API is available.
 * 
 * Supports any OpenAI-compatible API endpoint (OpenAI, Ollama, LM Studio, etc.)
 */

export default class LLMCommander {
  constructor({
    apiUrl = process.env.LLM_API_URL || 'http://localhost:11434/v1/chat/completions',
    apiKey = process.env.LLM_API_KEY || '',
    model = process.env.LLM_MODEL || 'llama3',
    personality = 'balanced',
    useLLM = false
  } = {}) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.personality = personality;
    this.useLLM = useLLM;
    this.engine = null;
    this.faction = null;
    this.lastDecision = null;
    this.decisionHistory = [];
    this.pendingLLMCall = false;

    // Rule-based AI parameters by personality
    this.personalityTraits = {
      aggressive:  { attackBias: 0.8, defenseBias: 0.2, nuclearThreshold: 0.4, retreatThreshold: 0.15 },
      defensive:   { attackBias: 0.3, defenseBias: 0.8, nuclearThreshold: 0.1, retreatThreshold: 0.4 },
      balanced:    { attackBias: 0.5, defenseBias: 0.5, nuclearThreshold: 0.25, retreatThreshold: 0.3 },
      reckless:    { attackBias: 0.9, defenseBias: 0.1, nuclearThreshold: 0.6, retreatThreshold: 0.05 }
    };
    this.traits = this.personalityTraits[personality] || this.personalityTraits.balanced;
  }

  init(engine, faction) {
    this.engine = engine;
    this.faction = faction;
  }

  async evaluate(tick) {
    const situation = this._assessSituation();

    if (this.useLLM && !this.pendingLLMCall) {
      this._llmDecision(situation, tick);
    } else {
      this._ruleBasedDecision(situation, tick);
    }
  }

  _assessSituation() {
    const myUnits = this.engine.getEntitiesByFaction(this.faction);
    const allEntities = [...this.engine.entities.values()].filter(e => e.alive);
    const enemyUnits = allEntities.filter(e => this.engine.isHostile(this.faction, e.faction));

    const myStrength = myUnits.reduce((s, u) => s + u.attack + u.defense + u.health / 10, 0);
    const enemyStrength = enemyUnits.reduce((s, u) => s + u.attack + u.defense + u.health / 10, 0);

    const byDomain = (units) => ({
      land: units.filter(u => u.domain === 'land'),
      sea: units.filter(u => u.domain === 'sea'),
      air: units.filter(u => u.domain === 'air')
    });

    const myByDomain = byDomain(myUnits);
    const enemyByDomain = byDomain(enemyUnits);

    // Compute center of mass
    const centerOf = (units) => {
      if (units.length === 0) return { x: 100, y: 75 };
      const x = units.reduce((s, u) => s + u.x, 0) / units.length;
      const y = units.reduce((s, u) => s + u.y, 0) / units.length;
      return { x, y };
    };

    // Threat assessment
    const threats = [];
    for (const enemy of enemyUnits) {
      const nearestFriendly = myUnits.reduce((closest, u) => {
        const d = u.distanceTo(enemy);
        return d < closest.dist ? { unit: u, dist: d } : closest;
      }, { unit: null, dist: Infinity });

      if (nearestFriendly.dist < 30) {
        threats.push({
          enemy: enemy.serialize(),
          distance: nearestFriendly.dist,
          nearestFriendly: nearestFriendly.unit?.id
        });
      }
    }

    return {
      tick: this.engine.clock.tick,
      faction: this.faction,
      myUnits: myUnits.length,
      enemyUnits: enemyUnits.length,
      myStrength,
      enemyStrength,
      strengthRatio: enemyStrength > 0 ? myStrength / enemyStrength : 999,
      myCenter: centerOf(myUnits),
      enemyCenter: centerOf(enemyUnits),
      myDomainCount: { land: myByDomain.land.length, sea: myByDomain.sea.length, air: myByDomain.air.length },
      enemyDomainCount: { land: enemyByDomain.land.length, sea: enemyByDomain.sea.length, air: enemyByDomain.air.length },
      threats: threats.slice(0, 10),
      units: myUnits,
      enemyVisible: enemyUnits.slice(0, 20)
    };
  }

  _ruleBasedDecision(sit, tick) {
    const decisions = [];

    // Nuclear escalation check
    if (sit.strengthRatio < this.traits.nuclearThreshold && sit.myUnits > 0) {
      const nuclearModule = this.engine.modules.get('nuclear');
      if (nuclearModule && nuclearModule.defconLevels[this.faction] > 2) {
        this.engine.events.emit('order:nuclear:set_defcon', { faction: this.faction, level: 2 });
        decisions.push({ type: 'DEFCON_RAISE', level: 2 });
      }
      if (nuclearModule && nuclearModule.defconLevels[this.faction] <= 2 && sit.strengthRatio < 0.15) {
        // Desperate - launch nuclear strike at enemy center
        this.engine.events.emit('order:nuclear:launch', {
          faction: this.faction,
          warheadType: 'strategic',
          targetX: sit.enemyCenter.x,
          targetY: sit.enemyCenter.y
        });
        decisions.push({ type: 'NUCLEAR_LAUNCH', target: sit.enemyCenter });
      }
    }

    // Tactical decisions per unit
    for (const unit of sit.units) {
      if (unit.status === 'engaging' || unit.status === 'destroyed') continue;

      // Retreat badly damaged units
      if (unit.health / unit.maxHealth < this.traits.retreatThreshold) {
        const retreatX = sit.myCenter.x + (Math.random() - 0.5) * 10;
        const retreatY = sit.myCenter.y + (Math.random() - 0.5) * 10;
        const orderEvent = `order:${unit.domain === 'sea' ? 'naval' : unit.domain}:move`;
        this.engine.events.emit(orderEvent, { entityId: unit.id, x: retreatX, y: retreatY });
        decisions.push({ type: 'RETREAT', unit: unit.id });
        continue;
      }

      // Attack decision
      if (Math.random() < this.traits.attackBias && sit.threats.length > 0) {
        const threat = sit.threats[Math.floor(Math.random() * sit.threats.length)];
        const orderEvent = `order:${unit.domain === 'sea' ? 'naval' : unit.domain}:attack`;
        this.engine.events.emit(orderEvent, { entityId: unit.id, targetId: threat.enemy.id });
        decisions.push({ type: 'ATTACK', unit: unit.id, target: threat.enemy.id });
      } else if (unit.status === 'idle') {
        // Move toward strategic objective or enemy center
        const jitter = 15;
        const targetX = sit.enemyCenter.x + (Math.random() - 0.5) * jitter;
        const targetY = sit.enemyCenter.y + (Math.random() - 0.5) * jitter;
        const orderEvent = `order:${unit.domain === 'sea' ? 'naval' : unit.domain}:move`;
        this.engine.events.emit(orderEvent, { entityId: unit.id, x: targetX, y: targetY });
        decisions.push({ type: 'ADVANCE', unit: unit.id });
      }
    }

    this.lastDecision = {
      tick,
      mode: 'rule-based',
      personality: this.personality,
      situation: {
        myUnits: sit.myUnits,
        enemyUnits: sit.enemyUnits,
        strengthRatio: sit.strengthRatio.toFixed(2)
      },
      actions: decisions.length,
      decisions: decisions.slice(0, 10)
    };
    this.decisionHistory.push(this.lastDecision);

    this.engine.events.emit('commander:decision', {
      faction: this.faction,
      decision: this.lastDecision
    });
  }

  async _llmDecision(sit, tick) {
    this.pendingLLMCall = true;

    const systemPrompt = `You are a military AI commander for faction "${this.faction}" in a war simulation.
Your personality: ${this.personality}.
You command land, naval, and air forces. You can order nuclear strikes if DEFCON is 2 or lower.

Respond with a JSON object containing an array of "orders", each order being:
{ "type": "move"|"attack"|"nuclear"|"defcon", "unitId": "...", "targetId": "...", "x": N, "y": N, "defconLevel": N, "warheadType": "tactical"|"strategic" }

Be concise. Only target visible enemies. Consider strength ratios and domain balance.`;

    const userPrompt = `Current situation (Tick ${tick}):
- Your units: ${sit.myUnits} (Land: ${sit.myDomainCount.land}, Sea: ${sit.myDomainCount.sea}, Air: ${sit.myDomainCount.air})
- Enemy units: ${sit.enemyUnits} (Land: ${sit.enemyDomainCount.land}, Sea: ${sit.enemyDomainCount.sea}, Air: ${sit.enemyDomainCount.air})
- Strength ratio (yours/theirs): ${sit.strengthRatio.toFixed(2)}
- Your center: (${sit.myCenter.x.toFixed(0)}, ${sit.myCenter.y.toFixed(0)})
- Enemy center: (${sit.enemyCenter.x.toFixed(0)}, ${sit.enemyCenter.y.toFixed(0)})
- Immediate threats: ${sit.threats.length}
${sit.threats.slice(0, 5).map(t => `  - ${t.enemy.type} at (${t.enemy.x.toFixed(0)},${t.enemy.y.toFixed(0)}) dist=${t.distance.toFixed(0)}`).join('\n')}
- Your idle units: ${sit.units.filter(u => u.status === 'idle').map(u => `${u.type}@(${u.x.toFixed(0)},${u.y.toFixed(0)}) id=${u.id}`).slice(0, 8).join(', ')}

Issue your orders.`;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const resp = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 500
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!resp.ok) throw new Error(`LLM API returned ${resp.status}`);

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '{}';

      // Parse LLM response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.orders && Array.isArray(parsed.orders)) {
          this._executeLLMOrders(parsed.orders);
        }
      }

      this.lastDecision = {
        tick,
        mode: 'llm',
        model: this.model,
        response: content.slice(0, 200)
      };
      this.decisionHistory.push(this.lastDecision);

      this.engine.events.emit('commander:decision', {
        faction: this.faction,
        decision: this.lastDecision
      });
    } catch (err) {
      // Fallback to rule-based on LLM failure
      console.warn(`[LLMCommander] LLM call failed for ${this.faction}, falling back:`, err.message);
      this._ruleBasedDecision(sit, tick);
    } finally {
      this.pendingLLMCall = false;
    }
  }

  _executeLLMOrders(orders) {
    for (const order of orders) {
      switch (order.type) {
        case 'move': {
          const unit = this.engine.getEntity(order.unitId);
          if (!unit || unit.faction !== this.faction) break;
          const domain = unit.domain === 'sea' ? 'naval' : unit.domain;
          this.engine.events.emit(`order:${domain}:move`, { entityId: order.unitId, x: order.x, y: order.y });
          break;
        }
        case 'attack': {
          const unit = this.engine.getEntity(order.unitId);
          if (!unit || unit.faction !== this.faction) break;
          const domain = unit.domain === 'sea' ? 'naval' : unit.domain;
          this.engine.events.emit(`order:${domain}:attack`, { entityId: order.unitId, targetId: order.targetId });
          break;
        }
        case 'nuclear':
          this.engine.events.emit('order:nuclear:launch', {
            faction: this.faction,
            warheadType: order.warheadType || 'tactical',
            targetX: order.x,
            targetY: order.y
          });
          break;
        case 'defcon':
          this.engine.events.emit('order:nuclear:set_defcon', {
            faction: this.faction,
            level: order.defconLevel || 3
          });
          break;
      }
    }
  }
}
