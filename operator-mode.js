/* One-use operator selection, separate from ordinary weighted selection. */
(() => {
  class FirstPrizeMode {
    constructor() { this.armed = false; this.count = 0; this.lastClick = -Infinity; }
    click(time, available) {
      if (this.armed) { this.reset(); return false; }
      this.count = time - this.lastClick <= 900 ? this.count + 1 : 1;
      this.lastClick = time;
      if (this.count === 5) { this.armed = !!available; this.count = 0; }
      return this.armed;
    }
    reset() { this.armed = false; this.count = 0; this.lastClick = -Infinity; }
    take(segments) {
      if (!this.armed) return null;
      this.reset();
      return segments.find(prize => prize.rank === 1 && prize.quantity > 0) || null;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = FirstPrizeMode;
  else globalThis.FirstPrizeMode = FirstPrizeMode;
})();
