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
      this.detector = new MotionGestures.MotionFlow();
      this.gripImage = new Image();
      this.gripImage.src = new URL('../../art/ar-grip.png', BASE).href;
      this.stream = null; this.engine = null; this.phase = 'stopped';
      this.active = false; this.sequence = 0; this.raf = null;
      this.animationHost = globalThis;
      this.lastTime = -Infinity; this.lastVideoTime = -1;
    }
    get running() { return this.phase === 'ready'; }
    get connecting() { return this.phase === 'connecting'; }
    setPoseKind(kind) { this.detector.setPoseKind(kind); this.clearOverlay(); }
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
        this.state('ready', '연결됐어요! 화면 가운데에서 2초 동안 기다려 주세요.');
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
    setActive(active) { this.active = active; this.detector.reset(); if (!active) this.clearOverlay(); }
    setAnimationHost(host = globalThis) {
      if (this.raf !== null) this.animationHost.cancelAnimationFrame(this.raf);
      this.raf = null; this.animationHost = host;
      if (this.running) this.loop();
    }
    loop() {
      if (!this.running) return;
      this.raf = this.animationHost.requestAnimationFrame(() => this.loop());
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
      if (result.mode === 'presence') {
        ctx.strokeStyle = '#d5f477bb'; ctx.lineWidth = Math.max(2, width / 180); ctx.setLineDash([width / 40, width / 50]);
        ctx.strokeRect(width * .25, height * .07, width * .5, height * .73); ctx.setLineDash([]);
      }
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
        if (result.progress > 12) {
          ctx.strokeStyle = '#d5f477'; ctx.lineWidth = width / 90;
          const reverse = result.direction === 'counterclockwise';
          const amount = (result.progress - 12) / 88 * Math.PI * (reverse ? -1 : 1);
          ctx.beginPath(); ctx.ellipse(t.x * width, t.y * height, t.radius * width, t.radiusY * height, 0, 0, amount, reverse); ctx.stroke();
        }
        const grip = result.grip || { x: t.startX, y: t.startY, held: false, progress: 0 };
        const handX = (grip.held ? grip.x : t.startX) * width;
        const handY = (grip.held ? grip.y : t.startY) * height;
        // The original asset's base is fixed at the AR circle center; its gold
        // knob is aligned with the hand, so the crank rotates instead of floating.
        if (this.gripImage.complete && this.gripImage.naturalWidth) {
          const image = this.gripImage;
          const baseX = image.naturalWidth * .38, baseY = image.naturalHeight * .60;
          const knobX = image.naturalWidth * .745, knobY = image.naturalHeight * .315;
          const dx = handX - t.x * width, dy = handY - t.y * height;
          const scale = Math.hypot(dx, dy) / Math.hypot(knobX - baseX, knobY - baseY);
          ctx.save(); ctx.translate(t.x * width, t.y * height);
          ctx.rotate(Math.atan2(dy, dx) - Math.atan2(knobY - baseY, knobX - baseX));
          ctx.scale(scale, scale); ctx.drawImage(image, -baseX, -baseY); ctx.restore();
        }
        ctx.lineWidth = width / 125; ctx.strokeStyle = grip.held ? '#d5f477' : '#f5d57a';
        ctx.beginPath(); ctx.arc(handX, handY, width / 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (grip.held ? 1 : Math.max(.03, grip.progress || 0))); ctx.stroke();
        ctx.fillStyle = '#fffce6'; ctx.shadowColor = '#173d35'; ctx.shadowBlur = 4;
        ctx.font = `bold ${Math.max(12, width / 38)}px KERISBaeum,sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(grip.held ? '잡았어요! 같이 돌려요' : '손잡이에 손을 멈춰 주세요', handX, handY - width / 20);
        ctx.shadowBlur = 0;
      }
    }
    clearOverlay() { const ctx = this.canvas.getContext('2d'); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    release() {
      this.active = false; this.detector.reset();
      if (this.raf !== null) this.animationHost.cancelAnimationFrame(this.raf);
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
