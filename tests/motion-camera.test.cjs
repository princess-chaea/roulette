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

function rig(getUserMedia, createEngine, useActualGestures = false) {
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
    Image: class { constructor() { this.complete = false; } },
    URL, location: { protocol: 'http:' }, document: { baseURI: 'http://localhost/', createElement: () => ({
      getContext: () => ({
        drawImage() {},
        getImageData(x,y,w,h) { return { data:new Uint8ClampedArray(w*h*4).fill(120) }; }
      })
    }) }, isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia } }, performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    MotionGestures: useActualGestures ? require('../motion-gestures.js') : { MotionFlow: FakeDetector },
    MotionInput: require('../motion-input.js')
  };
  runInNewContext(source, sandbox, { filename: 'motion-camera.js' });
  const phases = [], results = [];
  const overlay = { getContext: () => ({ clearRect() {}, setLineDash() {}, strokeRect() {} }) };
  const camera = new sandbox.MotionCamera({
    video, canvas: overlay,
    onState: state => phases.push(state.phase), onResult: result => results.push(result), canRecognize: () => true
  });
  camera.createEngine = createEngine;
  if (useActualGestures) camera.draw = () => {};
  function nextFrame() {
    assert.equal(frames.size, 1, 'one loop should be waiting for the next video frame');
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    now += 120; video.currentTime += 0.12;
    callback();
  }
  return { camera, nextFrame, video, frames, phases, results, overlay };
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
test('moving the frame clock to a camera window keeps exactly one loop and releases its frames', async () => {
  const granted = stream();
  const { camera, frames } = rig(async () => granted, async () => engine());
  await camera.start();
  const popupFrames = new Map(); let serial = 100;
  const host = {
    requestAnimationFrame(callback) { popupFrames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { popupFrames.delete(id); }
  };
  camera.setAnimationHost(host);
  assert.equal(frames.size, 0);
  assert.equal(popupFrames.size, 1);
  assert.equal(granted.track.stops, 0);
  camera.setAnimationHost();
  assert.equal(popupFrames.size, 0);
  assert.equal(frames.size, 1);
  camera.setAnimationHost(host);
  camera.stop();
  assert.equal(popupFrames.size, 0);
  assert.equal(frames.size, 0);
  assert.equal(granted.track.stops, 1);
});

function participantAt(x, raised = false, span = .20) {
  const positions = {
    0: [x, .25], 11: [x + span/2, .38], 12: [x - span/2, .38],
    13: [x + span*.68, raised ? .27 : .55], 14: [x - span*.68, raised ? .27 : .55],
    15: [x + span*.73, raised ? .13 : .67], 16: [x - span*.73, raised ? .13 : .67]
  };
  return Array.from({ length: 33 }, (_, i) => positions[i] ?
    { x: positions[i][0], y: positions[i][1], visibility: 1, presence: 1 } : null);
}

test('stepping out immediately after position confirmation automatically rearms the 1 s central check', async () => {
  let poses = [participantAt(.44)];
  const model = { detectForVideo: () => ({ landmarks: poses }), close() {} };
  const { camera, nextFrame, results } = rig(async () => stream(), async () => model, true);
  await camera.start();
  camera.setActive(true);
  for (let i = 0; i < 10; i++) nextFrame();
  assert.equal(results.at(-1).mode, 'pose');
  assert.equal(results.at(-1).progress, 0);
  poses = [];
  nextFrame();
  poses = [participantAt(.61)];
  nextFrame(); nextFrame();
  assert.equal(results.at(-1).mode, 'presence');
  assert.equal(results.at(-1).progress, 0);
  for (let i = 0; i < 8; i++) nextFrame();
  assert.equal(results.at(-1).mode, 'presence');
  nextFrame();
  assert.equal(results.at(-1).mode, 'pose');
  camera.dispose();
});

test('once a starter has progress, standing aside with a bystander never rearms or advances it', async () => {
  const participant = participantAt(.5, true), bystander = participantAt(.64, true, .15);
  let poses = [participant, bystander];
  const model = { detectForVideo: () => ({ landmarks: poses }), close() {} };
  const { camera, nextFrame, results } = rig(async () => stream(), async () => model, true);
  await camera.start(); camera.setActive(true);
  for (let i = 0; i < 14; i++) nextFrame();
  assert.equal(results.at(-1).mode, 'pose');
  const progress = results.at(-1).progress;
  assert.ok(progress > 0);
  poses = [bystander];
  for (let i = 0; i < 12; i++) {
    nextFrame();
    assert.equal(results.at(-1).mode, 'pose');
    assert.equal(results.at(-1).progress, progress);
  }
  poses = [participant, bystander];
  nextFrame(); nextFrame(); nextFrame();
  assert.ok(results.at(-1).progress > progress);
  camera.dispose();
});


test('Full HD capture is a preference; model and tracking stay at a smaller matching aspect ratio', async () => {
  const granted = stream(), requests = [], modelInputs = [];
  const { camera, video, nextFrame, overlay } = rig(async request => {
    requests.push(request);
    return granted;
  }, async () => ({ detectForVideo(source) { modelInputs.push(source); return { landmarks:[] }; }, close() {} }));
  video.videoWidth = 1920; video.videoHeight = 1080;
  await camera.start();
  camera.setActive(true);
  nextFrame();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].video.width.ideal, 1920);
  assert.equal(requests[0].video.height.ideal, 1080);
  assert.equal(requests[0].audio, false);
  assert.equal(video.srcObject, granted);
  const [input] = modelInputs;
  assert.notEqual(input, video);
  assert.deepEqual([input.width,input.height], [640,360]);
  assert.deepEqual([overlay.width,overlay.height], [640,360]);
  camera.dispose();
});

test('a resolution rejection attempts 720p but a denied permission does not reprompt', async () => {
  for (const reason of ['OverconstrainedError', 'NotAllowedError']) {
    const widths = [];
    const { camera } = rig(async request => {
      widths.push(request.video.width.ideal);
      if (widths.length === 1) throw Object.assign(new Error(reason), { name:reason });
      return stream();
    }, async () => engine());
    await camera.start();
    const isResolution = reason === 'OverconstrainedError';
    assert.deepEqual(widths, isResolution ? [1920,1280] : [1920]);
    assert.equal(camera.running, isResolution);
    camera.dispose();
  }
});
