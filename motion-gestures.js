/* Pure gesture recognition for a single MediaPipe pose. Timestamps are milliseconds. */
(() => {
  'use strict';
  const LEFT = { shoulder: 11, elbow: 13, wrist: 15 };
  const RIGHT = { shoulder: 12, elbow: 14, wrist: 16 };
  const POSE_KINDS = Object.freeze(['hands_up', 'hands_near_shoulders', 'one_hand_up', 'arm_heart']);
  const POSE_HINTS = {
    hands_up: '양손을 머리 위로 들어 주세요.',
    hands_near_shoulders: '두 손을 양쪽 어깨 가까이에 올려 주세요.',
    one_hand_up: '한 손만 머리 위로 들어 주세요.',
    arm_heart: '팔꿈치를 양옆으로 펴고 머리 위에서 두 손을 모아 큰 하트를 만들어 주세요.'
  };
  const DEFAULTS = { confidence: 0.55, presenceHoldMs: 2000, poseHoldMs: 1000, startHoldMs: 150, maxFrameGapMs: 350 };
  const status = (message, progress = 0, extra = {}) => ({ message, progress, matched: false, ...extra });
  // Mirrored, normalized hand coordinates; idle handles sit at the guide start.
  // On body loss no guide exists, so x/y are null. Positive angleDeg is clockwise.
  const idleGrip = target => ({
    grip: { x: target?.startX ?? null, y: target?.startY ?? null, held: false, progress: 0 }, angleDeg: 0
  });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  // Leave a 60-degree finishing margin for a hand-drawn turn.
  const TURN_ANGLE = 5 * Math.PI / 3;
  const WRIST_GRACE_MS = 250;
  const TURN_HINT = '손잡이를 잡고 한 방향으로 한 바퀴 돌려 주세요.';

  function visible(point, confidence) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 &&
      (point.visibility ?? 1) >= confidence && (point.presence ?? 1) >= confidence;
  }

  // Display coordinates are mirrored. Distances are measured in frame-width units
  // so the guide is a physical circle at any video aspect ratio.
  function bodyFrame(points, aspect, confidence) {
    if (![0, 11, 12].every(i => visible(points?.[i], confidence))) return null;
    const [nose, left, right] = [0, 11, 12].map(i => points[i]);
    const x = 1 - (left.x + right.x) / 2;
    const shoulderY = (left.y + right.y) / 2;
    const span = Math.hypot(left.x - right.x, (left.y - right.y) / aspect);
    if (span < 0.045 || nose.y >= shoulderY) return null;
    // A chest-up camera view is sufficient. Visible hips refine the guide position.
    const shoulderScale = span * aspect;
    let height = clamp((shoulderY - nose.y) * 2.7, shoulderScale * 0.7, shoulderScale * 2);
    if ([23, 24].every(i => visible(points[i], confidence))) {
      const measured = (points[23].y + points[24].y) / 2 - shoulderY;
      if (measured > shoulderScale * 0.35 && measured < shoulderScale * 2.5) height = measured;
    }
    return { x, y: shoulderY + height * 0.20, span, shoulderScale, shoulderY, height };
  }

  function discontinuous(a, b, aspect) {
    if (!a) return false;
    const displacement = Math.hypot(a.x - b.x, (a.y - b.y) / aspect);
    return displacement > a.span * 0.50 || b.span / a.span < 0.72 || b.span / a.span > 1.38;
  }

  function targetFor(frame, aspect) {
    const radius = Math.min(clamp(frame.span * 0.95, 0.13, 0.27), 0.27 / aspect);
    return { x: 0.5, y: 0.5, radius, radiusY: radius * aspect, grabRadius: radius * 0.75, startX: 0.5 + radius, startY: 0.5 };
  }

  function wristAt(points, arm) {
    if (!visible(points?.[arm.wrist], 0.45)) return null;
    return { x: 1 - points[arm.wrist].x, y: points[arm.wrist].y };
  }

  function heldPose(kind, points, frame) {
    if (kind === 'hands_near_shoulders') {
      const center = 1 - frame.x;
      const handsByShoulders = [LEFT, RIGHT].every(arm => {
        const shoulder = points[arm.shoulder], wrist = points[arm.wrist];
        const offsetX = (wrist.x - shoulder.x) / frame.span;
        const offsetY = (wrist.y - shoulder.y) / frame.shoulderScale;
        const outward = Math.sign(shoulder.x - center);
        return Math.hypot(offsetX, offsetY) <= 0.70 && wrist.y >= points[0].y &&
          (wrist.x - center) * outward >= frame.span * 0.08;
      });
      return handsByShoulders ? 'both' : null;
    }
    if (kind === 'arm_heart') {
      const center = 1 - frame.x;
      const leftWrist = points[LEFT.wrist], rightWrist = points[RIGHT.wrist];
      // The wrists can be apart and at different heights when fingertips meet.
      const handsMeet = Math.abs(leftWrist.x - rightWrist.x) <= frame.span * 0.70 &&
        Math.abs((leftWrist.x + rightWrist.x) / 2 - center) <= frame.span * 0.45 &&
        Math.abs(leftWrist.y - rightWrist.y) <= frame.shoulderScale * 0.38;
      const noseY = points[0].y;
      const handsHigh = Math.max(leftWrist.y, rightWrist.y) <= noseY + frame.shoulderScale * 0.05 &&
        (leftWrist.y + rightWrist.y) / 2 <= noseY - frame.shoulderScale * 0.04;
      const elbowsWide = Math.abs(points[LEFT.elbow].x - points[RIGHT.elbow].x) >= frame.span * 1.02;
      const bentInward = [LEFT, RIGHT].every(arm => {
        const shoulder = points[arm.shoulder], elbow = points[arm.elbow], wrist = points[arm.wrist];
        const outward = Math.sign(shoulder.x - center);
        return (elbow.x - center) * outward >= frame.span * 0.42 &&
          (elbow.x - wrist.x) * outward >= frame.span * 0.20 &&
          elbow.y <= shoulder.y + frame.shoulderScale * 0.22;
      });
      return handsMeet && handsHigh && elbowsWide && bentInward ? 'both' : null;
    }
    const aboveHead = arm => points[arm.wrist].y < points[0].y - frame.height * 0.10 &&
      points[arm.elbow].y <= frame.shoulderY + frame.height * 0.05;
    const leftUp = aboveHead(LEFT), rightUp = aboveHead(RIGHT);
    const wristGap = Math.abs(points[LEFT.wrist].x - points[RIGHT.wrist].x);
    if (kind === 'hands_up') return leftUp && rightUp && wristGap >= frame.span * 0.55 ? 'both' : null;
    if (leftUp && points[RIGHT.wrist].y >= points[0].y) return 'left';
    if (rightUp && points[LEFT.wrist].y >= points[0].y) return 'right';
    return null;
  }

  class GestureDetector {
    constructor(options = {}) {
      this.tuning = { ...DEFAULTS, ...options };
      this.mode = 'pose';
      this.setPoseKind(options.poseKind ?? 'hands_up');
    }

    reset() {
      this.poseStart = null;
      this.heldSide = null;
      this.circle = null;
      this.previousBody = null;
      this.lastVisibleBody = null;
      this.lastTime = null;
      this.done = false;
      this.lastResult = status('카메라에 상체를 보여 주세요.', 0, idleGrip());
    }

    setMode(mode) {
      if (mode !== 'pose' && mode !== 'circle') throw new RangeError('Unknown gesture mode');
      this.mode = mode;
      this.reset();
    }

    setPoseKind(kind) {
      if (!POSE_KINDS.includes(kind)) throw new RangeError('Unknown starter pose');
      this.poseKind = kind;
      this.reset();
    }

    cachedFrame(points, time, aspect) {
      const arc = this.circle, last = this.lastVisibleBody;
      if (arc?.angle == null || !last || time < last.time || time - last.time > 500) return null;
      const side = arc.arm.shoulder, other = side === LEFT.shoulder ? RIGHT.shoulder : LEFT.shoulder;
      if (visible(points?.[other], this.tuning.confidence)) return null;
      if (!wristAt(points, arc.arm) && time - arc.lastWristTime > WRIST_GRACE_MS) return null;
      // Only bridge a hidden opposite shoulder. The nose and active shoulder must
      // still describe the same participant in the same place as the measured frame.
      for (const i of [0, side]) {
        if (!visible(points?.[i], this.tuning.confidence) ||
            Math.hypot(points[i].x - last.points[i].x, (points[i].y - last.points[i].y) / aspect) > last.frame.span * 0.45) return null;
      }
      return last.frame;
    }

    update(landmarks, timestampMs, aspectRatio = 1) {
      if (this.done) return { ...this.lastResult, matched: false };
      if (!Number.isFinite(timestampMs) || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        this.reset();
        return this.lastResult;
      }
      const measured = bodyFrame(landmarks, aspectRatio, this.tuning.confidence);
      const frame = measured ?? this.cachedFrame(landmarks, timestampMs, aspectRatio);
      if (!frame) {
        this.reset();
        return status('얼굴과 양쪽 어깨가 화면에 보이도록 해 주세요.', 0, idleGrip());
      }
      if (timestampMs === this.lastTime) return { ...this.lastResult, matched: false };
      const gap = this.lastTime === null ? 0 : timestampMs - this.lastTime;
      if (gap < 0 || gap > this.tuning.maxFrameGapMs || discontinuous(this.previousBody, frame, aspectRatio)) this.reset();
      this.previousBody = frame;
      if (measured) this.lastVisibleBody = { frame, time: timestampMs, points: landmarks };
      this.lastTime = timestampMs;
      this.lastResult = this.mode === 'pose'
        ? this.followPose(landmarks, frame, timestampMs)
        : this.spinCircle(landmarks, frame, timestampMs, aspectRatio);
      this.done = this.lastResult.matched;
      return this.lastResult;
    }

    followPose(points, frame, time) {
      // Shoulder taps fit a cropped preview: both wrists and the upper-body
      // frame are sufficient even when the bent elbows are outside the image.
      const shoulderPose = this.poseKind === 'hands_near_shoulders';
      const wristConfidence = shoulderPose ? 0.45 :
        this.poseKind === 'arm_heart' ? this.tuning.confidence * 0.82 : this.tuning.confidence;
      const seen = (shoulderPose || [13, 14].every(i => visible(points[i], this.tuning.confidence))) &&
        [15, 16].every(i => visible(points[i], wristConfidence));
      const side = seen ? heldPose(this.poseKind, points, frame) : null;
      if (!side) {
        this.poseStart = null;
        this.heldSide = null;
        return status(seen ? POSE_HINTS[this.poseKind] : (shoulderPose ? '얼굴과 어깨, 양손이 화면에 보이도록 해 주세요.' : '얼굴과 양팔이 화면 안에 오도록 해 주세요.'));
      }
      if (side !== this.heldSide) { this.heldSide = side; this.poseStart = time; }
      const elapsed = time - this.poseStart;
      if (elapsed >= this.tuning.poseHoldMs) return status('자세를 확인했어요.', 100, { matched: true });
      return status('좋아요, 지금 자세를 유지해 주세요.', Math.floor(100 * elapsed / this.tuning.poseHoldMs));
    }

    spinCircle(points, frame, time, aspect) {
      const target = this.circle?.target ?? targetFor(frame, aspect);
      const restart = message => {
        this.circle = null;
        const next = targetFor(frame, aspect);
        return status(message, 0, { target: next, ...idleGrip(next) });
      };
      if (target.x - target.radius < 0 || target.x + target.radius > 1 ||
          target.y - target.radiusY < 0 || target.y + target.radiusY > 1) {
        return restart('안내 원 전체가 보이도록 조금 뒤로 물러나 주세요.');
      }
      if (this.circle && discontinuous(this.circle.body, frame, aspect)) return restart('몸을 가운데 두고 다시 준비해 주세요.');
      const startDistance = wrist => Math.hypot(wrist.x - target.startX, (wrist.y - target.startY) / aspect);
      if (!this.circle) {
        const candidates = [LEFT, RIGHT].map(arm => ({ arm, wrist: wristAt(points, arm) }))
          .filter(c => c.wrist).sort((a, b) => startDistance(a.wrist) - startDistance(b.wrist));
        if (!candidates.length || startDistance(candidates[0].wrist) > target.grabRadius) {
          return status('한 손을 화면 가운데 손잡이에 올려 주세요.', 0, { target, ...idleGrip(target) });
        }
        this.circle = { arm: candidates[0].arm, body: frame, target, startTime: time, angle: null,
          net: 0, direction: 0, furthest: 0, samples: 0, movingSince: null, lastMotionTime: time, lastWristTime: time };
      }
      const arc = this.circle;
      const wrist = wristAt(points, arc.arm);
      if (!wrist || arc.wristMissing) {
        if (arc.angle === null || time - arc.lastWristTime > WRIST_GRACE_MS) return restart('처음 올린 손이 화면에 보이도록 해 주세요.');
        if (!wrist) {
          arc.wristMissing = true;
          return { ...this.lastResult, message: '손이 다시 보이면 이어서 돌려 주세요.' };
        }
      }
      arc.lastWristTime = time;
      const dx = wrist.x - target.x, dy = (wrist.y - target.y) / aspect;
      const angle = Math.atan2(dy, dx);
      if (arc.angle === null) {
        if (startDistance(wrist) > target.grabRadius) return restart('시작점에서 손을 잠시 멈춰 주세요.');
        const held = time - arc.startTime;
        if (held >= this.tuning.startHoldMs) { arc.angle = angle; arc.lastMotionTime = time; }
        const progress = arc.angle === null ? held / this.tuning.startHoldMs : 1;
        return status(arc.angle === null ? '시작점에서 손을 잠시 멈춰 주세요.' : TURN_HINT,
          Math.floor(12 * progress), { target, grip: { ...wrist, held: arc.angle !== null, progress }, angleDeg: 0 });
      }
      const radiusRatio = Math.hypot(dx, dy) / target.radius;
      if (radiusRatio > 3.2) return restart('손잡이를 다시 잡아 주세요.');
      const feedback = { target, grip: { ...wrist, held: true, progress: 1 }, angleDeg: arc.net * 180 / Math.PI };
      const rejoined = arc.wristMissing;
      arc.wristMissing = false;
      if (radiusRatio < 0.15) {
        // Freeze the last reliable angle. Re-entering the ring on a different
        // side cannot silently reset the angular origin and bank repeated arcs.
        arc.inCenter = true;
        return status(TURN_HINT, Math.floor(clamp(12 + 88 * Math.abs(arc.net) / TURN_ANGLE, 12, 99)), feedback);
      }
      let step = wrapAngle(angle - arc.angle);
      if (arc.inCenter && Math.abs(step) > 0.34) return restart('손잡이를 다시 잡아 주세요.');
      arc.inCenter = false;
      const maxStep = Math.min(2.8, 0.65 + (time - arc.lastMotionTime) * 0.03);
      if (Math.abs(step) > maxStep) return restart('손잡이를 다시 잡고 한 방향으로 돌려 주세요.');
      // Freeze progress across a tracking gap. A wrist returning backwards
      // still unwinds the turn, so repeated short arcs cannot bank a full lap.
      if (rejoined && step * arc.direction >= 0) step = 0;
      if (Math.abs(step) >= 0.012 && arc.movingSince === null) arc.movingSince = arc.lastMotionTime;
      arc.angle = angle;
      arc.lastMotionTime = time;
      arc.net += step;
      if (Math.abs(step) >= 0.012) arc.samples++;
      if (!arc.direction && Math.abs(arc.net) >= 0.12) {
        arc.direction = Math.sign(arc.net);
      }
      const sweep = arc.net * arc.direction;
      arc.furthest = Math.max(arc.furthest, sweep);
      if (arc.furthest - sweep > 1.2) return restart('한 방향으로 계속 돌려 주세요.');
      const duration = arc.movingSince === null ? 0 : time - arc.movingSince;
      if (duration > 12000) return restart('가운데 손잡이를 다시 잡아 주세요.');
      feedback.angleDeg = arc.net * 180 / Math.PI;
      if (arc.direction) feedback.direction = arc.direction > 0 ? 'clockwise' : 'counterclockwise';
      if (sweep >= TURN_ANGLE - 1e-6 && arc.samples >= 4 && duration >= 250) {
        return status('성공! 룰렛이 돌아갑니다.', 100, { ...feedback, matched: true, speed: sweep * 1000 / duration });
      }
      return status(TURN_HINT, Math.floor(clamp(12 + 88 * sweep / TURN_ANGLE, 12, 99)), feedback);
    }
  }

  class MotionFlow {
    constructor(options = {}) {
      this.tuning = { ...DEFAULTS, ...options };
      this.detector = new GestureDetector(this.tuning);
      this.reset();
    }

    get poseKind() { return this.detector.poseKind; }

    setPoseKind(kind) {
      this.detector.setPoseKind(kind);
      this.reset();
    }

    reset() {
      this.mode = 'presence';
      this.anchor = null;
      this.previousBody = null;
      this.lastTime = null;
      this.presenceStart = null;
      this.done = false;
      this.lastResult = status('얼굴과 양쪽 어깨를 화면 가운데에 맞춰 주세요.', 0, { mode: 'presence', ...idleGrip() });
      this.detector.setMode('pose');
    }

    update(points, time, aspect = 1) {
      if (this.done) return { ...this.lastResult, matched: false };
      const frame = Number.isFinite(time) && Number.isFinite(aspect) && aspect > 0
        ? bodyFrame(points, aspect, this.tuning.confidence) ?? this.detector.cachedFrame(points, time, aspect) : null;
      if (!frame || frame.x < 0.25 || frame.x > 0.75 || frame.span < 0.08 || frame.span > 0.65 ||
          points[0].y < 0.05 || points[0].y > 0.60) {
        this.reset();
        return this.lastResult;
      }
      const gap = this.lastTime === null ? 0 : time - this.lastTime;
      if (gap < 0 || gap > this.tuning.maxFrameGapMs || discontinuous(this.previousBody, frame, aspect) ||
          (this.mode === 'presence' && discontinuous(this.anchor, frame, aspect))) {
        this.reset();
      }
      if (time === this.lastTime) return { ...this.lastResult, matched: false };
      this.lastTime = time;
      this.previousBody = frame;

      if (this.mode === 'presence') {
        this.anchor ??= frame;
        this.presenceStart ??= time;
        const held = time - this.presenceStart;
        if (held < this.tuning.presenceHoldMs) {
          const progress = Math.floor(100 * held / this.tuning.presenceHoldMs);
          this.lastResult = status('화면 가운데에서 2초 동안 기다려 주세요.', progress, { mode: this.mode, ...idleGrip() });
          return this.lastResult;
        }
        this.mode = 'pose';
        this.detector.setMode('pose');
      }

      let result = this.detector.update(points, time, aspect);
      if (this.mode === 'pose' && result.matched) {
        this.mode = 'circle';
        this.detector.setMode('circle');
        result = this.detector.update(points, time, aspect);
      }
      this.lastResult = { ...result, mode: this.mode };
      this.done = result.matched;
      return this.lastResult;
    }
  }

  const api = { GestureDetector, MotionFlow, POSE_KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.MotionGestures = api;
})();
