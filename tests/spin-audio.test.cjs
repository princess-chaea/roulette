const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, buildCues } = require('../spin-audio.js');
const math = require('../roulette.js');
const prizes = [
  { id: 'a', name: 'A', rank: 1, quantity: 2 },
  { id: 'b', name: 'B', rank: 2, quantity: 3 },
];
const animationFrames = direction => math.animationFrames(0, math.finishPlan(prizes, math.visualSegments(prizes)[0], 0, direction));
const short = [{ angle: 0, offset: 0 }, { angle: 1800, offset: 1 }];

function fake() {
  const callbacks = new Map(), voices = [];
  let nextId = 0, instance;
  const param = () => ({
    setValueAtTime(value) { this.first = value; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}
  });
  const environment = {
    AudioContext: class {
      constructor() { this.state = 'suspended'; this.currentTime = 1; instance = this; }
      createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
      createOscillator() {
        const voice = {
          frequency: param(), stopTimes: [], connect() {},
          disconnect() { this.disconnected = true; },
          start(at) { this.started = at; },
          stop(at) { this.stopTimes.push(at); }
        };
        voices.push(voice);
        return voice;
      }
      async resume() { this.state = 'running'; }
    },
    requestAnimationFrame(callback) { callbacks.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { callbacks.delete(id); }
  };
  function advance(animation, time) {
    animation.currentTime = time;
    const batch = Array.from(callbacks.values());
    callbacks.clear();
    for (const callback of batch) callback();
  }
  return { environment, voices, callbacks, advance, get instance() { return instance; } };
}

test('actual motion keyframes yield quick-to-slow clicks, then sparse finish taps, in both directions', () => {
  for (const direction of ['clockwise', 'counterclockwise']) {
    const cues = buildCues(animationFrames(direction), 6500);
    assert.ok(cues.length > 8);
    assert.ok(cues[2].at - cues[1].at < cues[35].at - cues[34].at);
    assert.ok(cues.at(-1).at > 4100 && cues.at(-1).at < 6500);
    assert.ok(cues.at(-1).strength < cues[0].strength);
  }
  assert.deepEqual(buildCues([{ angle: 0, offset: 0 }, { angle: 0, offset: 1 }], 1000), []);
});

test('no auto-unlock, and no stale click when catching up', () => {
  const f = fake(), audio = create(f.environment);
  const animation = { currentTime: null, playState: 'running' };
  audio.play({ animation, frames: animationFrames('clockwise'), duration: 6500 });
  audio.celebrate(1);
  assert.equal(f.instance, undefined);
  audio.unlock();
  audio.play({ animation, frames: animationFrames('clockwise'), duration: 6500 });
  f.advance(animation, 12);
  assert.equal(f.voices.length, 1);
  assert.equal(f.voices[0].type, 'triangle');
  f.advance(animation, 4000);
  assert.equal(f.voices.length, 1);
  animation.playState = 'finished';
  f.advance(animation, 6500);
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.voices[0].disconnected, true);
});

test('reduced-motion end bounds and mute cancel live spin and celebration sounds', () => {
  const f = fake(), audio = create(f.environment), animation = { currentTime: 0, playState: 'running' };
  audio.unlock();
  audio.play({ animation, frames: short, duration: 120 });
  f.advance(animation, 25);
  assert.equal(f.voices.length, 1);
  assert.ok((f.voices[0].stopTimes[0] - f.voices[0].started) <= .026);
  audio.celebrate(1);
  assert.equal(f.voices[0].disconnected, true);
  assert.equal(f.callbacks.size, 0);
  audio.setMuted(true);
  assert.ok(f.voices.every(voice => voice.disconnected));
  const count = f.voices.length;
  audio.celebrate(2);
  audio.play({ animation, frames: short, duration: 120 });
  assert.equal(f.voices.length, count);
  assert.equal(f.callbacks.size, 0);
});

test('each result rank has a distinct ascending fanfare length and unsupported audio is safe', () => {
  const counts = [], lengths = [];
  for (const rank of [4, 3, 2, 1]) {
    const f = fake(), audio = create(f.environment);
    audio.unlock();
    audio.celebrate(rank);
    counts.push(f.voices.length);
    lengths.push(Math.max(...f.voices.map(voice => voice.stopTimes[0])) - 1);
  }
  assert.deepEqual(counts, [2, 2, 4, 8]);
  assert.ok(lengths.every((duration, i) => i === 0 || duration > lengths[i - 1]));
  assert.ok(lengths.at(-1) >= 1.3 && lengths.at(-1) <= 1.45);
  const audio = create({});
  assert.doesNotThrow(() => { audio.unlock(); audio.play(); audio.celebrate(1); audio.stop(); });
});

test('every supported rank has a unique melody; ranks 4–12 remain short and quiet', () => {
  const unique = new Set();
  for (let rank = 1; rank <= 12; rank++) {
    const f = fake(), audio = create(f.environment);
    audio.unlock();
    audio.celebrate(rank);
    const notes = f.voices.map(voice => voice.frequency.first).join(',');
    assert.ok(notes && !unique.has(notes));
    unique.add(notes);
    if (rank > 3) {
      assert.equal(f.voices.length, 2);
      assert.ok(Math.max(...f.voices.map(voice => voice.stopTimes[0])) - 1 <= .35);
    }
  }
  assert.equal(unique.size, 12);
});


test('result resumes a suspended context without replaying a result already closed', async () => {
  const f = fake(), audio = create(f.environment);
  audio.unlock();
  f.instance.state = 'suspended';
  audio.celebrate(4);
  await Promise.resolve();
  assert.equal(f.voices.length, 2);
  f.instance.state = 'suspended';
  let resumeNow;
  f.instance.resume = () => new Promise(resolve => {
    resumeNow = () => { f.instance.state = 'running'; resolve(); };
  });
  audio.celebrate(1);
  audio.stop();
  resumeNow();
  await Promise.resolve();
  assert.equal(f.voices.length, 2);
});
