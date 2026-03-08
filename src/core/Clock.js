/**
 * SimClock - Manages simulation time, tick rate, and time scaling.
 */
export default class SimClock {
  constructor({ tickRate = 1000, timeScale = 1 } = {}) {
    this.tick = 0;
    this.tickRate = tickRate;       // ms between ticks
    this.timeScale = timeScale;     // multiplier for game time
    this.running = false;
    this.paused = false;
    this.startTime = null;
    this.elapsed = 0;               // total elapsed game-seconds
    this._interval = null;
    this._onTick = null;
  }

  start(onTick) {
    if (this.running) return;
    this._onTick = onTick;
    this.running = true;
    this.paused = false;
    this.startTime = Date.now();
    this._interval = setInterval(() => {
      if (this.paused) return;
      this.tick++;
      const dt = (this.tickRate / 1000) * this.timeScale;
      this.elapsed += dt;
      if (this._onTick) this._onTick(this.tick, dt, this.elapsed);
    }, this.tickRate);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  stop() {
    this.running = false;
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
  }

  setTimeScale(scale) {
    this.timeScale = Math.max(0.1, Math.min(100, scale));
  }

  getState() {
    return {
      tick: this.tick,
      elapsed: this.elapsed,
      running: this.running,
      paused: this.paused,
      timeScale: this.timeScale,
      tickRate: this.tickRate
    };
  }
}
