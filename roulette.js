/* Shared geometry and inventory selection. No framework or runtime dependency. */
(() => {
  const available = prizes => prizes.filter(prize => Number.isSafeInteger(prize.quantity) && prize.quantity > 0);
  const total = prizes => available(prizes).reduce((sum, prize) => sum + prize.quantity, 0);
  function segments(prizes) {
    const count = total(prizes);
    let start = 0;
    return available(prizes).map(prize => {
      const end = start + prize.quantity / count * 360;
      const segment = { ...prize, start, end, midpoint: (start + end) / 2, probability: prize.quantity / count };
      start = end;
      return segment;
    });
  }
  function pick(prizes, unit) {
    if (!Number.isFinite(unit) || unit < 0 || unit >= 1) throw new RangeError('Random value must be in [0, 1).');
    const options = segments(prizes);
    return options.find(segment => unit * 360 < segment.end) || null;
  }
  function rotationFor(segment, current = 0, laps = 5, direction = 'clockwise') {
    const normalized = ((current % 360) + 360) % 360;
    const destination = (360 - segment.midpoint) % 360;
    if (direction === 'counterclockwise') return current - laps * 360 - (normalized - destination + 360) % 360;
    return current + laps * 360 + (destination - normalized + 360) % 360;
  }
  const api = { available, total, segments, pick, rotationFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.RouletteMath = api;
})();
