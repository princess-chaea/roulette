const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');

const source = readFileSync(resolve(__dirname, '../motion-camera.js'), 'utf8');
const flush = () => new Promise(done => setImmediate(done));

function deferred() {
  let resolvePromise, rejectPromise;
  const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function stream() {
  const track = new EventTarget();
  track.stops = 0;
  track.stop = () => { track.stops++; };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

function engine(fail = false) {
  return {
    inferences: 0, closes: 0,
    detectForVideo() {
      this.inferences++;
      if (fail || this.closes) throw new Error('model inference failed');
      return { landmarks: [] };
    },
    close() { this.closes++; }
  };
}

function rig(getUserMedia, createEngine) {
  const frames = new Map();
  let nextId = 0, now = 100;
  const video = {
    readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480, srcObject: null, paused: true,
    async play() { this.paused = false; }, pause() { this.paused = true; }
  };
  class FakeDetector {
    reset() {} setMode() {} update() { return { mode: 'presence', matched: false, progress: 0 }; }
  }
  const sandbox = {
    URL, location: { protocol: 'http:' }, document: { baseURI: 'http://localhost/' }, isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia } }, performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    MotionGestures: { GestureDetector: FakeDetector, MotionFlow: FakeDetector }
  };
  runInNewContext(source, sandbox, { filename: 'motion-camera.js' });
  const phases = [];
  const camera = new sandbox.MotionCamera({
    video, canvas: { getContext: () => ({ clearRect() {}, setLineDash() {}, strokeRect() {} }) },
    onState: state => phases.push(state.phase), onResult() {}, canRecognize: () => true
  });
  camera.createEngine = createEngine;
  function nextFrame() {
    assert.equal(frames.size, 1, 'one loop should be waiting for the next video frame');
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    now += 120; video.currentTime += 0.12;
    callback();
  }
  return { camera, nextFrame, video, frames, phases };
}

test('canceling a permission request releases a late stream without attaching it or loading a model', async () => {
  const permission = deferred();
  const granted = stream();
  let loads = 0;
  const { camera, video, frames, phases } = rig(() => permission.promise, async () => { loads++; return engine(); });
  const connecting = camera.start();
  assert.equal(camera.connecting, true);
  camera.stop();
  permission.resolve(granted);
  await connecting;
  assert.equal(granted.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(loads, 0);
  assert.equal(frames.size, 0);
  assert.deepEqual(phases, ['connecting', 'stopped']);
});

for (const finish of ['resolve', 'reject']) {
  test(`a disposed model load that later ${finish}s cannot replace the new ready model or its cached promise`, async () => {
    const firstLoad = deferred();
    const old = engine(), fresh = engine();
    const firstStream = stream(), nextStream = stream();
    const streams = [firstStream, nextStream];
    let loads = 0;
    const { camera, video, nextFrame } = rig(async () => streams.shift(), () => {
      return ++loads === 1 ? firstLoad.promise : Promise.resolve(fresh);
    });
    const starting = camera.start();
    await flush();
    assert.equal(loads, 1);
    camera.dispose();
    assert.equal(firstStream.track.stops, 1);
    await camera.start();
    const currentPromise = camera.enginePromise;
    if (finish === 'resolve') firstLoad.resolve(old);
    else firstLoad.reject(new Error('previous load failed'));
    await starting;
    await flush();
    assert.equal(camera.running, true);
    assert.equal(video.srcObject, nextStream);
    assert.equal(camera.enginePromise, currentPromise);
    assert.equal(fresh.closes, 0);
    if (finish === 'resolve') assert.equal(old.closes, 1);
    camera.setActive(true);
    nextFrame();
    assert.equal(fresh.inferences, 1);
    assert.equal(old.inferences, 0);
    camera.dispose();
  });
}

test('stop cancels frame work, disarms recognition and detaches the camera track', async () => {
  const granted = stream(), model = engine();
  const { camera, video, frames, nextFrame } = rig(async () => granted, async () => model);
  await camera.start();
  camera.setActive(true);
  nextFrame();
  assert.equal(model.inferences, 1);
  camera.stop();
  assert.equal(camera.phase, 'stopped');
  assert.equal(camera.active, false);
  assert.equal(granted.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(video.paused, true);
  assert.equal(frames.size, 0);
});

test('a failed inference closes the bad model and reconnecting creates a working replacement', async () => {
  const bad = engine(true), good = engine();
  const first = stream(), second = stream();
  const models = [bad, good], streams = [first, second];
  const { camera, video, frames, nextFrame } = rig(async () => streams.shift(), async () => models.shift());
  await camera.start();
  camera.setActive(true);
  nextFrame();
  assert.equal(camera.phase, 'error');
  assert.equal(bad.inferences, 1);
  assert.equal(bad.closes, 1);
  assert.equal(first.track.stops, 1);
  assert.equal(video.srcObject, null);
  assert.equal(frames.size, 0);
  await camera.start();
  assert.equal(camera.running, true);
  assert.equal(camera.active, false);
  assert.equal(video.srcObject, second);
  camera.setActive(true);
  nextFrame();
  assert.equal(good.inferences, 1);
  assert.equal(camera.running, true);
  camera.dispose();
});
