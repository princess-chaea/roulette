const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GestureDetector } = require('../motion-gestures.js');

const point = (x, y) => ({ x, y, visibility: 1, presence: 1 });
function person(raised = false) {
  const points = Array(33).fill(null);
  points[0] = point(0.50, 0.25);
  points[11] = point(0.60, 0.38); points[12] = point(0.40, 0.38);
  points[13] = point(0.67, raised ? 0.25 : 0.52); points[14] = point(0.33, raised ? 0.25 : 0.52);
  points[15] = point(0.71, raised ? 0.13 : 0.70); points[16] = point(0.29, raised ? 0.13 : 0.70);
  points[23] = point(0.57, 0.70); points[24] = point(0.43, 0.70);
  return points;
}

test('two raised hands must remain visible for a full second, with one match per arming', () => {
  const detector = new GestureDetector();
  const raised = person(true);
  for (const t of [0, 110, 290, 470, 710, 910]) {
    const frame = detector.update(raised, t);
    assert.equal(frame.matched, false);
    assert.equal(frame.progress, Math.floor(t / 10));
  }
  assert.equal(detector.update(raised, 1010).matched, true);
  assert.equal(detector.update(raised, 1150).matched, false);
  detector.reset();
  assert.equal(detector.update(raised, 1200).progress, 0);
});

test('a raised pose cannot persist across a missing joint, lowered hand, or gap in video frames', () => {
  for (const breakFrame of [null, person(false), 'gap', 'unreliable hip', 'unreliable elbow', 'one wrist low', 'body jump']) {
    const detector = new GestureDetector();
    const raised = person(true);
    for (let t = 0; t <= 800; t += 100) detector.update(raised, t);
    if (breakFrame === 'gap') {
      assert.equal(detector.update(raised, 1200).progress, 0);
      continue;
    }
    let frame = breakFrame;
    if (typeof breakFrame === 'string') {
      frame = person(true);
      if (breakFrame === 'unreliable hip') frame[23].presence = 0.1;
      if (breakFrame === 'unreliable elbow') frame[14].visibility = 0.1;
      if (breakFrame === 'one wrist low') frame[15].y = 0.70;
      if (breakFrame === 'body jump') frame.forEach(p => { if (p) p.x += 0.20; });
    }
    assert.equal(detector.update(frame, 900).progress, 0);
    assert.equal(detector.update(raised, 1000).matched, false);
  }
});

test('tracking loss clears prior evidence even at the same timestamp as a previous frame', () => {
  const detector = new GestureDetector();
  for (let t = 0; t <= 900; t += 100) detector.update(person(true), t);
  assert.equal(detector.update(null, 900).progress, 0);
  assert.equal(detector.update(person(true), 1000).progress, 0);
});

// Feed a single mirrored wrist path. Coordinates are normalized from a 16:9 video.
function circleSession(aspect = 16 / 9) {
  const detector = new GestureDetector();
  detector.setMode('circle');
  const target = detector.update(person(), 0, aspect).target;
  let time = 0;
  function sample(angle, radius = 1, wristIndex = 15, dt = 65) {
    time += dt;
    const points = person();
    const x = target.x + target.radius * radius * Math.cos(angle);
    const y = target.y + target.radiusY * radius * Math.sin(angle);
    points[wristIndex] = point(1 - x, y);
    return detector.update(points, time, aspect);
  }
  function hold() {
    for (let i = 0; i < 6; i++) sample(0);
  }
  return { detector, sample, hold, target };
}

test('a held start point and half-circle match in either direction of the mirrored preview', () => {
  for (const sign of [1, -1]) {
    const { hold, sample, target } = circleSession();
    assert.ok(Math.abs(target.radiusY - target.radius * 16 / 9) < 1e-9);
    hold();
    let result;
    for (let i = 1; i <= 12; i++) {
      result = sample(sign * i * Math.PI / 12, 1, 15, i % 2 === 0 ? 50 : 105);
      assert.equal(result.direction, sign === 1 ? 'clockwise' : 'counterclockwise');
      if (i < 12) assert.equal(result.matched, false);
    }
    assert.equal(result.matched, true);
    assert.equal(result.progress, 100);
    assert.equal(result.direction, sign === 1 ? 'clockwise' : 'counterclockwise');
    assert.ok(result.speed > 0 && Number.isFinite(result.speed));
    assert.equal(sample(sign * Math.PI).matched, false);
  }
});

test('a fast start without the initial hold cannot trigger', () => {
  const { sample } = circleSession();
  for (let i = 0; i <= 12; i++) assert.equal(sample(i * Math.PI / 12).matched, false);
});

test('wrist jitter and a diameter crossing cannot complete the arc', () => {
  const { sample, hold } = circleSession();
  hold();
  for (let i = 0; i < 100; i++) assert.equal(sample(i % 2 === 0 ? 0.1 : -0.1).matched, false);
  for (const x of [0.8, 0.6, 0.4, 0, -0.4, -0.6, -0.8, -1]) {
    assert.equal(sample(0, x).matched, false);
  }
});

test('a partial arc cannot be completed after switching wrists, reversing, teleporting, or dropping frames', () => {
  for (const interruption of ['switch', 'reverse', 'jump', 'delay']) {
    const { sample, hold } = circleSession();
    hold();
    for (let i = 1; i <= 6; i++) sample(i * Math.PI / 12);
    if (interruption === 'reverse') sample(Math.PI / 2 - 0.45);
    if (interruption === 'jump') sample(Math.PI);
    if (interruption === 'delay') sample(Math.PI / 2, 1, 15, 500);
    const wrist = interruption === 'switch' ? 16 : 15;
    for (let i = 7; i <= 12; i++) assert.equal(sample(i * Math.PI / 12, 1, wrist).matched, false);
  }
});

test('mode switch clears gesture progress', () => {
  const detector = new GestureDetector();
  for (let t = 0; t <= 700; t += 100) detector.update(person(true), t);
  detector.setMode('circle');
  assert.equal(detector.update(person(true), 800).progress, 0);
  detector.setMode('pose');
  assert.equal(detector.update(person(true), 900).progress, 0);
});
