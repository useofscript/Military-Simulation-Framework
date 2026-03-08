/**
 * Terrain - Procedural terrain/map system with multiple layers.
 * Generates a grid-based map with elevation, biome, water, and strategic features.
 */
export default class Terrain {
  constructor(width = 200, height = 150) {
    this.width = width;
    this.height = height;
    this.elevation = [];
    this.biome = [];
    this.water = [];
    this.features = [];        // cities, bases, resources
    this.radiation = [];       // nuclear contamination layer
    this.generate();
  }

  generate() {
    // Seed-based procedural generation using multi-octave value noise
    const seed = Math.random() * 10000;
    this.elevation = this._generateNoise(seed, 6, 0.5);
    this.water = Array.from({ length: this.height }, () => new Float32Array(this.width));
    this.radiation = Array.from({ length: this.height }, () => new Float32Array(this.width));
    this.biome = Array.from({ length: this.height }, () => new Array(this.width));

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const e = this.elevation[y][x];
        this.water[y][x] = e < 0.35 ? 1 : 0;
        this.biome[y][x] = this._classifyBiome(e, x, y);
      }
    }

    this._generateFeatures();
  }

  _hash(x, y, seed) {
    let h = seed + x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h & 0x7fffffff) / 0x7fffffff;
  }

  _smoothNoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const n00 = this._hash(ix, iy, seed);
    const n10 = this._hash(ix + 1, iy, seed);
    const n01 = this._hash(ix, iy + 1, seed);
    const n11 = this._hash(ix + 1, iy + 1, seed);

    const nx0 = n00 * (1 - sx) + n10 * sx;
    const nx1 = n01 * (1 - sx) + n11 * sx;
    return nx0 * (1 - sy) + nx1 * sy;
  }

  _generateNoise(seed, octaves = 6, persistence = 0.5) {
    const grid = Array.from({ length: this.height }, () => new Float32Array(this.width));
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let amplitude = 1, frequency = 0.02, value = 0, maxVal = 0;
        for (let o = 0; o < octaves; o++) {
          value += this._smoothNoise(x * frequency, y * frequency, seed + o * 100) * amplitude;
          maxVal += amplitude;
          amplitude *= persistence;
          frequency *= 2;
        }
        grid[y][x] = value / maxVal;
      }
    }
    return grid;
  }

  _classifyBiome(elevation, x, y) {
    if (elevation < 0.3) return 'deep_water';
    if (elevation < 0.35) return 'shallow_water';
    if (elevation < 0.4) return 'beach';
    if (elevation < 0.55) return 'plains';
    if (elevation < 0.65) return 'forest';
    if (elevation < 0.75) return 'hills';
    if (elevation < 0.85) return 'mountains';
    return 'peaks';
  }

  _generateFeatures() {
    this.features = [];
    const cityNames = [
      'Port Haven', 'Iron Ridge', 'Eagle Base', 'Delta Station', 'Northpoint',
      'Redshore', 'Wolfden', 'Stormwatch', 'Fort Bastion', 'Coastal HQ',
      'Highland Camp', 'Shadow Valley', 'Sentinel Post', 'Thunder Bay', 'Mesa Outpost'
    ];
    let nameIdx = 0;

    // Place cities/bases on land
    for (let i = 0; i < 15; i++) {
      let attempts = 0;
      while (attempts < 200) {
        const x = Math.floor(Math.random() * this.width);
        const y = Math.floor(Math.random() * this.height);
        const e = this.elevation[y][x];
        if (e >= 0.38 && e <= 0.7) {
          const tooClose = this.features.some(f => {
            const dx = f.x - x, dy = f.y - y;
            return Math.sqrt(dx * dx + dy * dy) < 15;
          });
          if (!tooClose) {
            this.features.push({
              type: i < 6 ? 'city' : (i < 10 ? 'military_base' : 'resource'),
              name: cityNames[nameIdx++ % cityNames.length],
              x, y,
              faction: 'neutral',
              value: Math.floor(Math.random() * 100) + 50
            });
            break;
          }
        }
        attempts++;
      }
    }
  }

  isWater(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return true;
    return this.water[iy][ix] > 0.5;
  }

  isLand(x, y) {
    return !this.isWater(x, y);
  }

  getElevation(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return 0;
    return this.elevation[iy][ix];
  }

  getBiome(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return 'void';
    return this.biome[iy][ix];
  }

  getRadiation(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return 0;
    return this.radiation[iy][ix];
  }

  applyNuclearStrike(cx, cy, radius, intensity = 1.0) {
    for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(this.height, Math.ceil(cy + radius)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(this.width, Math.ceil(cx + radius)); x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          const falloff = 1 - (dist / radius);
          this.radiation[y][x] = Math.min(1, this.radiation[y][x] + falloff * intensity);
          // Flatten terrain at ground zero
          if (dist < radius * 0.3) {
            this.elevation[y][x] = Math.max(0.36, this.elevation[y][x] - 0.15 * falloff);
            this.biome[y][x] = 'wasteland';
          }
        }
      }
    }
  }

  serialize() {
    return {
      width: this.width,
      height: this.height,
      elevation: this.elevation.map(row => Array.from(row)),
      water: this.water.map(row => Array.from(row)),
      biome: this.biome,
      radiation: this.radiation.map(row => Array.from(row)),
      features: this.features
    };
  }
}
