/* Transient camera input only: no image or identity is stored or transmitted. */
(() => {
  'use strict';
  const signal = (p, minimum = .55) => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 &&
    Math.min(p.visibility ?? 1, p.presence ?? 1) >= minimum;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  const SOFT_SHOULDER_CONFIDENCE = .42;
  const SOFT_SHOULDER_MS = 650;
  const BYSTANDER_MEMORY_MS = 450;

  function upperBody(points, aspect, allowSoft = false) {
    const [nose, left, right] = [0, 11, 12].map(i => points?.[i]);
    const strongShoulders = [left, right].filter(p => signal(p)).length;
    const softShoulder = strongShoulders === 1 && allowSoft && [left, right].every(p => signal(p, SOFT_SHOULDER_CONFIDENCE));
    if (!signal(nose) || (strongShoulders !== 2 && !softShoulder)) return null;
    const x = (left.x + right.x) / 2, y = (left.y + right.y) / 2;
    const span = Math.hypot(left.x - right.x, (left.y - right.y) / aspect);
    const rise = (y - nose.y) / aspect;
    if (span < .08 || span > .65 || nose.y < .05 || nose.y > .60 || rise <= 0) return null;
    const faceOffset = Math.abs(nose.x - x) / span;
    const shoulderSlope = Math.abs(left.y - right.y) / (span * aspect);
    const proportion = rise / span;
    return { points, x, y, span, rise, nose, proportion, faceOffset, shoulderSlope, softShoulder,
      confidence: Math.min(...[nose, left, right].map(p => Math.min(p.visibility ?? 1, p.presence ?? 1))),
      eligible: x >= .25 && x <= .75 && faceOffset <= .74 && shoulderSlope <= .74 &&
        proportion >= .12 && proportion <= 1.60 };
  }

  function priority(body) {
    // Perspective size wins among credible centered torsos. The center and
    // signal quality break close calls; raised arms/hands never affect rank.
    return body.span * Math.sqrt(clamp(body.proportion, .24, .72)) *
      (1 - 1.25 * Math.abs(body.x - .5)) * (1 - .54 * body.faceOffset) *
      (1 - .20 * body.shoulderSlope) * (.85 + .15 * body.confidence);
  }

  function distance(a, b, aspect) {
    const offset = Math.hypot(a.x - b.x, (a.y - b.y) / aspect) / a.span;
    const face = Math.hypot(a.nose.x - b.nose.x, (a.nose.y - b.nose.y) / aspect) / a.span;
    const size = Math.abs(Math.log(b.span / a.span));
    const shape = Math.abs(Math.log(b.proportion / a.proportion));
    return { offset, face, size, shape, cost: offset + .45 * face + 1.35 * size + .35 * shape };
  }

  function similar(a, b, aspect, mode = 'live') {
    const { offset, face, size, shape, cost } = distance(a, b, aspect);
    // Returning requires two mutually stable observations. Allow modest
    // perspective/stance changes against the last sighting, but keep the
    // more conservative gate for ambiguity and known bystanders.
    const [maxOffset, maxFace, maxSize, maxShape] = mode === 'strict' ? [.29, .39, .23, .40] :
      mode === 'return' ? [.52, .64, .32, .62] : [.47, .64, .34, .80];
    return offset <= maxOffset && face <= maxFace && size <= maxSize && shape <= maxShape ? cost : Infinity;
  }

  class ParticipantTracker {
    constructor() { this.reset(); }
    reset() {
      this.current = null; this.anchor = null; this.lastSeen = this.lastStrongSeen = this.othersSeen = -Infinity;
      this.locked = false; this.missed = false; this.pending = null; this.others = [];
    }
    lock() {
      if (!this.current) return;
      this.locked = true;
      this.anchor = this.current;
    }
    select(poses, time, aspect, mode) {
      const gap = this.missed || time - this.lastSeen > 350;
      // A padded sleeve or bag strap can briefly weaken one shoulder.
      // Do not use this as evidence for acquiring or reacquiring a person.
      const allowSoft = this.locked && !gap && mode === 'pose' && time - this.lastStrongSeen <= SOFT_SHOULDER_MS;
      const bodies = (poses || []).map(points => upperBody(points, aspect, allowSoft)).filter(Boolean);
      const rememberOthers = winner => {
        const others = bodies.filter(body => body !== winner && !body.softShoulder);
        if (others.length) { this.others = others; this.othersSeen = time; }
        else if (time - this.othersSeen > BYSTANDER_MEMORY_MS) this.others = [];
      };
      if (!this.locked) {
        const eligible = bodies.filter(body => body.eligible).sort((a, b) => priority(b) - priority(a));
        const continuing = this.current && eligible
          .filter(body => Number.isFinite(similar(this.current, body, aspect)))
          .sort((a, b) => similar(this.current, a, aspect) - similar(this.current, b, aspect))[0];
        let winner = continuing && priority(eligible[0]) < priority(continuing) * 1.10 ? continuing : eligible[0];
        if (winner && eligible.some(body => body !== winner &&
            priority(body) >= priority(winner) * .92 && similar(winner, body, aspect, 'strict') < .24)) {
          winner = null;
        }
        const changed = !!this.current && winner !== continuing;
        this.current = winner || null;
        if (winner) {
          this.lastSeen = this.lastStrongSeen = time;
          rememberOthers(winner);
        }
        return { points: winner?.points ?? null, changed };
      }

      const candidates = bodies.map(body => ({ body, cost: similar(this.current, body, aspect,
        body.softShoulder ? 'strict' : gap ? 'return' : 'live') }))
        .filter(({ body, cost }) => Number.isFinite(cost) && body.x >= .25 && body.x <= .75 &&
          // Frame-to-frame motion can vary, but scale cannot drift indefinitely
          // toward a more distant bystander after the participant was confirmed.
          Math.abs(Math.log(body.span / this.anchor.span)) <= .52 &&
          Math.abs(Math.log(body.proportion / this.anchor.proportion)) <= .85)
        .sort((a, b) => a.cost - b.cost);
      const chosen = candidates[0];
      const recentOthers = time - this.othersSeen <= BYSTANDER_MEMORY_MS ? this.others : [];
      const confusable = chosen && (
        (candidates[1] && candidates[1].cost - chosen.cost < .24) ||
        recentOthers.some(body => similar(body, chosen.body, aspect, 'strict') <= chosen.cost + .10)
      );
      if (chosen && !confusable && (!gap || (this.pending &&
          Number.isFinite(similar(this.pending, chosen.body, aspect, 'strict'))))) {
        if (!chosen.body.softShoulder) { this.current = chosen.body; this.lastStrongSeen = time; }
        this.lastSeen = time; this.missed = false; this.pending = null;
        rememberOthers(chosen.body);
        return { points: chosen.body.points,
          bodyConfidence: chosen.body.softShoulder ? SOFT_SHOULDER_CONFIDENCE : undefined };
      }

      // Preserve the existing one-shoulder allowance only for a continuously
      // seen person during a crank, never as a way to acquire or reacquire one.
      if (!chosen && !gap && !confusable && mode === 'circle' && poses?.length === 1) {
        const points = poses[0];
        const partial = [11, 12].filter(i => signal(points?.[i]));
        const near = (body, radius) => [0, partial[0]].every(i =>
          signal(points[i]) && Math.hypot(points[i].x - body.points[i].x,
            (points[i].y - body.points[i].y) / aspect) <= radius);
        if (partial.length === 1 && near(this.current, this.current.span * .29) &&
            !recentOthers.some(body => near(body, body.span * .33))) {
          return { points };
        }
      }

      this.missed = true;
      this.pending = chosen && !confusable ? chosen.body : null;
      // In an overlap, do not learn a new person's location from the ambiguous detections.
      return { points: null, paused: true, overlap: Boolean(confusable) };
    }
  }

  function luminance(r, g, b) { return (54 * r + 183 * g + 19 * b) >> 8; }

  function lightingMode(data, width, height) {
    let count = 0, light = 0, dark = 0, centerCount = 0, centerLight = 0, centerSum = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = luminance(data[i], data[i + 1], data[i + 2]);
      count++;
      if (luma >= 225) light++;
      if (luma <= 68) dark++;
      if (x >= .28 * width && x < .72 * width && y >= .12 * height && y < .67 * height) {
        centerCount++; centerSum += luma;
        if (luma >= 232) centerLight++;
      }
    }
    const centerMean = centerSum / Math.max(1, centerCount);
    const brightRatio = light / count, darkRatio = dark / count, centerBright = centerLight / Math.max(1, centerCount);
    if (brightRatio >= .17 && centerMean < 139 && (darkRatio >= .12 || centerMean < 105)) return 'backlit';
    if (brightRatio >= .43 || (centerBright >= .38 && centerMean > 185)) return 'bright';
    return 'original';
  }

  // Shift luminance with bounded, monotonic curves. Preserve the useful
  // midtones in bright scenes, lift shadows under backlighting, and soften
  // highlights. Fully clipped highlights cannot be reconstructed.
  const adjustments = {
    backlit: Uint8ClampedArray.from({ length: 256 }, (_, y) => Math.round(
      y + 42 * Math.sin(Math.PI * (y / 255) ** .52) - 22 * (y / 255) ** 3)),
    bright: Uint8ClampedArray.from({ length: 256 }, (_, y) => Math.round(
      y + 14 * Math.sin(Math.PI * y / 255) - 30 * (y / 255) ** 3))
  };

  function correctPixels(data, mode) {
    const curve = adjustments[mode];
    if (!curve) return;
    for (let i = 0; i < data.length; i += 4) {
      const y = luminance(data[i], data[i + 1], data[i + 2]);
      const delta = curve[y] - y;
      data[i] += delta; data[i + 1] += delta; data[i + 2] += delta;
    }
  }

  // Keep pose processing at the previous pixel budget, even on a Full HD feed.
  // Retaining the sensor aspect ratio keeps normalized points aligned with video.
  function analysisSize(width, height) {
    const scale = Math.min(1, 640 / width, 480 / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  class ExposureInput {
    constructor(createCanvas) { this.createCanvas = createCanvas; this.reset(); }
    reset() {
      // Release the pixel buffers (the displayed camera still uses the video).
      for (const slot of [this.sample, this.frame, this.output]) {
        if (slot) { slot.canvas.width = 0; slot.canvas.height = 0; }
      }
      this.sample = this.frame = this.output = null; this.mode = 'original';
      this.sampleAt = this.rawProbeAt = -Infinity; this.disabled = false;
    }
    disable() { this.reset(); this.disabled = true; }
    buffer(name, width, height) {
      if (!this[name]) {
        const canvas = this.createCanvas();
        const ctx = canvas.getContext('2d', { willReadFrequently: name !== 'output' });
        if (!ctx) throw new Error('Camera input canvas is unavailable');
        this[name] = { canvas, ctx };
      }
      const { canvas } = this[name];
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      return this[name];
    }
    source(video, time, recovering) {
      if (this.disabled || !video.videoWidth || !video.videoHeight) return video;
      try {
        if (time - this.sampleAt >= 300) {
          this.sampleAt = time;
          const width = 64, height = 48;
          const { ctx } = this.buffer('sample', width, height);
          ctx.drawImage(video, 0, 0, width, height);
          this.mode = lightingMode(ctx.getImageData(0, 0, width, height).data, width, height);
        }
        const { width: outWidth, height: outHeight } = analysisSize(video.videoWidth, video.videoHeight);
        const raw = () => {
          if (outWidth === video.videoWidth && outHeight === video.videoHeight) return video;
          const { canvas, ctx } = this.buffer('output', outWidth, outHeight);
          ctx.drawImage(video, 0, 0, outWidth, outHeight);
          return canvas;
        };
        if (this.mode === 'original') return raw();
        // If the corrected frame isn't yielding a participant, periodically
        // try the raw frame instead. Never run inference twice per video frame.
        if (recovering && time - this.rawProbeAt >= 650) { this.rawProbeAt = time; return raw(); }
        const scale = Math.min(1, 480 / Math.max(outWidth, outHeight));
        const width = Math.max(1, Math.round(outWidth * scale));
        const height = Math.max(1, Math.round(outHeight * scale));
        const { canvas, ctx } = this.buffer('frame', width, height);
        ctx.drawImage(video, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height);
        correctPixels(pixels.data, this.mode);
        ctx.putImageData(pixels, 0, 0);
        if (scale === 1) return canvas;
        // Keep the Pose Landmarker VIDEO input dimensions identical to the
        // unadjusted analysis frame; the color correction uses a smaller buffer.
        const output = this.buffer('output', outWidth, outHeight);
        output.ctx.drawImage(canvas, 0, 0, outWidth, outHeight);
        return output.canvas;
      } catch {
        this.disable();
        return video;
      }
    }
  }

  const api = { ParticipantTracker, ExposureInput, analysisSize, lightingMode, correctPixels };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.MotionInput = api;
})();
