import Engine from '../core/Engine.js';
import LandWarfare from '../modules/LandWarfare.js';
import NavalWarfare from '../modules/NavalWarfare.js';
import AirWarfare from '../modules/AirWarfare.js';
import NuclearWarfare from '../modules/NuclearWarfare.js';
import LLMCommander from '../commander/LLMCommander.js';

/**
 * FullSpectrumWar - Example scenario pitting two factions in a multi-domain conflict.
 * Red Alliance vs Blue Coalition across land, sea, and air.
 */
export function createFullSpectrumScenario(config = {}) {
  const engine = new Engine({
    mapWidth: config.mapWidth || 200,
    mapHeight: config.mapHeight || 150,
    tickRate: config.tickRate || 500,
    timeScale: config.timeScale || 1
  });

  // Register warfare modules
  const land = new LandWarfare();
  const naval = new NavalWarfare();
  const air = new AirWarfare();
  const nuclear = new NuclearWarfare();

  engine.registerModule('land', land);
  engine.registerModule('naval', naval);
  engine.registerModule('air', air);
  engine.registerModule('nuclear', nuclear);

  // Define factions
  engine.addFaction('red', {
    name: 'Red Alliance',
    color: '#dc2626',
    relations: { blue: 'hostile' },
    resources: { funds: 15000, fuel: 8000, ammo: 12000 }
  });

  engine.addFaction('blue', {
    name: 'Blue Coalition',
    color: '#2563eb',
    relations: { red: 'hostile' },
    resources: { funds: 15000, fuel: 8000, ammo: 12000 }
  });

  // Register AI commanders
  const redCommander = new LLMCommander({
    personality: 'aggressive',
    useLLM: config.useLLM || false
  });
  const blueCommander = new LLMCommander({
    personality: 'balanced',
    useLLM: config.useLLM || false
  });

  engine.registerCommander('red', redCommander);
  engine.registerCommander('blue', blueCommander);

  // Spawn Red Alliance forces (west side of map)
  const redBaseX = 30, redBaseY = 75;

  // Land forces
  land.spawnUnit('armor', 'red', redBaseX + 5, redBaseY - 10, 'Red 1st Armored Div');
  land.spawnUnit('armor', 'red', redBaseX + 8, redBaseY + 5, 'Red 2nd Armored Div');
  land.spawnUnit('infantry', 'red', redBaseX + 2, redBaseY - 5, 'Red 101st Infantry');
  land.spawnUnit('infantry', 'red', redBaseX + 3, redBaseY + 8, 'Red 102nd Infantry');
  land.spawnUnit('infantry', 'red', redBaseX, redBaseY, 'Red 103rd Infantry');
  land.spawnUnit('artillery', 'red', redBaseX - 5, redBaseY, 'Red Artillery Group Alpha');
  land.spawnUnit('artillery', 'red', redBaseX - 3, redBaseY + 12, 'Red Artillery Group Bravo');
  land.spawnUnit('sam', 'red', redBaseX - 2, redBaseY - 8, 'Red SAM Battery 1');
  land.spawnUnit('sam', 'red', redBaseX + 1, redBaseY + 15, 'Red SAM Battery 2');
  land.spawnUnit('recon', 'red', redBaseX + 15, redBaseY - 3, 'Red Recon Team Alpha');
  land.spawnUnit('mlrs', 'red', redBaseX - 4, redBaseY + 5, 'Red MLRS Platoon');

  // Naval forces (west coast)
  naval.spawnUnit('carrier', 'red', 10, 30, 'RAS Volkov');
  naval.spawnUnit('destroyer', 'red', 15, 25, 'RAS Stormfront');
  naval.spawnUnit('destroyer', 'red', 12, 35, 'RAS Ironclad');
  naval.spawnUnit('cruiser', 'red', 8, 28, 'RAS Thunderbolt');
  naval.spawnUnit('submarine', 'red', 20, 20, 'RAS Silent Hunter');
  naval.spawnUnit('submarine', 'red', 18, 40, 'RAS Shadow');
  naval.spawnUnit('amphibious', 'red', 12, 32, 'RAS Beachhead');

  // Air forces
  air.spawnUnit('fighter', 'red', redBaseX, redBaseY - 15, 'Red Falcon Squadron');
  air.spawnUnit('fighter', 'red', redBaseX + 5, redBaseY + 18, 'Red Hawk Squadron');
  air.spawnUnit('bomber', 'red', redBaseX - 10, redBaseY, 'Red Bear Bomber Wing');
  air.spawnUnit('helicopter', 'red', redBaseX + 10, redBaseY - 5, 'Red Viper Rotary');
  air.spawnUnit('drone', 'red', redBaseX + 20, redBaseY, 'Red Eye Drone');
  air.spawnUnit('awacs', 'red', redBaseX - 15, redBaseY, 'Red Overwatch AWACS');

  // Spawn Blue Coalition forces (east side of map)
  const blueBaseX = 170, blueBaseY = 75;

  // Land forces
  land.spawnUnit('armor', 'blue', blueBaseX - 5, blueBaseY - 8, 'Blue 1st Armor Brigade');
  land.spawnUnit('armor', 'blue', blueBaseX - 8, blueBaseY + 6, 'Blue 2nd Armor Brigade');
  land.spawnUnit('infantry', 'blue', blueBaseX - 2, blueBaseY - 3, 'Blue 1st Marines');
  land.spawnUnit('infantry', 'blue', blueBaseX - 3, blueBaseY + 10, 'Blue 2nd Marines');
  land.spawnUnit('infantry', 'blue', blueBaseX, blueBaseY, 'Blue 3rd Marines');
  land.spawnUnit('infantry', 'blue', blueBaseX - 6, blueBaseY - 12, 'Blue 4th Rangers');
  land.spawnUnit('artillery', 'blue', blueBaseX + 5, blueBaseY, 'Blue Artillery Group 1');
  land.spawnUnit('artillery', 'blue', blueBaseX + 3, blueBaseY - 10, 'Blue Artillery Group 2');
  land.spawnUnit('sam', 'blue', blueBaseX + 2, blueBaseY + 8, 'Blue Patriot Battery 1');
  land.spawnUnit('sam', 'blue', blueBaseX - 1, blueBaseY - 15, 'Blue Patriot Battery 2');
  land.spawnUnit('recon', 'blue', blueBaseX - 15, blueBaseY + 2, 'Blue Delta Recon');
  land.spawnUnit('mlrs', 'blue', blueBaseX + 4, blueBaseY + 5, 'Blue HIMARS Unit');

  // Naval forces (east coast)
  naval.spawnUnit('carrier', 'blue', 190, 120, 'BCS Enterprise');
  naval.spawnUnit('destroyer', 'blue', 185, 115, 'BCS Resolute');
  naval.spawnUnit('destroyer', 'blue', 188, 125, 'BCS Vigilant');
  naval.spawnUnit('cruiser', 'blue', 192, 118, 'BCS Aegis Prime');
  naval.spawnUnit('submarine', 'blue', 180, 110, 'BCS Silent Service');
  naval.spawnUnit('submarine', 'blue', 182, 130, 'BCS Deep Blue');
  naval.spawnUnit('patrol', 'blue', 186, 122, 'BCS Swift');
  naval.spawnUnit('missile_sub', 'blue', 195, 105, 'BCS Trident');

  // Air forces
  air.spawnUnit('fighter', 'blue', blueBaseX, blueBaseY - 12, 'Blue Eagle Squadron');
  air.spawnUnit('fighter', 'blue', blueBaseX - 5, blueBaseY + 15, 'Blue Raptor Squadron');
  air.spawnUnit('bomber', 'blue', blueBaseX + 10, blueBaseY, 'Blue Spirit Bomber Wing');
  air.spawnUnit('stealth_bomber', 'blue', blueBaseX + 12, blueBaseY - 5, 'Blue Nighthawk');
  air.spawnUnit('helicopter', 'blue', blueBaseX - 10, blueBaseY + 5, 'Blue Apache Flight');
  air.spawnUnit('drone', 'blue', blueBaseX - 20, blueBaseY, 'Blue Reaper Drone');
  air.spawnUnit('drone', 'blue', blueBaseX - 18, blueBaseY + 10, 'Blue Predator Drone');
  air.spawnUnit('awacs', 'blue', blueBaseX + 15, blueBaseY, 'Blue Sentry AWACS');

  return { engine, land, naval, air, nuclear, redCommander, blueCommander };
}

// Allow running as standalone
if (process.argv[1] && process.argv[1].includes('FullSpectrumWar')) {
  console.log('=== FULL SPECTRUM WAR SIMULATION ===\n');

  const { engine } = createFullSpectrumScenario({ tickRate: 200, timeScale: 2 });

  let lastLog = 0;
  engine.events.on('sim:tick', (data) => {
    if (data.tick % 20 === 0) {
      const red = engine.getEntitiesByFaction('red').length;
      const blue = engine.getEntitiesByFaction('blue').length;
      console.log(`[Tick ${data.tick}] Red: ${red} units | Blue: ${blue} units | Engagements: ${engine.stats.combatEngagements}`);
    }
  });

  engine.events.on('combat:kill', (data) => {
    console.log(`  ⚔ ${data.killer?.name || 'Unknown'} destroyed ${data.victim.name}`);
  });

  engine.events.on('nuclear:launch', (data) => {
    console.log(`  ☢ NUCLEAR LAUNCH by ${data.faction}: ${data.missile.warheadType} targeting (${data.missile.targetX},${data.missile.targetY})`);
  });

  engine.events.on('nuclear:impact', (data) => {
    console.log(`  💥 NUCLEAR IMPACT at (${data.x},${data.y}) - ${data.entitiesKilled} killed, ${data.entitiesHit} hit`);
  });

  engine.start();

  // Stop after 600 ticks
  setTimeout(() => {
    engine.stop();
    const red = engine.getEntitiesByFaction('red').length;
    const blue = engine.getEntitiesByFaction('blue').length;
    console.log('\n=== SIMULATION ENDED ===');
    console.log(`Red Alliance remaining: ${red}`);
    console.log(`Blue Coalition remaining: ${blue}`);
    console.log(`Total destroyed: ${engine.stats.totalDestroyed}`);
    console.log(`Nuclear strikes: ${engine.stats.nuclearStrikes}`);
    console.log(red > blue ? 'WINNER: Red Alliance' : blue > red ? 'WINNER: Blue Coalition' : 'DRAW');
    process.exit(0);
  }, 60000);
}
