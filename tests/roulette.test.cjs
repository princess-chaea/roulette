const { test } = require('node:test');
const assert = require('node:assert/strict');
const { total, segments, pick, rotationFor } = require('../roulette.js');
const prizes = [{ id: 'a', quantity: 1 }, { id: 'b', quantity: 3 }, { id: 'c', quantity: 6 }];
test('remaining quantity determines exact angles and probability', () => {
  assert.equal(total(prizes), 10);
  assert.deepEqual(segments(prizes).map(p => [p.start, p.end]), [[0, 36], [36, 144], [144, 360]]);
  assert.deepEqual(segments(prizes).map(p => p.probability), [.1, .3, .6]);
});
test('selection respects cumulative weights including boundaries', () => {
  assert.equal(pick(prizes, 0).id, 'a');
  assert.equal(pick(prizes, .1).id, 'b');
  assert.equal(pick(prizes, .4).id, 'c');
  assert.equal(pick(prizes, .99999999).id, 'c');
  assert.throws(() => pick(prizes, 1), RangeError);
});
test('sold-out prizes are excluded and empty inventory cannot select', () => {
  const remaining = prizes.map(p => ({ ...p, quantity: p.id === 'b' ? 0 : p.quantity }));
  assert.deepEqual(segments(remaining).map(p => p.id), ['a', 'c']);
  assert.equal(total(remaining), 7);
  assert.equal(pick([], .2), null);
  assert.equal(segments([{ id: 'last', quantity: 1 }])[0].end, 360);
});
test('spin destination always places the selected segment under the top pointer', () => {
  for (const start of [0, 5, 359, 360, 2234]) for (const segment of segments(prizes)) {
    const end = rotationFor(segment, start);
    assert.ok(end >= start + 1800);
    assert.ok(Math.abs(((segment.midpoint + end) % 360)) < 1e-9);
  }
});
test('counterclockwise gesture preserves the winning segment and rotates backward', () => {
  for (const start of [0, 35, -720, 2234]) for (const segment of segments(prizes)) {
    const end = rotationFor(segment, start, 5, 'counterclockwise');
    assert.ok(end <= start - 1800);
    const alignment = ((segment.midpoint + end) % 360 + 360) % 360;
    assert.ok(alignment < 1e-9 || Math.abs(alignment - 360) < 1e-9);
  }
});
