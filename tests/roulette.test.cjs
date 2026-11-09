const { test } = require('node:test');
const assert = require('node:assert/strict');
const { total, segments, visualSegments, pick, rotationFor, finishPlan, animationFrames } = require('../roulette.js');
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
test('finish reaches the entering boundary then alternates around it without another revolution', () => {
  for (const direction of ['clockwise', 'counterclockwise']) for (const prize of segments(prizes)) {
    const plan = finishPlan(prizes, prize, 0, direction);
    const sign = direction === 'clockwise' ? 1 : -1;
    assert.equal(plan.frames[0], plan.boundary);
    assert.equal(plan.frames.at(-1), plan.target);
    assert.ok(plan.landingAngle > prize.start && plan.landingAngle < prize.end);
    assert.ok((plan.frames[1] - plan.boundary) * sign > 0);
    assert.ok((plan.frames[2] - plan.boundary) * sign < 0);
    assert.ok(Math.max(...plan.frames) - Math.min(...plan.frames) <= 9);
    const pointer = ((-plan.target % 360) + 360) % 360;
    assert.ok(Math.abs(pointer - plan.landingAngle) < 1e-8);
  }
});
test('only one remaining gift has no fabricated boundary oscillation', () => {
  const single = [{id:'last',quantity:1}];
  const plan = finishPlan(single, segments(single)[0]);
  assert.equal(plan.amplitude,0);
  assert.deepEqual(plan.frames,[plan.target,plan.target]);
});


test('the approach crosses the boundary at the same nonzero velocity as the first sway', () => {
  for (const direction of ['clockwise','counterclockwise']) for (const prize of segments(prizes)) {
    const plan = finishPlan(prizes, prize, 0, direction);
    const keys = animationFrames(0, plan);
    const y2 = Number(keys[0].easing.slice(13,-1).split(',')[3]);
    const incoming = (plan.boundary / 4100) * (1-y2) / .7;
    const outgoing = 3 * (keys[2].angle-keys[1].angle) / 480;
    assert.ok(Math.abs(incoming)>0, 'The boundary must not become a stop');
    assert.ok(Math.abs(incoming-outgoing)<1e-10, 'Velocity must be continuous through the boundary');
    assert.equal(keys[1].easing,'cubic-bezier(0.3333333333333333,1,0.6666666666666666,1)');
    assert.equal(keys.at(-1).angle,plan.target);
    assert.equal(keys.at(-1).offset,1);
  }
});

test('the split layout interleaves half-width copies and preserves each prize’s total area and odds', () => {
  const inventory = [...prizes, { id: 'sold-out', quantity: 0 }].map(p => Object.freeze({ ...p }));
  const split = visualSegments(inventory, 'split');
  assert.deepEqual(split.map(s => s.id), ['a','b','c','a','b','c']);
  assert.equal(new Set(split.map(s => s.sliceKey)).size, 6);
  assert.deepEqual(split.map(s => s.sliceKey), visualSegments(inventory, 'split').map(s => s.sliceKey));
  for (const prize of segments(inventory)) {
    const copies = split.filter(s => s.id === prize.id);
    assert.equal(copies.length, 2);
    for (const copy of copies) {
      assert.equal(copy.end - copy.start, (prize.end - prize.start) / 2);
      assert.equal(copy.probability, prize.probability / 2);
      assert.equal(copy.quantity, prize.quantity);
    }
  }
  assert.equal(split.at(-1).end, 360);
  assert.equal(total(inventory), 10);
  assert.deepEqual(visualSegments([], 'split'), []);
});

test('each split copy has its own landing, neighboring boundary and continuous first sway in either direction', () => {
  const inventory = [{ id: 'small', quantity: 1 }, { id: 'large', quantity: 99 }];
  const slices = visualSegments(inventory, 'split');
  for (const direction of ['clockwise','counterclockwise']) for (const slice of slices) {
    const plan = finishPlan(inventory, { id: slice.id, sliceKey: slice.sliceKey }, 0, direction, 'split');
    assert.ok(plan.landingAngle > slice.start && plan.landingAngle < slice.end);
    const pointer = ((-plan.target % 360) + 360) % 360;
    assert.ok(Math.abs(pointer - plan.landingAngle) < 1e-8);
    const edge = direction === 'clockwise' ? slice.end : slice.start;
    const boundaryPointer = ((-plan.boundary % 360) + 360) % 360;
    assert.ok(Math.abs((boundaryPointer - edge + 540) % 360 - 180) < 1e-8);
    assert.ok(Math.abs(plan.amplitude - 1.8 * .28) < 1e-8);
    const keys = animationFrames(0, plan);
    const y2 = Number(keys[0].easing.slice(13,-1).split(',')[3]);
    const incoming = plan.boundary / 4100 * (1-y2) / .7;
    const outgoing = 3 * (keys[2].angle - keys[1].angle) / 480;
    assert.ok(Math.abs(incoming) > 0 && Math.abs(incoming-outgoing) < 1e-10);
  }
});

test('a single available prize occupies one circle in either layout', () => {
  const inventory = [{ id: 'empty', quantity: 0 }, { id: 'last', quantity: 4 }];
  const grouped = visualSegments(inventory);
  assert.deepEqual(visualSegments(inventory, 'split'), grouped);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].end - grouped[0].start, 360);
  assert.equal(finishPlan(inventory, grouped[0], 0, 'clockwise', 'split').amplitude, 0);
});
