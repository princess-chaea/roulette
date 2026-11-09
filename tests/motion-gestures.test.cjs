const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GestureDetector, MotionFlow, POSE_KINDS } = require('../motion-gestures.js');

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
  for (const breakFrame of [null, person(false), 'gap', 'unreliable shoulder', 'unreliable elbow', 'one wrist low', 'body jump']) {
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
      if (breakFrame === 'unreliable shoulder') frame[11].presence = 0.1;
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
  function sample(angle, radius = 1, wristIndex = 15, dt = 65, modify = () => {}) {
    time += dt;
    const points = person();
    const x = target.x + target.radius * radius * Math.cos(angle);
    const y = target.y + target.radiusY * radius * Math.sin(angle);
    points[wristIndex] = point(1 - x, y);
    modify(points);
    return detector.update(points, time, aspect);
  }
  function hold() {
    for (let i = 0; i < 6; i++) sample(0);
  }
  return { detector, sample, hold, target };
}

test('the centered handle accepts a nearly complete turn in either direction of the mirrored preview', () => {
  for (const sign of [1, -1]) {
    const { hold, sample, target } = circleSession();
    assert.equal(target.x, 0.5);
    assert.equal(target.y, 0.5);
    assert.equal(target.startX, 0.5 + target.radius);
    assert.equal(target.startY, 0.5);
    assert.ok(Math.abs(target.radiusY - target.radius * 16 / 9) < 1e-9);
    hold();
    let result;
    for (let i = 1; i <= 20; i++) {
      result = sample(sign * i * Math.PI / 12, 1, 15, i % 2 === 0 ? 50 : 105);
      assert.equal(result.direction, sign === 1 ? 'clockwise' : 'counterclockwise');
      if (i < 20) assert.equal(result.matched, false);
    }
    assert.equal(result.matched, true);
    assert.equal(result.progress, 100);
    assert.equal(result.direction, sign === 1 ? 'clockwise' : 'counterclockwise');
    assert.ok(result.speed > 0 && Number.isFinite(result.speed));
    assert.equal(sample(sign * Math.PI).matched, false);
  }
});

test('the handle stays visible for a distant participant and fits a wide camera', () => {
  const detector = new GestureDetector();
  detector.setMode('circle');
  const distant = person();
  distant[11].x = 0.54; distant[12].x = 0.46;
  assert.equal(detector.update(distant, 0, 4/3).target.radius, 0.13);
  detector.reset();
  assert.ok(detector.update(person(), 0, 2.5).target.radiusY <= 0.27);
});

test('a fast start without the initial hold cannot trigger', () => {
  const { sample } = circleSession();
  for (let i = 0; i <= 24; i++) assert.equal(sample(i * Math.PI / 12).matched, false);
});

test('the grip fills before locking and reports actual mirrored wrist position and signed rotation', () => {
  for (const sign of [1, -1]) {
    const { detector, sample, target } = circleSession();
    let r = sample(0);
    assert.equal(r.grip.held, false);
    assert.equal(r.grip.progress, 0);
    r = sample(0, 1, 15, 75);
    assert.equal(r.grip.progress, 0.5);
    assert.equal(r.grip.held, false);
    r = sample(0, 1, 15, 75);
    assert.equal(r.grip.held, true);
    assert.equal(r.grip.progress, 1);
    assert.equal(r.angleDeg, 0);
    for (let i = 1; i <= 3; i++) r = sample(sign * i * Math.PI / 12, 0.9);
    assert.equal(r.matched, false);
    assert.ok(Math.abs(r.angleDeg - sign * 45) < 1e-8);
    assert.ok(Math.abs(r.grip.x - (target.x + Math.SQRT1_2 * 0.9 * target.radius)) < 1e-8);
    assert.ok(Math.abs(r.grip.y - (target.y + sign * Math.SQRT1_2 * 0.9 * target.radiusY)) < 1e-8);
    r = sample(0, 0);
    assert.equal(r.grip.held, true);
    assert.ok(Math.abs(r.angleDeg - sign * 45) < 1e-8);
    r = detector.update(null, 900);
    assert.deepEqual(r.grip, { x: null, y: null, progress: 0, held: false });
    assert.equal(r.angleDeg, 0);
  }
});

test('wrist jitter and a diameter crossing cannot complete the arc', () => {
  const { sample, hold } = circleSession();
  hold();
  for (let i = 0; i < 100; i++) assert.equal(sample(i % 2 === 0 ? 0.1 : -0.1).matched, false);
  for (const x of [0.8, 0.6, 0.4, 0, -0.4, -0.6, -0.8, -1]) {
    assert.equal(sample(0, x).matched, false);
  }
});

test('partial sweeps connected through the center never add up to a turn', () => {
  const { sample, hold } = circleSession();
  hold();
  for (let repeat = 0; repeat < 14; repeat++) {
    for (const [angle, radius] of [[0, 1], [0.18, 1], [0.38, 1], [0.55, 1], [0, 0]]) {
      assert.equal(sample(angle, radius).matched, false);
    }
  }
});

test('an uneven broad circle works with one wrist, no visible elbows and a briefly hidden opposite shoulder', () => {
  const flow = new MotionFlow();
  const aspect = 16 / 9;
  let r;
  for (let t = 0; t <= 3000; t += 100) r = flow.update(upperBody(true), t, aspect);
  const target = r.target;
  function track(degrees, radius, time, hideShoulder) {
    const p = upperBody(), a = degrees * Math.PI / 180;
    p[13] = p[14] = p[16] = null;
    if (hideShoulder) p[12] = null;
    p[15] = point(1 - target.x - radius * target.radius * Math.cos(a),
      target.y + radius * target.radiusY * Math.sin(a));
    p[15].visibility = 0.46;
    return flow.update(p, time, aspect);
  }
  for (let t = 3100; t <= 3400; t += 100) r = track(0, 1, t, false);
  assert.equal(r.grip.held, true);
  const radii = [0.55, 0.85, 1.5, 1.6];
  for (let i = 0; i < 20; i++) {
    r = track(15 * (i + 1), radii[i % 4], 3470 + 70 * i, i < 4);
    assert.equal(r.mode, 'circle');
    assert.equal(r.matched, i === 19);
  }
  assert.ok(Math.abs(r.angleDeg - 300) < 1e-8);
});

test('the cached shoulder cannot bridge a different person or more than 500ms, and a lost wrist releases the grip', () => {
  for (const loss of ['expired', 'new person', 'wrist']) {
    const { sample, hold } = circleSession();
    hold();
    let r;
    for (let i = 1; i <= 8; i++) {
      r = sample(0, 1, 15, 65, p => {
        if (loss !== 'wrist') p[12] = null;
        if (loss === 'new person') p[0].x += 0.18;
        if (loss === 'wrist') p[15].visibility = 0.40;
      });
      assert.equal(r.matched, false);
      if (loss === 'new person') break;
    }
    assert.equal(r.grip.held, false);
    assert.equal(r.angleDeg, 0);
    assert.equal(sample(Math.PI / 6).grip.held, false);
  }
});

test('a partial arc cannot be completed after switching wrists, reversing, teleporting, or dropping frames', () => {
  for (const interruption of ['switch', 'reverse', 'jump', 'delay']) {
    const { sample, hold } = circleSession();
    hold();
    for (let i = 1; i <= 3; i++) sample(i * Math.PI / 12);
    if (interruption === 'reverse') sample(Math.PI / 4 - 1.4);
    if (interruption === 'jump') sample(Math.PI / 4 + Math.PI);
    if (interruption === 'delay') sample(Math.PI / 2, 1, 15, 500);
    const wrist = interruption === 'switch' ? 16 : 15;
    for (let i = 4; i <= 24; i++) assert.equal(sample(i * Math.PI / 12, 1, wrist).matched, false);
  }
});

test('a broad off-center grab and four fast samples complete a near lap after 400ms', () => {
  for (const sign of [1, -1]) {
    const { sample, target } = circleSession(4/3);
    assert.ok(Math.abs(target.radius - 0.19) < 1e-8);
    assert.ok(target.grabRadius >= target.radius * 0.7);
    for (const dt of [65, 75, 75]) {
      const held = sample(0, 1.6, 15, dt);
      assert.equal(held.matched, false);
    }
    for (let i = 1; i <= 4; i++) {
      const r = sample(sign * i * 75 * Math.PI / 180, [1.2, 0.55, 0.8, 1.4][i-1], 15, 100);
      assert.equal(r.matched, i === 4);
      assert.equal(r.grip.held, true);
    }
  }
});

test('a half turn remains pending and a small correction can continue in the original direction', () => {
  const { sample, hold } = circleSession();
  hold();
  for (const degree of [60, 120, 180, 140, 220]) {
    const r = sample(degree * Math.PI / 180, 1, 15, 100);
    assert.equal(r.matched, false);
    assert.equal(r.grip.held, true);
  }
  assert.equal(sample(300 * Math.PI / 180, 1, 15, 100).matched, true);
});

test('a brief missing wrist pauses the same grip without crediting the unseen motion', () => {
  const { sample, hold } = circleSession();
  hold();
  const before = sample(Math.PI / 3, 1, 15, 100);
  const missing = sample(0, 1, 15, 100, p => { p[15] = null; });
  assert.equal(missing.grip.held, true);
  assert.equal(missing.angleDeg, before.angleDeg);
  assert.equal(missing.progress, before.progress);
  const resumed = sample(Math.PI / 2, 1, 15, 100);
  assert.equal(resumed.angleDeg, before.angleDeg);
  assert.equal(resumed.grip.held, true);
  for (const degree of [150, 210, 270, 330]) {
    assert.equal(sample(degree * Math.PI / 180, 1, 15, 100).matched, degree === 330);
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

function upperBody(raised = false) {
  const points = person(raised);
  points[23] = null;
  points[24].visibility = 0;
  return points;
}

function starter(kind, hand = 'left') {
  const points = upperBody(kind === 'hands_up' || kind === 'arm_heart');
  if (kind === 'hands_near_shoulders') {
    points[15] = point(0.61, 0.35); points[16] = point(0.39, 0.35);
  } else if (kind === 'one_hand_up') {
    const raised = upperBody(true);
    for (const i of (hand === 'left' ? [13, 15] : [14, 16])) points[i] = raised[i];
  } else if (kind === 'arm_heart') {
    points[15] = point(0.52, 0.13); points[16] = point(0.48, 0.13);
  }
  return points;
}

test('each starter pose accepts its own one-second hold and rejects every other starter shape', () => {
  assert.deepEqual(POSE_KINDS, ['hands_up', 'hands_near_shoulders', 'one_hand_up', 'arm_heart']);
  for (const expected of POSE_KINDS) {
    for (const performed of POSE_KINDS) {
      const detector = new GestureDetector({ poseKind: expected });
      let result;
      for (let time = 0; time <= 1000; time += 100) {
        result = detector.update(starter(performed), time);
        if (time < 1000) assert.equal(result.matched, false);
      }
      assert.equal(result.matched, expected === performed, `${expected} vs ${performed}`);
    }
  }
});

test('either hand can be raised for a one-hand pose, but switching sides restarts the hold', () => {
  const detector = new GestureDetector({ poseKind: 'one_hand_up' });
  for (let t = 0; t <= 800; t += 100) detector.update(starter('one_hand_up'), t);
  for (let t = 900; t <= 1900; t += 100) {
    const result = detector.update(starter('one_hand_up', 'right'), t);
    if (t === 900) assert.equal(result.progress, 0);
    assert.equal(result.matched, t === 1900);
  }
});

test('hands near their shoulders complete a hold with both elbows outside a cropped preview', () => {
  for (const aspect of [9/16, 1, 16/9]) {
    const detector = new GestureDetector({ poseKind: 'hands_near_shoulders' });
    for (let t = 0; t <= 1000; t += 100) {
      const p = starter('hands_near_shoulders');
      p[13] = p[14] = null;
      p[15] = point(0.65, 0.38 - 0.04 * aspect);
      p[16] = point(0.37, 0.38 + 0.08 * aspect);
      p[15].visibility = 0.46;
      if (t % 200 === 0) { p[23] = point(0.57, 0.62); p[24] = point(0.43, 0.62); }
      const r = detector.update(p, t, aspect);
      assert.equal(r.progress, t / 10);
      assert.equal(r.matched, t === 1000);
    }
  }
});

test('the shoulder pose requires two visible hands near their own shoulders', () => {
  for (const change of ['wide arms', 'waist', 'crossed', 'above head', 'out of frame', 'missing wrist']) {
    const p = starter('hands_near_shoulders');
    if (change === 'wide arms') { p[15].x = 0.85; p[16].x = 0.15; }
    if (change === 'waist') p[15].y = p[16].y = 0.68;
    if (change === 'crossed') [p[15], p[16]] = [p[16], p[15]];
    if (change === 'above head') p[15].y = p[16].y = 0.22;
    if (change === 'out of frame') p[15].x = 1.1;
    if (change === 'missing wrist') p[16] = null;
    const detector = new GestureDetector({ poseKind: 'hands_near_shoulders' });
    for (let t = 0; t <= 1100; t += 100) assert.equal(detector.update(p, t, 16/9).progress, 0, change);
  }
});

test('a tilted overhead heart holds with separated wrists and unequal elbow heights as hips enter the frame', () => {
  for (const aspect of [1, 16 / 9]) {
    const detector = new GestureDetector({ poseKind: 'arm_heart' });
    for (let time = 0; time <= 1000; time += 100) {
      const p = starter('arm_heart');
      p[15] = point(0.57, 0.25 + 0.004 * aspect); p[16] = point(0.445, 0.25 - 0.05 * aspect);
      p[16].visibility = 0.48;
      p[13] = point(0.63, 0.38 + 0.03 * aspect); p[14] = point(0.39, 0.25 - 0.08 * aspect);
      if (time % 200 === 0) { p[23] = point(0.57, 0.70); p[24] = point(0.43, 0.70); }
      const result = detector.update(p, time, aspect);
      assert.equal(result.progress, time / 10);
      assert.equal(result.matched, time === 1000);
    }
  }
});

test('heart needs wide elbows and upper centered hands; a finger heart or tightly folded arms do not qualify', () => {
  for (const change of ['elbows in', 'hands beside head', 'hands in front of chest', 'elbows missing']) {
    const points = starter('arm_heart');
    if (change === 'elbows in') { points[13].x = 0.52; points[14].x = 0.48; }
    if (change === 'hands beside head') { points[15].x += 0.20; points[16].x += 0.20; }
    if (change === 'hands in front of chest') { points[15].y = 0.40; points[16].y = 0.40; }
    if (change === 'elbows missing') points[14].presence = 0.1;
    const detector = new GestureDetector({ poseKind: 'arm_heart' });
    for (let t = 0; t <= 1200; t += 100) assert.equal(detector.update(points, t).progress, 0);
  }
});

test('changing the target pose starts a fresh presence dwell and the chosen pose survives stage changes', () => {
  const flow = new MotionFlow({ poseKind: 'hands_near_shoulders' });
  for (let t = 0; t <= 2700; t += 100) flow.update(starter('hands_near_shoulders'), t);
  assert.equal(flow.mode, 'pose');
  flow.setPoseKind('arm_heart');
  for (let t = 2800; t < 4800; t += 100) assert.equal(flow.update(starter('arm_heart'), t).mode, 'presence');
  for (let t = 4800; t < 5800; t += 100) assert.equal(flow.update(starter('arm_heart'), t).mode, 'pose');
  assert.equal(flow.update(starter('arm_heart'), 5800).mode, 'circle');
  flow.reset();
  assert.equal(flow.poseKind, 'arm_heart');
  assert.throws(() => flow.setPoseKind('unknown'), RangeError);
  assert.equal(flow.poseKind, 'arm_heart');
});

test('upper-body presence and pose must each finish in order, and posing alone cannot start the wheel', () => {
  const flow = new MotionFlow();
  const raised = upperBody(true);
  for (let t = 0; t < 2000; t += 100) {
    const result = flow.update(raised, t);
    assert.equal(result.mode, 'presence');
    assert.equal(result.progress, t / 20);
    assert.equal(result.matched, false);
  }
  for (let t = 2000; t < 3000; t += 100) {
    const result = flow.update(raised, t);
    assert.equal(result.mode, 'pose');
    assert.equal(result.matched, false);
  }
  for (let t = 3000; t <= 4500; t += 100) {
    const result = flow.update(raised, t);
    assert.equal(result.mode, 'circle');
    assert.equal(result.matched, false);
  }
});

test('the full sequence recognizes an upper-body-only participant and returns one final direction', () => {
  const flow = new MotionFlow();
  const aspect = 16 / 9;
  let result;
  for (let t = 0; t <= 3000; t += 100) result = flow.update(upperBody(true), t, aspect);
  assert.equal(result.mode, 'circle');
  const { target } = result;
  const wristAt = angle => {
    const points = upperBody();
    points[15] = point(1 - (target.x + target.radius * Math.cos(angle)), target.y + target.radiusY * Math.sin(angle));
    return points;
  };
  let time = 3100;
  for (let i = 0; i < 6; i++, time += 65) {
    assert.equal(flow.update(wristAt(0), time, aspect).matched, false);
  }
  for (let i = 1; i <= 20; i++, time += 65) {
    result = flow.update(wristAt(-Math.PI * i / 12), time, aspect);
    assert.equal(result.mode, 'circle');
    assert.equal(result.matched, i === 20);
  }
  assert.equal(result.direction, 'counterclockwise');
  assert.equal(flow.update(wristAt(-Math.PI), time, aspect).matched, false);
  flow.reset();
  assert.equal(flow.update(upperBody(), time + 65, aspect).mode, 'presence');
});

test('tracking loss, another person, leaving center, a position jump, or a gap require presence again', () => {
  for (const interruption of ['missing', 'multiple', 'outside', 'jump', 'gap']) {
    const flow = new MotionFlow();
    for (let t = 0; t <= 3000; t += 100) flow.update(upperBody(true), t);
    assert.equal(flow.mode, 'circle');
    let points = upperBody(true);
    if (interruption === 'missing') points = null;
    if (interruption === 'multiple') points = [upperBody(), upperBody()];
    if (interruption === 'outside' || interruption === 'jump') {
      const shift = interruption === 'outside' ? 0.30 : 0.15;
      points.forEach(p => { if (p) p.x += shift; });
    }
    const time = interruption === 'gap' ? 3500 : 3100;
    const stopped = flow.update(points, time);
    assert.equal(stopped.mode, 'presence');
    assert.equal(stopped.progress, 0);
    assert.equal(stopped.matched, false);
    for (let t = time + 100; t <= time + 1900; t += 100) assert.equal(flow.update(upperBody(true), t).mode, 'presence');
  }
});
