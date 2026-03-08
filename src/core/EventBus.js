/**
 * EventBus - Central pub/sub event system for the simulation.
 * All modules communicate through events for loose coupling.
 */
export default class EventBus {
  constructor() {
    this.listeners = new Map();
    this.history = [];
    this.maxHistory = 5000;
  }

  on(event, callback, context = null) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push({ callback, context });
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const list = this.listeners.get(event);
    const idx = list.findIndex(l => l.callback === callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit(event, data = {}) {
    const entry = {
      event,
      data,
      timestamp: Date.now(),
      tick: data._tick || 0
    };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    if (!this.listeners.has(event)) return;
    for (const { callback, context } of this.listeners.get(event)) {
      try {
        callback.call(context, data);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    }
  }

  getHistory(filter = null, limit = 100) {
    let h = this.history;
    if (filter) {
      h = h.filter(e => e.event.includes(filter));
    }
    return h.slice(-limit);
  }

  clear() {
    this.listeners.clear();
    this.history = [];
  }
}
