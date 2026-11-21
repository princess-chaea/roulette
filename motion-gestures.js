/* Pure gesture recognition for a single MediaPipe pose. Timestamps are milliseconds. */
(() => {
  'use strict';
  const LEFT = { shoulder: 11, elbow: 13, wrist: 15 };
  const RIGHT = { shoulder: 12, elbow: 14, wrist: 16 };
  const POSE_KINDS = Object.freeze(['hands_up', 'hands_near_shoulders', 'one_hand_up', 'arm_heart']);
  const POSE_HINTS = {
    hands_up: '양손을 머리 위로 들어 주세요.',
    hands_near_shoulders: '두 손을 양쪽 어깨 가까이에 올려 주세요.',
    one_hand_up: '한 손만 이마나 머리 위로 들어 주세요.',
    arm_heart: '머리 위로 양팔을 둥글게 들어 주세요. 손끝이 닿지 않아도 돼요.'
  };
  const PRESENCE_HINT = '화면 가운데에서 1초 동안 기다려 주세요.';
  const DEFAULTS = { confidence: 0.55, presenceHoldMs: 1000, poseHoldMs: 1000, startHoldMs: 150, maxFrameGapMs: 350 };
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
    // Keep the same reference scale when the lower body enters or leaves the image.
    const shoulderScale = span * aspect;
    const height = clamp((shoulderY - nose.y) * 2.7, shoulderScale * 0.7, shoulderScale * 2);
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

  // Bag straps can be interpreted as wrists touching the torso. Reject a
  // collapsed arm when acquiring the grip; don't require the elbow to
  // remain visible once the participant is actually turning.
  function gripWrist(points, arm, frame, aspect) {
    const wrist = points?.[arm.wrist], shoulder = points?.[arm.shoulder], elbow = points?.[arm.elbow];
    if (!visible(wrist, .45) || !visible(shoulder, .55)) return null;
    const separation = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) / aspect) / frame.span;
    const reach = separation(wrist, shoulder);
    if (reach < .24 || reach > 3.1) return null;
    if (visible(elbow, .45) && separation(wrist, elbow) < .08 && reach < .40) return null;
    return wristAt(points, arm);
  }

  // Estimate the centre from the user's own sweep. A break starts a new
  // observed stroke: neither its distance nor its angle crosses an unseen gap.
  function trackFreeSweep(trace, wrist, aspect, time) {
    const point = { x: wrist.x, y: wrist.y / aspect, time, afterGap: trace.afterGap };
    const points = trace.points, last = points[points.length - 1];
    if (last && !point.afterGap && Math.hypot(point.x - last.x, point.y - last.y) < 0.012) return null;
    trace.afterGap = false;
    points.push(point);
    if (points.length > 192) points.shift();
    if (point.afterGap || points.length < 7) return null;
    const whole = measureSweep(points);
    if (whole?.matched) return whole;
    // The participant may reach from the handle to their own starting point.
    // Try recent strokes as well so that this lead-in cannot skew the centre.
    const stride = Math.max(3, Math.ceil(points.length / 12));
    for (let start = 1; start <= points.length - 7; start += stride) {
      const recent = measureSweep(points.slice(start));
      if (recent?.matched) return recent;
    }
    return whole;
  }

  function measureSweep(points) {
    const point = points[points.length - 1];
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const left = Math.min(...xs), top = Math.min(...ys);
    const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    if (width < 0.12 || height < 0.10) return null;
    const diameter = Math.max(width, height), cx = left + width / 2, cy = top + height / 2;
    let net = 0, turns = 0, distance = 0, duration = 0, twiceArea = 0, interrupted = false;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (b.afterGap) { interrupted = true; continue; }
      const step = wrapAngle(Math.atan2(b.y - cy, b.x - cx) - Math.atan2(a.y - cy, a.x - cx));
      net += step;
      turns += Math.abs(step);
      twiceArea += (a.x - cx) * (b.y - cy) - (a.y - cy) * (b.x - cx);
      distance += Math.hypot(b.x - a.x, b.y - a.y);
      duration += Math.max(0, b.time - a.time);
    }
    const winding = Math.abs(net);
    if (winding < turns * 0.72 || Math.abs(twiceArea) < 0.35 * width * height) return null;
    const first = points[0], closure = Math.hypot(point.x - first.x, point.y - first.y);
    const required = 260 * Math.PI / 180;
    // Short occlusions can hide much of a wide swing's travelled distance.
    // Winding, closure and area still require visible motion around the loop.
    const fraction = Math.min(winding / required, distance / ((interrupted ? 1.7 : 2.15) * diameter));
    return { fraction, net, speed: winding * 1000 / Math.max(1, duration),
      matched: fraction >= 1 && closure <= 0.50 * diameter && duration >= 200 };
  }

  function heldPose(kind, points, frame, weakWrist = false) {
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
      const wristGap = Math.abs(leftWrist.x - rightWrist.x);
      const wristCenter = Math.abs((leftWrist.x + rightWrist.x) / 2 - center);
      const crossed = (leftWrist.x - rightWrist.x) *
        (points[LEFT.shoulder].x - points[RIGHT.shoulder].x) < 0 &&
        wristGap > frame.span * .16;
      // A round arch is enough: hands can be separated and uneven, including
      // at forehead height. An upright raised arm does not bend inward.
      const noseY = points[0].y;
      if (crossed || wristGap > frame.span * 1.12 || wristCenter > frame.span * .52 ||
          Math.abs(leftWrist.y - rightWrist.y) > frame.shoulderScale * .60 ||
          Math.max(leftWrist.y, rightWrist.y) > noseY + frame.shoulderScale * .20 ||
          (leftWrist.y + rightWrist.y) / 2 > noseY + frame.shoulderScale * .08) return null;
      const elbows = [LEFT, RIGHT].filter(arm => visible(points[arm.elbow], .34));
      const round = (arm, strict = false) => {
        const shoulder = points[arm.shoulder], elbow = points[arm.elbow], wrist = points[arm.wrist];
        const outward = Math.sign(shoulder.x - center);
        return (elbow.x - center) * outward >= frame.span * (strict ? .60 : .38) &&
          (elbow.x - wrist.x) * outward >= frame.span * (strict ? .28 : .13) &&
          elbow.y <= shoulder.y + frame.shoulderScale * .35 &&
          elbow.y >= wrist.y - frame.shoulderScale * .20;
      };
      if (elbows.length === 2) {
        return Math.abs(points[LEFT.elbow].x - points[RIGHT.elbow].x) >= frame.span * .95 &&
          elbows.every(arm => round(arm)) ? 'both' : null;
      }
      // One elbow can briefly be hidden if the other arc and both hands still
      // give a strong shape; two invisible elbows cannot prove an arm heart.
      return elbows.length === 1 && wristGap <= frame.span * .76 && wristCenter <= frame.span * .30 &&
        round(elbows[0], true) ? 'both' : null;
    }
    if (kind === 'one_hand_up') {
      const noseY = points[0].y, scale = frame.shoulderScale, center = 1 - frame.x;
      const lifted = (arm, other) => {
        const wrist = points[arm.wrist], elbow = points[arm.elbow];
        if (!visible(wrist, weakWrist ? .30 : .43)) return false;
        const outward = Math.sign(points[arm.shoulder].x - center);
        const handAtSide = (wrist.x - center) * outward > frame.span * .12;
        const elbowSeen = visible(elbow, .35);
        const high = wrist.y <= noseY - scale * .08 && (wrist.x - center) * outward > frame.span * -.20 &&
          (!elbowSeen || elbow.y <= frame.shoulderY + scale * .38);
        const salute = wrist.y <= noseY + scale * .15 && handAtSide && elbowSeen &&
          (elbow.x - center) * outward >= frame.span * .47 &&
          (elbow.x - wrist.x) * outward >= frame.span * .13 &&
          elbow.y <= frame.shoulderY + scale * .34;
        if (!high && !salute) return false;
        const offHand = points[other.wrist], offElbow = points[other.elbow];
        if (visible(offHand, .38)) return offHand.y > noseY + scale * .15;
        // The lowered arm may be below frame; visible evidence of a raised
        // opposite elbow/hand still rejects a two-arm gesture.
        if (offHand && Number.isFinite(offHand.y) && offHand.y <= noseY + scale * .10 &&
            Math.min(offHand.visibility ?? 1, offHand.presence ?? 1) >= .35) return false;
        return !visible(offElbow, .38) || offElbow.y > frame.shoulderY + scale * .03;
      };
      if (lifted(LEFT, RIGHT)) return 'left';
      if (lifted(RIGHT, LEFT)) return 'right';
      return null;
    }
    const aboveHead = arm => points[arm.wrist].y < points[0].y - frame.height * 0.10 &&
      points[arm.elbow].y <= frame.shoulderY + frame.height * 0.05;
    const wristGap = Math.abs(points[LEFT.wrist].x - points[RIGHT.wrist].x);
    return aboveHead(LEFT) && aboveHead(RIGHT) && wristGap >= frame.span * 0.55 ? 'both' : null;
  }

  class GestureDetector {
    constructor(options = {}) {
      this.tuning = { ...DEFAULTS, ...options };
      this.mode = 'pose';
      this.setPoseKind(options.poseKind ?? 'hands_up');
    }

    reset() {
      this.poseHeldMs = 0;
      this.lastPoseTime = null;
      this.lastStrongWrist = null;
      this.lastPoseWeak = false;
      this.heldSide = null;
      this.circle = null;
      this.previousBody = null;
      this.lastVisibleBody = null;
      this.lastTime = null;
      this.done = false;
      this.lastResult = status('카메라에 상체를 보여 주세요.', 0, idleGrip());
    }

    interrupt(message, trackingLost = true) {
      if (!this.tuning.retainProgress) this.reset();
      else {
        this.lastPoseTime = null;
        this.lastStrongWrist = null;
        this.lastPoseWeak = false;
        this.lastTime = null;
        this.previousBody = null;
        this.lastVisibleBody = null;
        if (this.circle?.angle != null) {
          this.circle.rebase = true;
          if (trackingLost && this.circle.trace) this.circle.trace.afterGap = true;
        }
        else if (this.circle) {
          this.circle = null;
          const target = this.lastResult.target;
          this.lastResult = status(message, 0, { target, ...idleGrip(target) });
        }
      }
      this.lastResult = { ...this.lastResult, message, matched: false };
      return this.lastResult;
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

    update(landmarks, timestampMs, aspectRatio = 1, bodyConfidence = this.tuning.confidence) {
      if (this.done) return { ...this.lastResult, matched: false };
      if (!Number.isFinite(timestampMs) || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
        return this.interrupt('카메라에 상체를 보여 주세요.');
      }
      const measured = bodyFrame(landmarks, aspectRatio, bodyConfidence);
      const frame = measured ?? this.cachedFrame(landmarks, timestampMs, aspectRatio);
      if (!frame) {
        return this.interrupt('얼굴과 양쪽 어깨가 화면에 보이도록 해 주세요.');
      }
      if (timestampMs === this.lastTime) return { ...this.lastResult, matched: false };
      const gap = this.lastTime === null ? 0 : timestampMs - this.lastTime;
      if (gap < 0 || gap > this.tuning.maxFrameGapMs || discontinuous(this.previousBody, frame, aspectRatio)) {
        this.interrupt('다시 보이는 위치에서 이어서 진행해요.');
      }
      this.previousBody = frame;
      if (measured) this.lastVisibleBody = { frame, time: timestampMs, points: landmarks };
      this.lastTime = timestampMs;
      const previous = this.lastResult;
      this.lastResult = this.mode === 'pose'
        ? this.followPose(landmarks, frame, timestampMs)
        : this.spinCircle(landmarks, frame, timestampMs, aspectRatio);
      if (this.mode === 'circle' && this.circle?.trace) {
        const arc = this.circle, wrist = wristAt(landmarks, arc.arm);
        const sweep = wrist && trackFreeSweep(arc.trace, wrist, aspectRatio, timestampMs);
        if (sweep && !this.lastResult.matched) {
          const progress = Math.floor(clamp(12 + 88 * sweep.fraction, 12, 95));
          if (sweep.matched || progress > Math.max(previous.progress, this.lastResult.progress)) {
            this.lastResult = status(sweep.matched ? '성공! 룰렛이 돌아갑니다.' : TURN_HINT,
              sweep.matched ? 100 : progress, { target: arc.target, grip: { ...wrist, held: true, progress: 1 },
                angleDeg: sweep.net * 180 / Math.PI, direction: sweep.net > 0 ? 'clockwise' : 'counterclockwise',
                matched: sweep.matched, speed: sweep.speed });
          }
        }
        if (!this.lastResult.matched && this.lastResult.progress < previous.progress) {
          this.lastResult = { ...this.lastResult, progress: previous.progress, angleDeg: previous.angleDeg,
            direction: previous.direction };
        }
      }
      this.done = this.lastResult.matched;
      return this.lastResult;
    }

    followPose(points, frame, time) {
      const kind = this.poseKind;
      const handSeen = [15, 16].map(i => visible(points[i], kind === 'hands_up' ? this.tuning.confidence : .43));
      const seen = kind === 'one_hand_up' ? handSeen.some(Boolean) :
        handSeen.every(Boolean) && (kind === 'hands_up' ?
          [13, 14].every(i => visible(points[i], this.tuning.confidence)) :
          kind !== 'arm_heart' || [13, 14].some(i => visible(points[i], .34)));
      const side = seen ? heldPose(kind, points, frame) : null;
      if (!side) {
        if (kind === 'one_hand_up' && this.lastPoseTime !== null && this.lastStrongWrist &&
            !this.lastPoseWeak && heldPose(kind, points, frame, true) === this.heldSide) {
          const wrist = points[this.heldSide === 'left' ? LEFT.wrist : RIGHT.wrist];
          const stable = Math.hypot((wrist.x - this.lastStrongWrist.x) / frame.span,
            (wrist.y - this.lastStrongWrist.y) / frame.shoulderScale) <= .30;
          if (stable) {
            // One low-confidence but still visible sample can bridge to the
            // next strong sample. It adds no time by itself.
            this.lastPoseTime = time; this.lastPoseWeak = true;
            return status('좋아요, 지금 자세를 유지해 주세요.', Math.floor(100 * this.poseHeldMs / this.tuning.poseHoldMs));
          }
        }
        this.lastPoseTime = null; this.lastStrongWrist = null; this.lastPoseWeak = false;
        if (!this.tuning.retainProgress) { this.heldSide = null; this.poseHeldMs = 0; }
        return status(seen ? POSE_HINTS[kind] : kind === 'one_hand_up' ? '들어 올린 손과 얼굴이 화면에 보이게 해 주세요.' :
          kind === 'hands_near_shoulders' ? '얼굴과 어깨, 양손이 화면에 보이도록 해 주세요.' : '얼굴과 양팔이 화면 안에 오도록 해 주세요.',
          Math.floor(100 * this.poseHeldMs / this.tuning.poseHoldMs));
      }
      if (side !== this.heldSide) { this.heldSide = side; this.poseHeldMs = 0; }
      else if (this.lastPoseTime !== null) this.poseHeldMs += time - this.lastPoseTime;
      this.lastPoseTime = time; this.lastPoseWeak = false;
      this.lastStrongWrist = kind === 'one_hand_up' ? points[side === 'left' ? LEFT.wrist : RIGHT.wrist] : null;
      if (this.poseHeldMs >= this.tuning.poseHoldMs) return status('자세를 확인했어요.', 100, { matched: true });
      return status('좋아요, 지금 자세를 유지해 주세요.', Math.floor(100 * this.poseHeldMs / this.tuning.poseHoldMs));
    }

    spinCircle(points, frame, time, aspect) {
      const target = this.circle?.target ?? targetFor(frame, aspect);
      const restart = message => {
        if (this.tuning.retainProgress && this.circle?.angle != null) return this.interrupt(TURN_HINT, false);
        this.circle = null;
        const next = targetFor(frame, aspect);
        return status(message, 0, { target: next, ...idleGrip(next) });
      };
      if (target.x - target.radius < 0 || target.x + target.radius > 1 ||
          target.y - target.radiusY < 0 || target.y + target.radiusY > 1) {
        return restart('안내 원 전체가 보이도록 조금 뒤로 물러나 주세요.');
      }
      if (this.circle && !this.circle.rebase && discontinuous(this.circle.body, frame, aspect)) return restart('몸을 가운데 두고 다시 준비해 주세요.');
      const startDistance = wrist => Math.hypot(wrist.x - target.startX, (wrist.y - target.startY) / aspect);
      if (!this.circle) {
        const candidates = [LEFT, RIGHT].map(arm => ({ arm, wrist: gripWrist(points, arm, frame, aspect) }))
          .filter(c => c.wrist).sort((a, b) => startDistance(a.wrist) - startDistance(b.wrist));
        if (!candidates.length || startDistance(candidates[0].wrist) > target.grabRadius) {
          return status('한 손을 화면 가운데 손잡이에 올려 주세요.', 0, { target, ...idleGrip(target) });
        }
        this.circle = { arm: candidates[0].arm, body: frame, target, startTime: time, angle: null,
          net: 0, direction: 0, furthest: 0, samples: 0, movingSince: null, lastMotionTime: time, lastWristTime: time };
      }
      const arc = this.circle;
      const wrist = arc.angle === null ? gripWrist(points, arc.arm, frame, aspect) : wristAt(points, arc.arm);
      if (!wrist && this.tuning.retainProgress && arc.angle !== null) {
        return this.interrupt('같은 손이 다시 보이면 이어서 돌려 주세요.');
      }
      if (arc.rebase) {
        if (!wrist) return this.interrupt('같은 손이 다시 보이면 이어서 돌려 주세요.');
        const dx = wrist.x - target.x, dy = (wrist.y - target.y) / aspect;
        const radiusRatio = Math.hypot(dx, dy) / target.radius;
        if (radiusRatio < 0.15 || radiusRatio > 3.2) return this.interrupt(TURN_HINT, false);
        // A returning wrist establishes a new reference angle. Only subsequent
        // motion can advance the retained turn, even after a long camera gap.
        if (arc.movingSince !== null) arc.movingSince += time - arc.lastMotionTime;
        arc.rebase = arc.inCenter = arc.wristMissing = false;
        arc.body = frame;
        arc.angle = Math.atan2(dy, dx);
        arc.lastWristTime = arc.lastMotionTime = time;
        return { ...this.lastResult, matched: false, message: TURN_HINT, grip: { ...wrist, held: true, progress: 1 } };
      }
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
        if (held >= this.tuning.startHoldMs) {
          arc.angle = angle;
          arc.lastMotionTime = time;
          if (this.tuning.retainProgress) arc.trace = { points: [], afterGap: false };
        }
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
      if (arc.direction && arc.furthest - (arc.net + step) * arc.direction > 1.2) return restart('한 방향으로 계속 돌려 주세요.');
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
      const duration = arc.movingSince === null ? 0 : time - arc.movingSince;
      if (!this.tuning.retainProgress && duration > 12000) return restart('가운데 손잡이를 다시 잡아 주세요.');
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
      this.detector = new GestureDetector({ ...this.tuning, retainProgress: true });
      this.reset();
    }

    get poseKind() { return this.detector.poseKind; }
    get crankShoulder() {
      const arc = this.detector.circle;
      return this.mode === 'circle' && arc && arc.angle !== null ? arc.arm.shoulder : null;
    }
    needsDetail(points) {
      if (this.mode !== 'circle') return false;
      const shoulder = this.crankShoulder;
      return shoulder !== null
        ? !wristAt(points, shoulder === LEFT.shoulder ? LEFT : RIGHT)
        : !wristAt(points, LEFT) && !wristAt(points, RIGHT);
    }
    get waitingForFirstGesture() { return this.mode === 'pose' && this.detector.poseHeldMs === 0; }

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

    update(points, time, aspect = 1, continuityConfidence) {
      const bodyConfidence = (this.mode === 'pose' || this.crankShoulder !== null) && Number.isFinite(continuityConfidence)
        ? clamp(continuityConfidence, .42, this.tuning.confidence) : this.tuning.confidence;
      if (this.done) return { ...this.lastResult, matched: false };
      const frame = Number.isFinite(time) && Number.isFinite(aspect) && aspect > 0
        ? bodyFrame(points, aspect, bodyConfidence) ?? this.detector.cachedFrame(points, time, aspect) : null;
      if (!frame || frame.x < 0.25 || frame.x > 0.75 || frame.span < 0.08 || frame.span > 0.65 ||
          points[0].y < 0.05 || points[0].y > 0.60) {
        if (this.mode === 'presence') this.reset();
        else {
          this.lastTime = null;
          this.previousBody = null;
          const paused = this.detector.interrupt('다시 화면 가운데로 오면 이어서 진행해요.');
          this.lastResult = { ...paused, mode: this.mode };
        }
        return this.lastResult;
      }
      const gap = this.lastTime === null ? 0 : time - this.lastTime;
      if (gap < 0 || gap > this.tuning.maxFrameGapMs || discontinuous(this.previousBody, frame, aspect) ||
          (this.mode === 'presence' && discontinuous(this.anchor, frame, aspect))) {
        if (this.mode === 'presence') this.reset();
        else this.detector.interrupt('다시 보이는 위치에서 이어서 진행해요.');
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
          this.lastResult = status(PRESENCE_HINT, progress, { mode: this.mode, ...idleGrip() });
          return this.lastResult;
        }
        this.mode = 'pose';
        this.detector.setMode('pose');
      }

      let result = this.detector.update(points, time, aspect, bodyConfidence);
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

  const api = { GestureDetector, MotionFlow, POSE_KINDS, PRESENCE_HINT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.MotionGestures = api;
})();
