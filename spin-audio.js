/* Quiet procedural roulette clicks. Uses the visual animation clock, not a timer. */
(() => {
  'use strict';
  const clamp = (min, max, value) => Math.max(min, Math.min(max, value));
  const cube = (t, a, b) => t * (3 * (1 - t) * ((1 - t) * a + t * b) + t * t);
  function easing(value) {
    const controls = value === 'ease-in-out' ? [.42, 0, .58, 1] :
      typeof value === 'string' && value.startsWith('cubic-bezier(') ?
        value.slice(13, -1).split(',').map(Number) : null;
    if (!controls || controls.length !== 4 || !controls.every(Number.isFinite)) return t => t;
    const [x1, y1, x2, y2] = controls;
    return x => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (cube(mid, x1, x2) < x) lo = mid; else hi = mid;
      }
      return cube((lo + hi) / 2, y1, y2);
    };
  }
  function buildCues(frames, duration) {
    if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(frames) || frames.length < 2 ||
        !frames.every(f => Number.isFinite(f.angle) && Number.isFinite(f.offset))) return [];
    const cues = [];
    let previous = -Infinity;
    for (let i = 0; i + 1 < frames.length; i++) {
      const a = frames[i], b = frames[i + 1];
      const start = a.offset * duration, span = (b.offset - a.offset) * duration;
      const travel = Math.abs(b.angle - a.angle);
      if (span <= 0 || travel < .35) continue;
      const curve = easing(a.easing);
      if (i > 0) {
        // The visual finish rocks across one boundary. Use sparse, diminishing
        // taps there rather than continuing a constant rattle after deceleration.
        const at = start + span * .17;
        if (at < duration - 28 && at - previous >= 195) {
          cues.push({ at, strength: clamp(.15, .45, travel / 12) });
          previous = at;
        }
        continue;
      }
      for (let elapsed = Math.min(12, span * .1); elapsed < span && start + elapsed < duration - 28; elapsed += 8) {
        const lo = Math.max(0, elapsed - 8), hi = Math.min(span, elapsed + 8);
        const speed = travel * Math.abs(curve(hi / span) - curve(lo / span)) / (hi - lo);
        if (speed < .015) continue;
        const interval = clamp(46, 260, 55 / Math.sqrt(speed));
        const at = start + elapsed;
        if (at - previous < interval) continue;
        cues.push({ at, strength: clamp(.27, 1, .34 + speed * .42) });
        previous = at;
      }
    }
    return cues;
  }
  const fanfares = {
    1: [
      [0, 392, .19, .17], [.11, 523.25, .21, .19], [.22, 659.25, .23, .19], [.33, 783.99, .3, .23],
      [.52, 523.25, .76, .13], [.52, 659.25, .83, .16], [.52, 783.99, .86, .2], [.52, 1046.5, .78, .12]
    ],
    2: [[0, 440, .24, .19], [.14, 587.33, .27, .19], [.3, 739.99, .56, .2], [.3, 880, .45, .11]],
    3: [[0, 659.25, .15, .2], [.12, 987.77, .32, .18]],
    4: [[0, 523.25, .19, .14], [.09, 659.25, .23, .12]],
    5: [[0, 587.33, .17, .14], [.10, 783.99, .20, .12]],
    6: [[0, 659.25, .17, .14], [.08, 587.33, .22, .12]],
    7: [[0, 493.88, .18, .14], [.11, 698.46, .20, .12]],
    8: [[0, 523.25, .16, .14], [.07, 698.46, .22, .12]],
    9: [[0, 587.33, .18, .14], [.11, 523.25, .18, .12]],
    10: [[0, 440, .16, .14], [.08, 587.33, .21, .12]],
    11: [[0, 493.88, .15, .14], [.08, 659.25, .19, .12]],
    12: [[0, 523.25, .17, .14], [.10, 440, .20, .12]]
  };
  function create(environment = globalThis) {
    let context, output, frameId, frameHost, generation = 0;
    let muted = false;
    const voices = new Set();
    function stop() {
      generation++;
      if (frameId != null) frameHost?.cancelAnimationFrame(frameId);
      frameId = null;
      frameHost = null;
      for (const voice of voices) {
        try { voice.source.stop(); } catch {}
        voice.cleanup();
      }
    }
    function unlock() {
      if (muted) return;
      try {
        if (!context) {
          const AudioContext = environment.AudioContext || environment.webkitAudioContext;
          if (!AudioContext) return;
          const nextContext = new AudioContext();
          const nextOutput = nextContext.createGain();
          nextOutput.gain.value = .27;
          nextOutput.connect(nextContext.destination);
          context = nextContext;
          output = nextOutput;
        }
        if (context.state !== 'running') context.resume()?.catch(() => {});
      } catch { /* Audio must never block a draw. */ }
    }
    function click(strength, remainingMs) {
      let voice;
      try {
        const source = context.createOscillator(), envelope = context.createGain();
        const at = context.currentTime, end = at + Math.min(.025, remainingMs / 1000);
        source.type = 'triangle';
        source.frequency.setValueAtTime(165 + 45 * strength, at);
        source.frequency.exponentialRampToValueAtTime(80 + 27 * strength, end);
        envelope.gain.setValueAtTime(.0001, at);
        envelope.gain.linearRampToValueAtTime(.14 * strength, at + .002);
        envelope.gain.exponentialRampToValueAtTime(.0001, end);
        source.connect(envelope);
        envelope.connect(output);
        voice = { source, cleanup() {
          voices.delete(voice);
          source.disconnect();
          envelope.disconnect();
        } };
        voices.add(voice);
        source.onended = voice.cleanup;
        source.start(at);
        source.stop(end);
      } catch {
        if (voice) voice.cleanup();
      }
    }
    function play({ animation, frames, duration, host = environment } = {}) {
      stop();
      if (muted || !context || !animation || !host?.requestAnimationFrame) return;
      const cues = buildCues(frames, duration);
      if (!cues.length) return;
      let nextCue = 0;
      const run = generation;
      frameHost = host;
      function tick() {
        if (run !== generation) return;
        const time = animation.currentTime;
        if (animation.playState === 'idle' || animation.playState === 'finished' || time >= duration) {
          stop();
          return;
        }
        if (Number.isFinite(time)) {
          let cue;
          while (nextCue < cues.length && cues[nextCue].at <= time) cue = cues[nextCue++];
          // Skip stale clicks after a throttled frame rather than playing a burst.
          if (cue && time - cue.at <= 85 && duration - time >= 8 &&
              animation.playState === 'running' && context.state === 'running') click(cue.strength, duration - time);
        }
        if (nextCue < cues.length) frameId = host.requestAnimationFrame(tick);
        else frameId = null;
      }
      frameId = host.requestAnimationFrame(tick);
    }
    function celebrate(rank) {
      stop();
      if (muted || context?.state !== 'running') return;
      const theme = fanfares[Number(rank)];
      if (!theme) return;
      const start = context.currentTime;
      for (const [delay, frequency, duration, strength] of theme) {
        let voice;
        try {
          const source = context.createOscillator(), envelope = context.createGain();
          const at = start + delay, end = at + duration;
          source.type = 'sine';
          source.frequency.setValueAtTime(frequency, at);
          envelope.gain.setValueAtTime(.0001, at);
          envelope.gain.linearRampToValueAtTime(strength, at + .018);
          envelope.gain.exponentialRampToValueAtTime(.0001, end);
          source.connect(envelope);
          envelope.connect(output);
          voice = { source, cleanup() {
            voices.delete(voice);
            source.disconnect();
            envelope.disconnect();
          } };
          voices.add(voice);
          source.onended = voice.cleanup;
          source.start(at);
          source.stop(end);
        } catch {
          if (voice) voice.cleanup();
        }
      }
    }
    function setMuted(value) {
      muted = !!value;
      if (muted) stop();
    }
    return { unlock, play, celebrate, stop, setMuted, get muted() { return muted; } };
  }
  const api = { create, buildCues };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.RouletteSpinAudio = api;
})();
