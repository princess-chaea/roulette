/* Camera acquisition and local Pose Landmarker inference. No video leaves the app. */
(() => {
  'use strict';
  const BASE = new URL('assets/vendor/mediapipe/', document.baseURI);
  const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]];
  const VISIBLE_POINTS = [11,12,13,14,15,16,23,24];
  const permissionMessage = error => ({
    NotAllowedError: '카메라 권한이 꺼져 있어요. 주소창의 카메라 권한을 허용한 뒤 다시 연결해 주세요.',
    NotFoundError: '연결된 카메라가 없어요. 카메라를 연결하거나 버튼으로 돌려 주세요.',
    NotReadableError: '다른 앱에서 카메라를 사용 중일 수 있어요. 해당 앱을 닫고 다시 연결해 주세요.',
    OverconstrainedError: '이 카메라에서는 요청한 영상을 사용할 수 없어요. 다른 카메라를 연결해 주세요.',
    SecurityError: '이 화면에서는 카메라가 차단됐어요. HTTPS 또는 localhost로 열어 주세요.'
  })[error?.name] || '카메라 또는 인식 모델을 준비하지 못했어요. 새로고침 후 다시 연결해 주세요. 수동 추첨도 사용할 수 있어요.';

  class MotionCamera {
    constructor({ video, canvas, onState, onResult, canRecognize }) {
      Object.assign(this, { video, canvas, onState, onResult, canRecognize });
      this.detector = new MotionGestures.GestureDetector();
      this.stream = null; this.engine = null; this.phase = 'stopped';
      this.active = false; this.sequence = 0; this.raf = null;
      this.lastTime = -Infinity; this.lastVideoTime = -1;
    }
    get running() { return this.phase === 'ready'; }
    get connecting() { return this.phase === 'connecting'; }
    state(phase, message) { this.phase = phase; this.onState({ phase, message }); }
    async start() {
      if (this.running || this.connecting) return;
      if (!globalThis.isSecureContext || location.protocol === 'file:' || !navigator.mediaDevices?.getUserMedia) {
        this.state('error', '카메라는 HTTPS 또는 localhost에서 사용할 수 있어요. 안내된 로컬 실행 파일로 열어 주세요.');
        return;
      }
      const sequence = ++this.sequence;
      this.state('connecting', '카메라 접근을 허용해 주세요.');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } });
        if (sequence !== this.sequence) { stream.getTracks().forEach(t => t.stop()); return; }
        this.stream = stream;
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
          if (this.stream === stream) this.stop('카메라 연결이 끝났어요. 다시 연결해 주세요.');
        }, { once: true }));
        this.video.srcObject = stream;
        await this.video.play();
        if (sequence !== this.sequence) return;
        this.onState({ phase: 'connecting', message: '기기 안에서 사용할 동작 인식 모델을 준비하고 있어요…' });
        if (!this.enginePromise) {
          const promise = this.createEngine();
          this.enginePromise = promise;
          promise.catch(() => { if (this.enginePromise === promise) this.enginePromise = null; });
        }
        const engine = await this.enginePromise;
        if (sequence !== this.sequence) return;
        this.engine = engine;
        this.lastVideoTime = -1; this.lastTime = -Infinity;
        this.state('ready', '연결됐어요! 동작 인식을 시작해 주세요.');
        this.loop();
      } catch (error) {
        if (sequence !== this.sequence) return;
        this.release(); this.state('error', permissionMessage(error));
      }
    }
    async createEngine() {
      const { FilesetResolver, PoseLandmarker } = await import(new URL('vision_bundle.mjs', BASE).href);
      const files = await FilesetResolver.forVisionTasks(new URL('wasm/', BASE).href.replace(/\/$/, ''));
      return PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: new URL('pose_landmarker_lite.task', BASE).href, delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 2,
        minPoseDetectionConfidence: .6, minPosePresenceConfidence: .6, minTrackingConfidence: .6,
        outputSegmentationMasks: false
      });
    }
    setMode(mode) { this.detector.setMode(mode); this.clearOverlay(); }
    setActive(active) { this.active = active; this.detector.reset(); if (!active) this.clearOverlay(); }
    loop() {
      if (!this.running) return;
      this.raf = requestAnimationFrame(() => this.loop());
      if (!this.active || !this.canRecognize() || this.video.readyState < 2) return;
      const time = performance.now();
      // New frames only, at most ~10 inferences/s. Inference pauses for the whole spin.
      if (time - this.lastTime < 95 || this.video.currentTime === this.lastVideoTime) return;
      this.lastTime = time; this.lastVideoTime = this.video.currentTime;
      try {
        const results = this.engine.detectForVideo(this.video, time);
        const multiple = results.landmarks.length > 1;
        const landmarks = results.landmarks.length === 1 ? results.landmarks[0] : null;
        const recognition = this.detector.update(landmarks, time, this.video.videoWidth / this.video.videoHeight);
        if (multiple) recognition.message = '한 명씩 화면 가운데 서 주세요.';
        this.draw(landmarks, recognition);
        this.onResult(recognition);
      } catch {
        this.release(); this.engine?.close(); this.engine = null; this.enginePromise = null;
        this.state('error', '영상 분석을 계속할 수 없어요. 카메라를 다시 연결하거나 버튼으로 돌려 주세요.');
      }
    }
    draw(points, result) {
      const width = this.video.videoWidth, height = this.video.videoHeight;
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      const ctx = this.canvas.getContext('2d'); ctx.clearRect(0, 0, width, height);
      const valid = p => p && (p.visibility ?? 1) >= .55 && (p.presence ?? 1) >= .55;
      const xy = p => [(1 - p.x) * width, p.y * height];
      if (points) {
        ctx.strokeStyle = '#d5f477'; ctx.fillStyle = '#d5f477'; ctx.lineWidth = Math.max(2, width / 160);
        ctx.shadowColor = '#173d35'; ctx.shadowBlur = 3;
        CONNECTIONS.forEach(([a, b]) => {
          if (!valid(points[a]) || !valid(points[b])) return;
          ctx.beginPath(); ctx.moveTo(...xy(points[a])); ctx.lineTo(...xy(points[b])); ctx.stroke();
        });
        VISIBLE_POINTS.forEach(index => { if (valid(points[index])) { ctx.beginPath(); ctx.arc(...xy(points[index]), width / 100, 0, Math.PI * 2); ctx.fill(); } });
        ctx.shadowBlur = 0;
      }
      if (result.target) {
        const t = result.target;
        ctx.lineWidth = width / 140; ctx.strokeStyle = '#ffffffcc'; ctx.setLineDash([width / 60, width / 60]);
        ctx.beginPath(); ctx.ellipse(t.x * width, t.y * height, t.radius * width, t.radiusY * height, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#f5d57a'; ctx.beginPath(); ctx.arc(t.startX * width, t.startY * height, width / 55, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#173d35'; ctx.font = `bold ${Math.max(12, width / 36)}px KERISBaeum,sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('시작', t.startX * width, t.startY * height - width / 30);
        if (result.progress > 12) {
          ctx.strokeStyle = '#d5f477'; ctx.lineWidth = width / 90;
          const reverse = result.direction === 'counterclockwise';
          const amount = (result.progress - 12) / 88 * Math.PI * (reverse ? -1 : 1);
          ctx.beginPath(); ctx.ellipse(t.x * width, t.y * height, t.radius * width, t.radiusY * height, 0, 0, amount, reverse); ctx.stroke();
        }
      }
    }
    clearOverlay() { const ctx = this.canvas.getContext('2d'); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    release() {
      this.active = false; this.detector.reset();
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
      this.video.pause(); this.video.srcObject = null; this.clearOverlay();
    }
    stop(message = '카메라가 꺼졌어요.') { ++this.sequence; this.release(); this.state('stopped', message); }
    dispose() {
      this.stop();
      if (this.enginePromise) this.enginePromise.then(engine => engine.close()).catch(() => {});
      this.engine = null; this.enginePromise = null;
    }
  }
  globalThis.MotionCamera = MotionCamera;
})();
