const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ParticipantTracker, ExposureInput, lightingMode, correctPixels } = require('../motion-input.js');
const { MotionFlow } = require('../motion-gestures.js');

const point = (x, y) => ({ x, y, visibility: 1, presence: 1 });
function person({ x = .5, y = .37, span = .24, noseDx = 0, raised = false } = {}) {
  const p = Array(33).fill(null);
  p[0] = point(x + noseDx, y - span * .56);
  for (const [direction, shoulder, elbow, wrist] of [[1, 11, 13, 15], [-1, 12, 14, 16]]) {
    p[shoulder] = point(x + direction * span / 2, y);
    p[elbow] = point(x + direction * span * .75, y + span * (raised ? -.43 : .6));
    p[wrist] = point(x + direction * span * .88, y + span * (raised ? -.90 : 1.1));
  }
  return p;
}

test('foreground selection prefers the largest centered credible torso regardless of SDK order and hand motion', () => {
  const main = person({ x: .54, span: .29 }), other = person({ span: .13, raised: true });
  const profile = person({ x: .50, span: .38, noseDx: .25 });
  const edge = person({ x: .22, span: .38 });
  for (const frames of [[other, main], [main, other], [profile, main], [edge, main]]) {
    const tracker = new ParticipantTracker();
    assert.equal(tracker.select(frames, 0, 4 / 3, 'presence').points, main);
  }
});

test('a nearer arrival before lock starts its own 1 s dwell, and the pose takes a separate 1 s', () => {
  const tracker = new ParticipantTracker(), flow = new MotionFlow();
  const background = person({ span: .12 }), foreground = person({ span: .27, raised: true });
  function frame(poses, time) {
    const oldMode = flow.mode;
    const { points, changed } = tracker.select(poses, time, 1, oldMode);
    if (changed) flow.reset();
    const result = flow.update(points, time);
    if (oldMode === 'presence' && result.mode !== 'presence') tracker.lock();
    return result;
  }
  for (let t = 0; t < 800; t += 100) frame([background], t);
  assert.equal(frame([background, foreground], 800).progress, 0);
  for (let t = 900; t < 1800; t += 100) assert.equal(frame([foreground, background], t).mode, 'presence');
  assert.equal(frame([background, foreground], 1800).mode, 'pose');
  for (let t = 1900; t < 2800; t += 100) assert.equal(frame([foreground, background], t).mode, 'pose');
  const result = frame([background, foreground], 2800);
  assert.equal(result.mode, 'circle');
  assert.equal(result.matched, false);
});

test('locked round uses continuity rather than a new largest body and rejects a known bystander alone', () => {
  const tracker = new ParticipantTracker();
  const participant = person({ span: .24 });
  const other = person({ x: .56, span: .27, raised: true });
  assert.equal(tracker.select([participant], 0, 1, 'presence').points, participant);
  tracker.lock();
  assert.equal(tracker.select([other, participant], 100, 1, 'pose').points, participant);
  for (const time of [200, 300, 400]) {
    assert.equal(tracker.select([other], time, 1, 'pose').points, null);
  }
  const far = person({ x: .50, span: .12, raised: true });
  assert.equal(tracker.select([other], 1900, 1, 'circle').points, null);
  assert.equal(tracker.select([far], 2000, 1, 'circle').points, null);
  assert.equal(tracker.select([participant, far], 2100, 1, 'circle').points, null);
  assert.equal(tracker.select([far, participant], 2200, 1, 'circle').points, participant);
  tracker.reset();
  assert.equal(tracker.select([far], 2300, 1, 'presence').points, far);
});

test('similar overlapping poses pause rather than choosing the first detection, including during acquisition', () => {
  const tracker = new ParticipantTracker();
  const a = person({ x: .5 }), b = person({ x: .518 });
  assert.equal(tracker.select([b, a], 0, 1, 'presence').points, null);
  assert.equal(tracker.select([a], 100, 1, 'presence').points, a);
  tracker.lock();
  assert.equal(tracker.select([b, a], 200, 1, 'pose').points, null);
  assert.equal(tracker.select([a, b], 300, 1, 'pose').points, null);
  assert.equal(tracker.select([], 400, 1, 'pose').points, null);
  assert.equal(tracker.select([a], 500, 1, 'pose').points, null);
  assert.equal(tracker.select([a], 600, 1, 'pose').points, a);
});

test('brief partial-body continuity is supported only during the crank and after full participant lock', () => {
  const tracker = new ParticipantTracker(), a = person(), partial = a.slice();
  partial[12] = null;
  assert.equal(tracker.select([partial], 0, 1, 'presence').points, null);
  tracker.select([a], 100, 1, 'presence'); tracker.lock();
  assert.equal(tracker.select([partial], 200, 1, 'circle').points, partial);
  assert.equal(tracker.select([partial], 600, 1, 'circle').points, null);
});

function pixels(width, height, fn) {
  return Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : fn((i >> 2) % width, Math.floor((i >> 2) / width)));
}
const backlit = (x, y, width, height) => x > width * .22 && x < width * .78 && y < height * .72 ? 47 : 247;
test('exposure classifier ignores ordinary frames and lifts shadows or compresses bright values as needed', () => {
  const width = 64, height = 48;
  const normal = pixels(width, height, (x, y) => 75 + (x * y) % 108);
  const high = pixels(width, height, () => 243);
  const window = pixels(width, height, (x,y) => backlit(x,y,width,height));
  assert.equal(lightingMode(normal, width, height), 'original');
  assert.equal(lightingMode(high, width, height), 'bright');
  assert.equal(lightingMode(window, width, height), 'backlit');
  const original = normal.slice(); correctPixels(normal, 'original');
  assert.deepEqual(normal, original);
  correctPixels(window, 'backlit');
  assert.ok(window[4 * (10 * width + 32)] > 70);
  assert.ok(window[0] < 247);
  assert.equal(window[3], 255);
  correctPixels(high, 'bright');
  assert.ok(high[0] < 243);
  assert.ok(high[0] > 210);
});

test('adaptation limits buffer size, uses video probes and releases or falls back without another inference', () => {
  const calls = [], buffers = [];
  const input = new ExposureInput(() => {
    const canvas = { width: 0, height: 0 };
    buffers.push(canvas);
    canvas.getContext = () => ({
      drawImage() {},
      getImageData(x, y, width, height) { return { data: pixels(width, height, (xx, yy) => backlit(xx,yy,width,height)) }; },
      putImageData({ data }) { calls.push(data[0]); },
    });
    return canvas;
  });
  const video = { videoWidth: 1920, videoHeight: 1080 };
  const tuned = input.source(video, 0, false);
  assert.notEqual(tuned, video);
  assert.equal(tuned.width, video.videoWidth);
  assert.equal(tuned.height, video.videoHeight);
  assert.equal(buffers[1].width, 480);
  assert.equal(buffers[1].height, 270);
  assert.equal(input.source(video, 100, true), video);
  assert.equal(input.source(video, 200, true), tuned);
  assert.equal(input.source(video, 750, true), video);
  assert.equal(calls.length, 2);
  input.reset();
  assert.equal(tuned.width, 0);
  assert.equal(tuned.height, 0);
  const broken = new ExposureInput(() => { throw new Error('unavailable'); });
  assert.equal(broken.source(video, 0, false), video);
  assert.equal(broken.disabled, true);
});
