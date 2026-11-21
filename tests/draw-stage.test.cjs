const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const app = readFileSync(resolve(__dirname, '../app.js'), 'utf8');
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function runApp() {
  const nodes = new Map(), timers = [], spins = [], scrolls = [];
  const options = { popup: false };
  const audioEvents=[];
  const audio={muted:false, setMuted(value){this.muted=value;}, unlock(){audioEvents.push(['unlock']);}, play(data){audioEvents.push(['spin',data]);}, stop(){audioEvents.push(['stop']);}, celebrate(rank){assert.equal(get('result-dialog').open,true);audioEvents.push(['result',rank]);}};
  let currentCamera, snapshot, serial = 0;
  function node(name) {
    const classes = new Set(), events = new Map(), attrs = new Map(), children = [];
    const toggle = (key, force = !classes.has(key)) => force ? classes.add(key) : classes.delete(key);
    const element = {
      dataset: {}, style: { setProperty() {} }, hidden: false, offsetTop: 15,
      open: false, disabled: false, classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key), toggle },
      append(...items) { children.push(...items); },
      replaceChildren(...items) { children.splice(0, children.length, ...items); },
      get firstElementChild() { return children[0]; },
      cloneNode() { return node('clone'); },
      setAttribute(key, value) { attrs.set(key, String(value)); },
      removeAttribute(key) { attrs.delete(key); },
      toggleAttribute(key, force) { if (force) attrs.set(key, ''); else attrs.delete(key); },
      querySelector(selector) { return get(selector); },
      closest(selector) { return get(selector); },
      addEventListener(type, listener) { events.set(type, listener); },
      emit(type, value) { return events.get(type)?.(value); },
      showModal() { this.open = true; },
      close() { this.open = false; this.emit('close'); },
      focus() {},
      scrollIntoView() {
        scrolls.push([name, get('draw-page').dataset.drawStage]);
        if (name === '.wheel-stage') assert.equal(get('draw-page').dataset.drawStage, 'wheel');
      },
      get offsetHeight() {
        if (name === '.lens-heading') {
          assert.equal(get('draw-page').dataset.drawStage, 'wheel');
          assert.equal(get('finish-lens').hidden, false);
        }
        return 60;
      },
      animate() {
        let finish;
        const animation = { finished: new Promise(resolve => { finish = resolve; }), cancel() {}, finish };
        if (name === 'draw-wheel' || name === 'lens-disc') {
          assert.equal(get('draw-page').dataset.drawStage, 'wheel');
          assert.equal(get('result-dialog').open, false);
          spins.push(animation);
        }
        return animation;
      }
    };
    return element;
  }
  const get = name => {
    if (!nodes.has(name)) nodes.set(name, node(name));
    return nodes.get(name);
  };
  get('draw-page').dataset.drawStage = /id="draw-page"[^>]+data-draw-stage="(\w+)"/.exec(html)[1];
  const doc = Object.assign(node('document'), {
    getElementById: get, querySelectorAll: () => [], createElement: node, createElementNS: (_, name) => node(name),
    body: node('body'), timeline: { currentTime: 0 },
  });
  const animationHost = { requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
  const sandbox = {
    document: doc, window: Object.assign(node('window'), { scrollTo() {} }), location: { hash: '#draw' },
    RouletteMath: require('../roulette.js'),
    RoulettePresentation: { ...require('../presentation.js'), watchContainedFrame: () => () => {} },
    FirstPrizeMode: require('../operator-mode.js'), MotionGestures: require('../motion-gestures.js'),
    RouletteFanfare: { apply() {} }, RouletteSpinAudio: {create: () => audio},
    MotionCamera: class {
      constructor(hooks) { Object.assign(this, hooks); currentCamera = this; this.running = false; this.stops = 0; }
      setPoseKind() {}
      setActive(active) { this.active = active; }
      setAnimationHost(host) { this.animationHost = host; }
      stop() { this.running = false; this.stops++; }
    },
    CameraWindow: { isOpen: () => options.popup, getWindow: () => options.popup ? animationHost : null },
    DOMMatrix: class { constructor() { this.a = 1; this.b = 0; } },
    getComputedStyle: el => el.style,
    crypto: { randomUUID: () => 'mock-' + ++serial, getRandomValues: array => array },
    localStorage: { getItem: () => null, setItem: (_, value) => { snapshot = JSON.parse(value); } },
    matchMedia: () => ({ matches: false }), setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout: timer => { const i = timers.indexOf(timer); if (i !== -1) timers.splice(i, 1); }, ...animationHost,
  };
  runInNewContext(app, sandbox, { filename: 'app.js' });
  const camera = currentCamera;
  async function finish() {
    spins.forEach(animation => animation.finish());
    await flush();
    assert.equal(get('result-dialog').open, false, 'the result waits until after settling');
    assert.equal(timers.length, 1);
    timers.shift().fn();
    await flush();
    assert.equal(get('result-dialog').open, true);
  }
  return { get, camera, finish, spins, scrolls, timers, audio, audioEvents, state: () => snapshot, body: doc.body, fullscreen(on) {
    doc.fullscreenElement = on ? {} : null;
    doc.emit('fullscreenchange');
  }, split(open) {
    options.popup = open;
    sandbox.window.emit('camera-window-change', { detail: { open } });
  } };
}

test('motion switches from camera to wheel only on a completed crank, then rearms the live camera', async () => {
  const h = runApp();
  h.camera.running = true;
  h.camera.onState({ phase: 'ready', message: 'ready' });
  assert.equal(h.camera.active, true);
  h.camera.onResult({ mode:'circle', progress: 74, angleDeg: 195, grip: { held:true }, matched: false });
  assert.equal(h.get('draw-page').dataset.drawStage, 'camera');
  assert.equal(h.state().pending, null);
  h.camera.onResult({ mode:'circle', progress: 100, angleDeg: -321, grip: { held:true }, direction: 'counterclockwise', matched: true });
  assert.equal(h.get('draw-page').dataset.drawStage, 'wheel');
  assert.equal(h.body.classList.contains('camera-presentation'), false);
  assert.deepEqual(h.scrolls[0], ['.wheel-stage', 'wheel']);
  assert.equal(h.state().pending.direction, 'counterclockwise');
  assert.equal(h.camera.active, false);
  assert.equal(h.camera.stops, 0);
  assert.equal(h.spins.length, 2);
  await h.finish();
  assert.equal(h.state().history.length, 1);
  h.get('result-dialog').close();
  assert.equal(h.get('draw-page').dataset.drawStage, 'camera');
  assert.equal(h.body.classList.contains('camera-presentation'), true);
  assert.equal(h.camera.active, true);
  assert.equal(h.camera.stops, 0);
});

test('the manual fallback starts without a camera and a split view does not scroll the wheel', async () => {
  for (const split of [false, true]) {
    const h = runApp();
    if (split) h.split(true);
    h.get('manual-spin').emit('click');
    assert.equal(h.get('draw-page').dataset.drawStage, 'wheel');
    assert.ok(h.state().pending);
    assert.equal(h.scrolls.length, split ? 0 : 1);
    await h.finish();
    h.get('result-dialog').close();
    assert.equal(h.get('draw-page').dataset.drawStage, 'camera');
    assert.equal(h.scrolls.length, split ? 0 : 2);
    assert.equal(h.camera.stops, 0);
  }
});

test('fullscreen preserves the camera when toggled and swaps position text for live gesture art', () => {
  const h = runApp();
  assert.equal(h.body.classList.contains('camera-presentation'), true);
  assert.equal(h.get('live-guide').hidden, true);
  h.fullscreen(true);
  assert.equal(h.body.classList.contains('roulette-fullscreen'), true);
  assert.equal(h.get('draw-page').dataset.drawStage, 'camera');
  h.camera.running = true;
  h.camera.onState({ phase: 'ready', message: 'ready' });
  assert.equal(h.get('camera-scene').classList.contains('is-live'), true);
  assert.equal(h.get('live-guide').hidden, false);
  assert.equal(h.get('live-guide-image').hidden, true);
  assert.equal(h.get('camera-guide-bounds').dataset.motionStage, 'presence');
  h.camera.onResult({ mode: 'pose', progress: 33, matched: false });
  assert.equal(h.get('live-guide-image').hidden, false);
  assert.equal(h.get('camera-guide-bounds').dataset.motionStage, 'pose');
  h.fullscreen(false);
  assert.equal(h.body.classList.contains('roulette-fullscreen'), false);
  assert.equal(h.get('draw-page').dataset.drawStage, 'camera');
  assert.equal(h.camera.active, true);
  assert.equal(h.camera.stops, 0);
});

test('camera and popup share in-frame progress, a horizontal guide and display-only tone correction', () => {
  const preview = html.indexOf('id="camera-preview"');
  const footer = html.indexOf('class="camera-bottom"', preview);
  const scene = html.slice(preview, footer);
  assert.match(scene, /class="camera-picture" id="camera-video"[\s\S]*id="tracking-overlay"[\s\S]*id="camera-guide-bounds"[\s\S]*id="motion-progress"[\s\S]*id="live-guide"/);
  const css = readFileSync(resolve(__dirname, '../camera-display.css'), 'utf8');
  assert.match(css, /\.camera-guide-bounds\s*\{[^}]*inset:var\(--fit-y,0px\) var\(--fit-x,0px\);/);
  assert.match(css, /\.camera-guide-bounds \.camera-meter\s*\{[^}]*inset:[^;]* auto;/);
  assert.match(css, /\.live-guide img\s*\{[^}]*grid-column:1; grid-row:1;/);
  assert.match(css, /\.live-guide > div\s*\{[^}]*grid-column:2; grid-row:1;/);
  assert.match(css, /\.camera-picture\s*\{[^}]*filter:brightness\(\.80\) contrast\(1\.06\) saturate\(\.84\)/);
  assert.doesNotMatch(css, /tracking-overlay/);
  const mirror = readFileSync(resolve(__dirname, '../camera-window.js'), 'utf8');
  assert.match(mirror, /camera-display-style/);
  assert.match(mirror, /preview\.className = 'camera-picture'/);
  assert.match(mirror, /guideBounds\.append\(meter\)/);
  assert.match(mirror, /progress\.setAttribute\('aria-valuenow', percent\)/);
});

test('fullscreen has a definite, stretchable scene row and puts controls below it', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
  const fullscreen = 'body.roulette-fullscreen.camera-presentation:not(.dual-monitor)';
  const rule = selector => {
    // Keep these assertions about the actual CSS constraint that caused the
    // failure, not just whether the fullscreen class is set in a DOM stub.
    const marker = fullscreen + (selector ? ' ' + selector : '') + ' {';
    const start = css.indexOf(marker);
    assert.notEqual(start, -1, marker);
    return css.slice(start + marker.length, css.indexOf('}', start));
  };
  assert.match(rule(''), /height:100dvh;[\s\S]*grid-template-rows:auto minmax\(0,1fr\)/);
  assert.match(rule('> main'), /(?:^|;)\s*margin-block:0;/);
  assert.match(rule('> main'), /(?:^|;)\s*height:100%;\s*min-height:0;/);
  assert.match(rule('#draw-page:not([hidden])'), /grid-template-rows:minmax\(0,1fr\) auto auto/);
  assert.match(rule('.draw-layout'), /grid-row:1;.*grid-template-rows:minmax\(0,1fr\)/);
  assert.match(rule('.camera-card'), /grid-template-rows:minmax\(0,1fr\) auto/);
  assert.match(rule('.camera-scene .camera-live-view'), /height:100%;\s*max-height:none;/);
  assert.match(rule('#draw-stage-start'), /grid-row:2;/);
  assert.match(css, /#camera-video,#tracking-overlay\{[^}]*object-fit:contain/);
  assert.match(html, /styles\.css\?v=\d{8}[a-z]/);
});


test('the audible spin starts on a gesture click and stops before the one popup fanfare', async () => {
  const h=runApp();
  h.get('manual-spin').emit('click');
  assert.deepEqual(h.audioEvents.map(e=>e[0]),['unlock','spin']);
  const launch=h.audioEvents[1][1];
  assert.equal(launch.animation,h.spins[0]);
  assert.ok(launch.duration>4000&&launch.frames.every(frame=>Number.isFinite(frame.angle)));
  assert.equal(h.get('result-dialog').open,false);
  await h.finish();
  assert.deepEqual(h.audioEvents.map(e=>e[0]),['unlock','spin','stop','result']);
  assert.equal(h.audioEvents[3][1],h.state().history[0].rank);
  h.get('result-dialog').close();
  assert.equal(h.audioEvents.at(-1)[0],'stop');
  h.get('toggle-sound').emit('click');
  assert.equal(h.audio.muted,true);
  h.get('toggle-sound').emit('click');
  assert.equal(h.audio.muted,false);
  assert.equal(h.audioEvents.at(-1)[0],'unlock');
});


test('the prize stays open for 2 seconds, saves once and returns to the camera', async () => {
  const h = runApp();
  h.get('manual-spin').emit('click');
  await h.finish();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].delay, 2000);
  assert.equal(h.state().history.length, 1);
  h.timers.shift().fn();
  assert.equal(h.get('result-dialog').open, false);
  assert.equal(h.get('draw-page').dataset.drawStage, 'camera');
  assert.equal(h.state().history.length, 1);
});

test('manual confirmation cancels the pending auto-close before the next draw', async () => {
  const h = runApp();
  h.get('manual-spin').emit('click');
  await h.finish();
  h.get('result-dialog').close();
  assert.equal(h.timers.length, 0);
  assert.equal(h.get('draw-page').dataset.drawStage, 'camera');
});
