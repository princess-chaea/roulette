/* Pure gesture recognition for a single MediaPipe pose. Timestamps are milliseconds. */
(() => {
  'use strict';
  const LEFT = { shoulder: 11, elbow: 13, wrist: 15 };
  const RIGHT = { shoulder: 12, elbow: 14, wrist: 16 };
  const POSE_KINDS = Object.freeze(['hands_up', 'arms_out', 'one_hand_up', 'arm_heart']);
  const POSE_HINTS = {
    hands_up: '양손을 머리 위로 들어 주세요.',
    arms_out: '양팔을 어깨 높이에서 양옆으로 펴 주세요.',
    one_hand_up: '한 손만 머리 위로 들어 주세요.',
    arm_heart: '팔꿈치를 양옆으로 펴고 머리 위에서 두 손을 모아 큰 하트를 만들어 주세요.'
  };
  const DEFAULTS = { confidence: 0.55, presenceHoldMs: 2000, poseHoldMs: 1000, startHoldMs: 250, maxFrameGapMs: 350 };
  const status = (message, progress = 0, extra = {}) => ({ message, progress, matched: false, ...extra });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

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
    return { x, y: shoulderY + height * 0.20, span, shoulderY, height };
  }

  function discontinuous(a, b, aspect) {
    if (!a) return false;
    const displacement = Math.hypot(a.x - b.x, (a.y - b.y) / aspect);
    return displacement > a.span * 0.50 || b.span / a.span < 0.72 || b.span / a.span > 1.38;
  }

  function targetFor(frame, aspect) {
    const radius = frame.span * 0.85;
    return { x: frame.x, y: frame.y, radius, radiusY: radius * aspect, startX: frame.x + radius, startY: frame.y };
  }

  function wristAt(points, arm, confidence) {
    if (!visible(points[arm.elbow], confidence) || !visible(points[arm.wrist], confidence)) return null;
    return { x: 1 - points[arm.wrist].x, y: points[arm.wrist].y };
  }

  function heldPose(kind, points, frame) {
    if (kind === 'arms_out') {
      const extended = [LEFT, RIGHT].every(arm => {
        const shoulder = points[arm.shoulder], elbow = points[arm.elbow], wrist = points[arm.wrist];
        const outward = Math.sign(shoulder.x - (1 - frame.x));
        return (elbow.x - shoulder.x) * outward >= frame.span * 0.20 &&
          (wrist.x - shoulder.x) * outward >= frame.span * 0.60 &&
          (wrist.x - elbow.x) * outward >= frame.span * 0.15 &&
          Math.abs(elbow.y - shoulder.y) <= frame.height * 0.25 &&
          Math.abs(wrist.y - shoulder.y) <= frame.height * 0.30;
      });
      return extended ? 'both' : null;
    }
    const aboveHead = arm => points[arm.wrist].y < points[0].y - frame.height * 0.10 &&
      points[arm.elbow].y <= frame.shoulderY + frame.height * 0.05;
    const leftUp = aboveHead(LEFT), rightUp = aboveHead(RIGHT);
    const wristGap = Math.abs(points[LEFT.wrist].x - points[RIGHT.wrist].x);
    if (kind === 'hands_up') return leftUp && rightUp && wristGap >= frame.span * 0.55 ? 'both' : null;
    if (kind === 'arm_heart') {
      const center = 1 - frame.x;
      const midWristX = (points[LEFT.wrist].x + points[RIGHT.wrist].x) / 2;
      const handsMeet = wristGap < frame.span * 0.55 && Math.abs(midWristX - center) <= frame.span * 0.35 &&
        Math.abs(points[LEFT.wrist].y - points[RIGHT.wrist].y) <= frame.height * 0.18;
      const elbowsWide = Math.abs(points[LEFT.elbow].x - points[RIGHT.elbow].x) >= frame.span * 1.2;
      const rounded = [LEFT, RIGHT].every(arm => {
        const shoulder = points[arm.shoulder], elbow = points[arm.elbow], wrist = points[arm.wrist];
        return (elbow.x - shoulder.x) * Math.sign(shoulder.x - center) > 0 &&
          elbow.y >= points[0].y - frame.height * 0.30 && elbow.y - wrist.y >= frame.height * 0.08;
      });
      return leftUp && rightUp && handsMeet && elbowsWide && rounded ? 'both' : null;
    }
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
      this.lastTime = null;
      this.done = false;
      this.lastResult = status('카메라에 상체를 보여 주세요.');
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

    update(landmarks, timestampMs, aspectRatio = 1) {
      if (this.done) return { ...this.lastResult, matched: false };
      if (!Number.isFinite(timestampMs) || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        this.reset();
        return this.lastResult;
      }
      const frame = bodyFrame(landmarks, aspectRatio, this.tuning.confidence);
      if (!frame) {
        this.reset();
        return status('얼굴과 양쪽 어깨가 화면에 보이도록 해 주세요.');
      }
      if (timestampMs === this.lastTime) return { ...this.lastResult, matched: false };
      const gap = this.lastTime === null ? 0 : timestampMs - this.lastTime;
      if (gap < 0 || gap > this.tuning.maxFrameGapMs || discontinuous(this.previousBody, frame, aspectRatio)) this.reset();
      this.previousBody = frame;
      this.lastTime = timestampMs;
      this.lastResult = this.mode === 'pose'
        ? this.followPose(landmarks, frame, timestampMs)
        : this.spinCircle(landmarks, frame, timestampMs, aspectRatio);
      this.done = this.lastResult.matched;
      return this.lastResult;
    }

    followPose(points, frame, time) {
      const seen = [0, 13, 14, 15, 16].every(i => visible(points[i], this.tuning.confidence));
      const side = seen ? heldPose(this.poseKind, points, frame) : null;
      if (!side) {
        this.poseStart = null;
        this.heldSide = null;
        return status(seen ? POSE_HINTS[this.poseKind] : '얼굴과 양팔이 화면 안에 오도록 해 주세요.');
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
        return status(message, 0, { target: targetFor(frame, aspect) });
      };
      if (target.x - target.radius < 0 || target.x + target.radius > 1 ||
          target.y - target.radiusY < 0 || target.y + target.radiusY > 1) {
        return restart('안내 원 전체가 보이도록 조금 뒤로 물러나 주세요.');
      }
      if (this.circle && discontinuous(this.circle.body, frame, aspect)) return restart('몸을 가운데 두고 다시 준비해 주세요.');
      const startDistance = wrist => Math.hypot(wrist.x - target.startX, (wrist.y - target.startY) / aspect);
      if (!this.circle) {
        const candidates = [LEFT, RIGHT].map(arm => ({ arm, wrist: wristAt(points, arm, this.tuning.confidence) }))
          .filter(c => c.wrist).sort((a, b) => startDistance(a.wrist) - startDistance(b.wrist));
        if (!candidates.length || startDistance(candidates[0].wrist) > target.radius * 0.34) {
          return status('한 손을 오른쪽 시작점에 올려 주세요.', 0, { target });
        }
        this.circle = { arm: candidates[0].arm, body: frame, target, startTime: time, angle: null,
          net: 0, direction: 0, furthest: 0, samples: 0, movingSince: null, lastMotionTime: time };
      }
      const arc = this.circle;
      const wrist = wristAt(points, arc.arm, this.tuning.confidence);
      if (!wrist) return restart('처음 올린 손이 화면에 보이도록 해 주세요.');
      const dx = wrist.x - target.x, dy = (wrist.y - target.y) / aspect;
      const angle = Math.atan2(dy, dx);
      if (arc.angle === null) {
        if (startDistance(wrist) > target.radius * 0.34) return restart('시작점에서 손을 잠시 멈춰 주세요.');
        const held = time - arc.startTime;
        if (held >= this.tuning.startHoldMs) { arc.angle = angle; arc.lastMotionTime = time; }
        return status(arc.angle === null ? '시작점에서 손을 잠시 멈춰 주세요.' : '같은 손으로 원을 따라 반 바퀴 돌려 주세요.',
          Math.min(12, Math.floor(12 * held / this.tuning.startHoldMs)), { target });
      }
      const radiusRatio = Math.hypot(dx, dy) / target.radius;
      if (radiusRatio < 0.65 || radiusRatio > 1.40) return restart('안내 원을 따라 다시 시작해 주세요.');
      const step = wrapAngle(angle - arc.angle);
      const maxStep = Math.min(1.10, 0.22 + (time - arc.lastMotionTime) * 0.014);
      if (Math.abs(step) > maxStep) return restart('손을 조금 더 천천히 움직여 주세요.');
      arc.angle = angle;
      arc.lastMotionTime = time;
      arc.net += step;
      if (Math.abs(step) >= 0.012) arc.samples++;
      if (!arc.direction && Math.abs(arc.net) >= 0.12) {
        arc.direction = Math.sign(arc.net);
        arc.movingSince = time;
      }
      const sweep = arc.net * arc.direction;
      arc.furthest = Math.max(arc.furthest, sweep);
      if (arc.furthest - sweep > 0.34) return restart('한 방향으로 계속 돌려 주세요.');
      const duration = arc.movingSince === null ? 0 : time - arc.movingSince;
      if (duration > 4500) return restart('오른쪽 시작점에서 다시 돌려 주세요.');
      const feedback = { target };
      if (arc.direction) feedback.direction = arc.direction > 0 ? 'clockwise' : 'counterclockwise';
      if (sweep >= Math.PI - 0.015) {
        if (arc.samples < 6 || duration < 250) return restart('손을 조금 더 천천히 움직여 주세요.');
        return status('성공! 룰렛이 돌아갑니다.', 100, { ...feedback, matched: true, speed: sweep * 1000 / duration });
      }
      return status('같은 손으로 원을 따라 반 바퀴 돌려 주세요.', Math.floor(clamp(12 + 88 * sweep / Math.PI, 12, 99)), feedback);
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
      this.lastResult = status('얼굴과 양쪽 어깨를 화면 가운데에 맞춰 주세요.', 0, { mode: 'presence' });
      this.detector.setMode('pose');
    }

    update(points, time, aspect = 1) {
      if (this.done) return { ...this.lastResult, matched: false };
      const frame = Number.isFinite(time) && Number.isFinite(aspect) && aspect > 0
        ? bodyFrame(points, aspect, this.tuning.confidence) : null;
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
          this.lastResult = status('화면 가운데에서 2초 동안 기다려 주세요.', progress, { mode: this.mode });
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
