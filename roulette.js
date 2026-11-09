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
  function finishPlan(prizes, selected, current = 0, direction = 'clockwise') {
    const options = segments(prizes);
    const index = options.findIndex(p => p.id === selected.id);
    if (index < 0) throw new RangeError('Winning segment is unavailable.');
    const sign = direction === 'counterclockwise' ? -1 : 1;
    const neighbor = options[(index + (sign === 1 ? 1 : options.length - 1)) % options.length];
    const width = selected.end - selected.start;
    const amplitude = options.length > 1 ? Math.min(5, width * .28, (neighbor.end - neighbor.start) * .28) : 0;
    const margin = amplitude ? Math.min(1.8, amplitude * .35) : Math.min(8, width / 4);
    const landingAngle = sign === 1 ? selected.end - margin : selected.start + margin;
    const target = rotationFor({ ...selected, midpoint: landingAngle }, current, 5, direction);
    const boundary = amplitude ? target - sign * margin : target;
    const offsets = amplitude ? [0, amplitude, -amplitude * .65, amplitude * .42, -amplitude * .22, margin] : [0, 0];
    return { landingAngle, target, boundary, amplitude, frames: offsets.map(delta => boundary + sign * delta) };
  }
  const api = { available, total, segments, pick, rotationFor, finishPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.RouletteMath = api;
})();
