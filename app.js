(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const math = globalThis.RouletteMath;
  const presentation = globalThis.RoulettePresentation;
  const assetPath = path => path;
  const STORAGE_KEY = 'motion-roulette-prototype-v1';
  const COLORS = ['#f1aa91', '#f5d57a', '#91c7b4', '#c1b6e4', '#a8c8e5', '#e4b5d0'];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const initialState = () => ({
    version: 1,
    title: '우리 반 행운 뽑기',
    mode: 'pose', wheelLayout: 'grouped',
    prizes: ['블루투스 스피커', '문구 세트', '간식 꾸러미', '달콤한 초콜릿'].map((name, index) => ({ id: crypto.randomUUID(), name, quantity: [1, 3, 6, 10][index], rank: index + 1 })),
    history: [], pending: null
  });
  let storageOK = true;
  function validState(value) {
    return value && value.version === 1 && typeof value.title === 'string' && value.title.length <= 40 && ['pose', 'circle'].includes(value.mode) &&
      (value.wheelLayout === undefined || ['grouped', 'split'].includes(value.wheelLayout)) &&
      Array.isArray(value.prizes) && value.prizes.length > 0 && value.prizes.length <= 12 &&
      value.prizes.every((p, i) => typeof p.id === 'string' && typeof p.name === 'string' && p.name.length <= 40 && p.rank === i + 1 && Number.isInteger(p.quantity) && p.quantity >= 0 && p.quantity <= 999) &&
      new Set(value.prizes.map(p => p.id)).size === value.prizes.length &&
      Array.isArray(value.history) && value.history.every(h => typeof h.id === 'string' && typeof h.name === 'string' && typeof h.prize === 'string' && Number.isInteger(h.rank)) &&
      (value.pending === null || (typeof value.pending === 'object' && typeof value.pending.id === 'string' && typeof value.pending.name === 'string' && typeof value.pending.prizeId === 'string' && typeof value.pending.prize === 'string' && Number.isInteger(value.pending.rank) && value.prizes.some(p => p.id === value.pending.prizeId && p.quantity > 0)));
  }
  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return initialState();
      const parsed = JSON.parse(data);
      if (validState(parsed)) { parsed.wheelLayout ??= 'grouped'; return parsed; }
      storageOK = false;
    } catch { storageOK = false; }
    return initialState();
  }
  let state = load();
  let busy = false;
  let rotation = 0;
  let completedRound = false;
  let lastResult = null;
  let currentStage = 'presence';
  let gripRotationBase = null;
  let camera;
  const firstPrizeMode = new FirstPrizeMode();
  function renderOperatorMode() {
    $('organization-mode').classList.toggle('first-prize-armed', firstPrizeMode.armed);
    $('organization-mode').setAttribute('aria-pressed', String(firstPrizeMode.armed));
  }

  function save() {
    if (!validState(state)) {
      $('save-status').textContent = '상품 개수를 올바르게 입력하면 저장돼요.';
      return;
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageOK = true; }
    catch { storageOK = false; }
    updateSaveStatus();
  }
  function updateSaveStatus() {
    $('save-status').textContent = storageOK ? '✓ 이 기기에 자동 저장돼요' : '저장할 수 없어요. 이 창을 닫으면 설정과 기록이 사라질 수 있어요.';
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name); svg.append(use); return svg;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function color(prize) { return COLORS[(prize.rank - 1) % COLORS.length]; }
  function inputError() {
    if (state.prizes.some(p => !p.name.trim())) return '상품 이름을 모두 입력해 주세요.';
    if (state.prizes.some(p => !Number.isInteger(p.quantity) || p.quantity < 0 || p.quantity > 999)) return '개수는 0~999 사이의 정수로 입력해 주세요.';
    return '';
  }
  function getError() {
    return inputError() || (!math.total(state.prizes) ? '남은 상품이 없어요. 상품 개수를 추가해 주세요.' : '');
  }
  function updateSummary() {
    const total = math.total(state.prizes);
    $('total-pill').textContent = '총 ' + total + '개';
    $('remaining-pill').textContent = total + '개 남음';
    $('validation-message').textContent = getError();
    $('add-prize').disabled = state.prizes.length >= 12;
    document.querySelectorAll('[data-delete]').forEach(button => button.disabled = state.prizes.length === 1);
    $('history-count').textContent = state.history.length;
  }
  function renderEditor() {
    $('event-title').value = state.title;
    document.querySelectorAll('[name=wheel-layout]').forEach(input => { input.checked = input.value === state.wheelLayout; });
    $('prize-rows').replaceChildren();
    state.prizes.forEach(prize => {
      const row = el('div', 'prize-row');
      const badge = el('span', 'rank-badge', prize.rank + '등');
      badge.style.setProperty('--rank-color', color(prize));
      const name = el('input', 'prize-name');
      name.value = prize.name; name.maxLength = 40;
      name.setAttribute('aria-label', prize.rank + '등 상품명');
      name.addEventListener('input', () => { prize.name = name.value; changed(); });
      const quantity = el('div', 'quantity-control');
      const input = el('input');
      input.type = 'number'; input.min = '0'; input.max = '999'; input.step = '1'; input.value = prize.quantity;
      input.setAttribute('aria-label', prize.rank + '등 상품 개수');
      input.addEventListener('input', () => {
        prize.quantity = input.value === '' ? NaN : Number(input.value);
        input.setAttribute('aria-invalid', String(!Number.isInteger(prize.quantity) || prize.quantity < 0 || prize.quantity > 999));
        changed();
      });
      const minus = el('button', '', '−'); minus.type = 'button'; minus.setAttribute('aria-label', prize.rank + '등 상품 개수 줄이기');
      const plus = el('button', '', '+'); plus.type = 'button'; plus.setAttribute('aria-label', prize.rank + '등 상품 개수 늘리기');
      const adjust = amount => {
        prize.quantity = Math.min(999, Math.max(0, (Number.isInteger(prize.quantity) ? prize.quantity : 0) + amount));
        input.value = prize.quantity; input.setAttribute('aria-invalid', 'false'); changed();
      };
      minus.addEventListener('click', () => adjust(-1)); plus.addEventListener('click', () => adjust(1));
      quantity.append(minus, input, plus);
      const remove = el('button', 'remove-prize'); remove.type = 'button';
      remove.dataset.delete = prize.id; remove.setAttribute('aria-label', prize.rank + '등 상품 삭제'); remove.append(icon('trash'));
      remove.addEventListener('click', () => {
        state.prizes = state.prizes.filter(p => p.id !== prize.id).map((p, i) => ({ ...p, rank: i + 1 }));
        renderEditor(); changed();
      });
      row.append(badge, name, quantity, remove); $('prize-rows').append(row);
    });
    updateSummary();
  }
  function svgNode(tag, attrs = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function point(angle, radius = 290) {
    const rad = (angle - 90) * Math.PI / 180;
    return [300 + radius * Math.cos(rad), 300 + radius * Math.sin(rad)];
  }
  function renderWheel(containerId) {
    const svg = svgNode('svg', { viewBox: '0 0 600 600', role: 'img', 'aria-label': '남은 상품 개수에 비례한 경품 룰렛' });
    const options = math.visualSegments(state.prizes, state.wheelLayout);
    options.forEach(segment => {
      const [x1, y1] = point(segment.start), [x2, y2] = point(segment.end);
      const shape = segment.end - segment.start >= 359.99
        ? svgNode('circle', { cx: 300, cy: 300, r: 290, fill: color(segment) })
        : svgNode('path', { d: `M300 300L${x1} ${y1}A290 290 0 ${segment.end - segment.start > 180 ? 1 : 0} 1 ${x2} ${y2}Z`, fill: color(segment), stroke: '#fffdf2', 'stroke-width': 2 });
      shape.setAttribute('data-prize-id', segment.id);
      shape.setAttribute('data-slice-key', segment.sliceKey);
      shape.append(svgNode('title', {}, `${segment.rank}등 ${segment.name}: ${(segment.probability * 100).toFixed(1)}%`));
      svg.append(shape);
      const [x, y] = point(segment.midpoint, 190);
      const label = svgNode('text', { x, y: y - (segment.probability < .08 ? 0 : 12), 'text-anchor': 'middle', 'font-size': segment.probability < .08 ? 15 : 18, 'font-weight': 700 });
      label.textContent = segment.rank + '등';
      if (segment.probability >= .08) {
        const displayed = segment.name.length > 9 ? segment.name.slice(0, 8) + '…' : segment.name;
        label.append(svgNode('tspan', { x, dy: 29, 'font-size': 17, 'font-weight': 500 }, displayed));
        label.append(svgNode('tspan', { x, dy: 26, 'font-size': 14, 'font-weight': 400, opacity: .7 }, segment.quantity + '개'));
      }
      svg.append(label);
    });
    if (!options.length) svg.append(svgNode('text', { x: 300, y: 170, 'text-anchor': 'middle', 'font-size': 22 }, '상품을 추가해 주세요'));
    $(containerId).replaceChildren(svg);
  }
  function renderLegends() {
    const options = math.segments(state.prizes);
    ['preview-legend', 'draw-legend'].forEach(id => {
      $(id).replaceChildren();
      state.prizes.forEach(prize => {
        const item = el('div', 'legend-item');
        const dot = el('span', 'legend-dot'); dot.style.backgroundColor = color(prize);
        const name = el('span', 'legend-name', `${prize.rank}등 · ${prize.name || '상품명 입력'}`);
        name.title = prize.name;
        item.append(dot, name);
        if (id === 'preview-legend') item.append(el('span', 'legend-percent', ((options.find(p => p.id === prize.id)?.probability || 0) * 100).toFixed(1).replace(/\.0$/, '') + '%'));
        else { item.classList.toggle('sold-out', prize.quantity === 0); item.append(el('span', 'gift-quantity', prize.quantity ? `${prize.quantity}개 남음` : '모두 당첨!')); }
        $(id).append(item);
      });
    });
  }
  function changed() {
    completedRound = false;
    renderWheel('setup-wheel'); renderWheel('draw-wheel'); resetRotation(); renderLegends(); updateSummary(); updateControls();
    // Invalid, unfinished input stays visible, but does not replace the last valid saved settings.
    save();
  }
  function resetRotation() {
    gripRotationBase = null;
    rotation = 0; $('draw-wheel').style.transition = 'none'; $('draw-wheel').style.transform = 'rotate(0deg)';
  }
  function showMotionStage(mode) {
    currentStage = mode;
    document.querySelectorAll('[data-step]').forEach(step => {
      const selected = step.dataset.step === mode;
      step.classList.toggle('selected', selected);
      step.classList.toggle('complete', step.dataset.step === 'pose' && mode === 'circle');
      if (selected) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    });
    $('pose-guide').toggleAttribute('hidden', mode === 'circle'); $('circle-guide').toggleAttribute('hidden', mode !== 'circle');
    const starter = presentation.starterForRound(state.history.length);
    const guideImage = assetPath('assets/art/' + starter.image);
    $('pose-guide').src = guideImage;
    $('pose-guide').alt = starter.short + ' 동작 안내';
    $('pose-guide').dataset.poseKind = starter.kind;
    $('live-guide-image').src = mode === 'circle' ? assetPath('assets/art/circle-guide.png') : guideImage;
    $('live-guide').hidden = !camera?.running || mode === 'presence';
    $('gesture-title').textContent = mode === 'presence' ? '화면 가운데에서 2초만 기다려 주세요!' : mode === 'pose' ? starter.title : '손잡이를 잡고 한 바퀴 돌려요!';
    $('gesture-description').textContent = mode === 'presence' ? '머리와 어깨가 보이면 동작 안내가 자동으로 시작돼요.' : mode === 'pose' ? starter.description : '큰 노란 손잡이 근처에 손을 가져오고, 잡히면 편하게 한 바퀴 돌려 주세요. 원 모양이 조금 달라도 괜찮아요.';
  }
  function setProgress(percent, message) {
    $('progress-fill').style.width = percent + '%'; $('progress-number').textContent = percent + '%';
    $('motion-progress').setAttribute('aria-valuenow', percent);
    $('camera-feedback').textContent = message || (percent === 100 ? '성공! 행운이 출발해요' : '카메라 연결 후 화면 가운데에 서 주세요.');
  }
  function updateControls() {
    const disabled = busy || completedRound || !!getError();
    $('manual-spin').disabled = disabled;
    $('restart-camera').disabled = busy || !!camera?.connecting;
    $('show-history').disabled = busy;
    $('draw-tab').setAttribute('aria-disabled', String(busy));
    $('setup-tab').setAttribute('aria-disabled', String(busy));
  }
  function canStart() {
    if (busy || completedRound) return false;
    const error = getError();
    $('draw-error').textContent = error;
    if (error) return false;
    return true;
  }
  function spin(direction = 'clockwise') {
    if (!canStart()) return;
    if (gripRotationBase !== null) {
      const matrix = new DOMMatrix(getComputedStyle($('draw-wheel')).transform);
      const visualAngle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
      const difference = (visualAngle - rotation) * Math.PI / 180;
      rotation += Math.atan2(Math.sin(difference), Math.cos(difference)) * 180 / Math.PI;
      $('draw-wheel').style.transition = 'none';
      $('draw-wheel').style.transform = `rotate(${rotation}deg)`;
    }
    gripRotationBase = null; // Continue smoothly from the participant's hand angle.
    if (matchMedia('(max-width: 800px)').matches) $('draw-wheel').closest('.wheel-stage').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
    disarmMotion(); busy = true; updateControls(); beginRotation(direction);
  }
  async function beginRotation(direction) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const prize = firstPrizeMode.take(math.segments(state.prizes)) || math.pick(state.prizes, random);
    const candidates = math.visualSegments(state.prizes, state.wheelLayout).filter(segment => segment.id === prize?.id);
    const sliceRandom = candidates.length > 1 ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 : 0;
    const selected = candidates[Math.floor(sliceRandom * candidates.length)];
    renderOperatorMode();
    if (!selected) { busy = false; updateControls(); return; }
    const plan = math.finishPlan(state.prizes, selected, rotation, direction, state.wheelLayout);
    const { target, landingAngle } = plan;
    state.pending = { id: crypto.randomUUID(), prizeId: selected.id, rank: selected.rank, prize: selected.name, name: `${state.history.length + 1}회차`, time: new Date().toISOString(), landingAngle, direction };
    save();
    const short = reducedMotion.matches;
    const lens = $('lens-disc');
    const singleGift = math.available(state.prizes).length === 1;
    $('finish-lens').querySelector('.lens-heading strong').textContent = singleGift ? '마지막 남은 선물이에요' : '마지막 한 칸, 천천히 확인해요';
    lens.replaceChildren($('draw-wheel').firstElementChild.cloneNode(true));
    $('finish-lens').hidden = true;
    $('lens-status').textContent = '포인터가 완전히 멈춘 뒤 결과를 발표해요.';
    $('wheel-message').textContent = '당신의 행운을 찾고 있어요…';
    const disc = $('draw-wheel');
    disc.style.transition = 'none';
    const lensBox = $('finish-lens');
    lensBox.classList.remove('zoom-visible');
    if (short) {
      const animation = disc.animate([{ transform: `rotate(${rotation}deg)` }, { transform: `rotate(${target}deg)` }], { duration: 120, fill: 'forwards' });
      await animation.finished;
      disc.style.transform = `rotate(${target}deg)`; animation.cancel();
    } else {
      const approachMs = 4100;
      const settleMs = singleGift ? 900 : 2400;
      const duration = approachMs + settleMs;
      // One timeline includes the whole approach and all settling turns. Neither
      // wheel pauses or restarts when the pointer magnification becomes visible.
      const keyframes = math.animationFrames(rotation, plan, approachMs, settleMs)
        .map(({ angle, ...frame }) => ({ ...frame, transform: `rotate(${angle}deg)` }));
      lens.style.transition = 'none'; lens.style.transform = `rotate(${rotation}deg)`;
      lensBox.style.visibility = 'hidden'; lensBox.style.opacity = '0'; lensBox.hidden = false;
      const stage = disc.closest('.wheel-stage');
      const headingHeight = lensBox.querySelector('.lens-heading').offsetHeight;
      lensBox.style.top = Math.max(8, stage.offsetTop + stage.querySelector('.wheel-pointer').offsetTop - headingHeight - 2) + 'px';
      lensBox.style.transformOrigin = `50% ${headingHeight + 10}px`;
      const animations = [disc, lens].map(element => element.animate(keyframes, { duration, fill: 'forwards' }));
      const zoomAt = 2600;
      const zoom = lensBox.animate([
        { opacity: 0, transform: 'translateX(-50%) scale(.68)' },
        { opacity: 1, transform: 'translateX(-50%) scale(1)' }
      ], { duration: 800, delay: zoomAt, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
      const heading = disc.closest('.draw-wheel-card').querySelector('.card-heading').animate(
        [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: zoomAt, fill: 'both' });
      lensBox.style.visibility = 'visible';
      const startTime = document.timeline.currentTime;
      [...animations, zoom, heading].forEach(animation => { animation.startTime = startTime; });
      // All visual phases share the animation clock; a throttled timer cannot
      // delay the magnification until after the wheel has slowed to a stop.
      const host = camera?.animationHost || globalThis;
      let markerFrame;
      function markZoom() {
        if (animations[0].currentTime >= zoomAt) {
          lensBox.classList.add('zoom-visible');
          $('wheel-message').textContent = singleGift ? '마지막 선물의 주인공을 기다려요…' : '포인터 아래 경계에서, 마지막 두근거림…';
        } else markerFrame = host.requestAnimationFrame(markZoom);
      }
      markerFrame = host.requestAnimationFrame(markZoom);
      await Promise.all(animations.map(animation => animation.finished));
      host.cancelAnimationFrame(markerFrame); heading.cancel();
      for (const element of [disc, lens]) element.style.transform = `rotate(${target}deg)`;
      animations.forEach(animation => animation.cancel());
      lensBox.style.opacity = '1'; zoom.cancel();
    }
    rotation = target;
    $('lens-status').textContent = '정지 완료! 포인터가 가리키는 경품을 확인했어요.';
    await new Promise(resolve => setTimeout(resolve, short ? 0 : 450));
    finalizeRound(); lensBox.hidden = true; lensBox.classList.remove('zoom-visible'); showResult();
  }
  function finalizeRound() {
    const result = state.pending;
    if (!result) return;
    if (!state.history.some(entry => entry.id === result.id)) {
      const prize = state.prizes.find(p => p.id === result.prizeId);
      if (prize) prize.quantity = Math.max(0, prize.quantity - 1);
      state.history.push(result);
    }
    lastResult = result; state.pending = null; busy = false; completedRound = true;
    save(); updateSummary(); updateControls();
    $('wheel-message').textContent = `${result.rank}등 당첨! 축하합니다!`;
    // Keep the just-spun wheel unchanged until the next participant, so its pointer stays truthful.
  }
  function showResult() {
    if (!lastResult) return;
    $('result-rank').textContent = lastResult.rank + '등 당첨!';
    $('result-prize').textContent = lastResult.prize;
    $('result-dialog').querySelector('.result-art').src = assetPath(presentation.rankImage(lastResult.rank));
    $('result-dialog').querySelector('.result-art').alt = `${lastResult.rank}등 당첨을 축하하는 새싹 캐릭터`;
    if (!$('result-dialog').open) $('result-dialog').showModal();
  }
  function nextParticipant() {
    disarmMotion(); $('finish-lens').hidden = true;
    completedRound = false;
    renderEditor(); changed(); resetAutoMotion(); setProgress(0);
    $('wheel-message').textContent = math.total(state.prizes) ? '두근두근, 당신의 행운을 기다리는 중' : '모든 선물의 주인공을 찾았어요. 감사합니다!';
    $('draw-error').textContent = math.total(state.prizes) ? '' : '준비한 상품이 모두 소진됐어요. 설계 화면에서 추가할 수 있어요.';
    if (math.total(state.prizes)) $('manual-spin').focus();
  }
  function route() {
    const draw = location.hash === '#draw';
    if (busy && !draw) { history.replaceState(null, '', '#draw'); return; }
    if (draw && inputError()) { history.replaceState(null, '', '#setup'); $('validation-message').textContent = inputError(); return route(); }
    $('setup-page').hidden = draw; $('draw-page').hidden = !draw;
    if (!draw && (camera?.running || camera?.connecting)) camera.stop();
    $('setup-tab').classList.toggle('active', !draw); $('draw-tab').classList.toggle('active', draw);
    $('setup-tab').setAttribute('aria-current', draw ? 'false' : 'page'); $('draw-tab').setAttribute('aria-current', draw ? 'page' : 'false');
    $('draw-event').textContent = state.title.trim() || '우리의 행운이 시작되는 순간';
    document.title = '모션 룰렛';
    if (!draw && completedRound) nextParticipant();
  }
  function showHistory() {
    updateControls(); setProgress(camera?.detector.lastResult.progress || 0, '기록을 닫으면 이어서 진행해요.');
    const list = $('history-list'); list.replaceChildren();
    if (!state.history.length) list.append(el('p', 'empty-history', '아직 당첨 기록이 없어요.\n첫 번째 행운의 주인공을 만나 보세요!'));
    state.history.slice().reverse().forEach((entry, i) => {
      const row = el('div', 'history-entry');
      row.append(el('span', '', String(state.history.length - i).padStart(2, '0')), el('strong', '', entry.name), el('span', '', `${entry.rank}등 · ${entry.prize}`));
      list.append(row);
    });
    $('history-dialog').showModal();
  }
  function disarmMotion() { camera?.setActive(false); }
  function restoreGripPreview() {
    if (gripRotationBase === null || busy) return;
    rotation = gripRotationBase; gripRotationBase = null;
    $('draw-wheel').style.transition = 'transform 180ms ease-out';
    $('draw-wheel').style.transform = `rotate(${rotation}deg)`;
  }
  function followGrip(result) {
    if (result.mode !== 'circle') { restoreGripPreview(); return; }
    if (!Number.isFinite(result.angleDeg) || (!result.grip?.held && gripRotationBase === null)) return;
    if (gripRotationBase === null) gripRotationBase = rotation;
    rotation = gripRotationBase + result.angleDeg;
    $('draw-wheel').style.transition = reducedMotion.matches ? 'none' : 'transform 90ms linear';
    $('draw-wheel').style.transform = `rotate(${rotation}deg)`;
  }
  function resetAutoMotion() {
    restoreGripPreview();
    showMotionStage('presence');
    camera?.setPoseKind(presentation.starterForRound(state.history.length).kind);
    camera?.setActive(!!camera.running && !busy && !completedRound && !getError());
  }
  function cameraState({ phase, message }) {
    const ready = phase === 'ready', connecting = phase === 'connecting';
    $('camera-status').textContent = ready ? '카메라 ON' : connecting ? '준비 중' : '연결 안 됨';
    $('camera-status').classList.toggle('connected', ready);
    $('camera-button-label').textContent = ready ? '카메라 끄기' : connecting ? '연결 취소' : '카메라 연결';
    $('camera-label-text').textContent = ready ? 'LIVE · 이 기기에서 분석 중' : connecting ? '카메라 준비 중' : '카메라 대기 중';
    $('camera-preview').classList.toggle('is-live', ready);
    $('camera-video').hidden = !ready; $('tracking-overlay').hidden = !ready;
    $('camera-empty').hidden = ready;
    $('camera-error').textContent = phase === 'error' ? message : '';
    resetAutoMotion(); setProgress(0, ready ? '화면 가운데에 2초 동안 서 주세요.' : message); updateControls();
  }
  camera = new MotionCamera({
    video: $('camera-video'), canvas: $('tracking-overlay'), onState: cameraState,
    canRecognize: () => !busy && !completedRound && (!document.hidden || (CameraWindow.isOpen() && !CameraWindow.getWindow().document.hidden)) && !$('history-dialog').open && !$('result-dialog').open && location.hash === '#draw' && !$('draw-page').hidden && !getError(),
    onResult: result => {
      if (busy || completedRound) return;
      if (result.mode && result.mode !== currentStage) showMotionStage(result.mode);
      setProgress(result.progress, result.message);
      followGrip(result);
      if (result.matched) spin(result.direction || 'clockwise');
    }
  });
  $('organization-mode').addEventListener('click', () => {
    if (busy) return;
    const available = math.available(state.prizes).some(prize => prize.rank === 1);
    firstPrizeMode.click(performance.now(), available); renderOperatorMode();
    $('organization-mode').title = available ? '' : '1등 상품이 모두 소진됐어요.';
  });
  $('open-camera-window').addEventListener('click', () => {
    const opened = CameraWindow.open();
    $('display-message').textContent = opened ? '' : '팝업이 차단됐어요. 주소창에서 이 사이트의 팝업을 허용해 주세요.';
  });
  window.addEventListener('camera-window-change', event => {
    document.body.classList.toggle('dual-monitor', event.detail.open);
    if (!event.detail.open) $('display-message').textContent = '';
    camera.setAnimationHost(CameraWindow.getWindow() || globalThis);
    const label = event.detail.open ? '카메라 창 보기' : '카메라 새 창';
    $('open-camera-window').setAttribute('aria-label', label); $('open-camera-window').title = label;
  });
  $('roulette-fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { $('display-message').textContent = '이 브라우저에서 전체화면을 열 수 없어요. 창을 최대화해 주세요.'; }
  });
  document.addEventListener('fullscreenchange', () => {
    const full = !!document.fullscreenElement;
    document.body.classList.toggle('roulette-fullscreen', full);
    const label = full ? '전체화면 종료' : '룰렛 전체화면';
    $('roulette-fullscreen').setAttribute('aria-label', label); $('roulette-fullscreen').title = label;
  });
  $('restart-camera').addEventListener('click', () => {
    if (busy || camera.connecting) return;
    camera.dispose();
    camera.start();
  });
  $('connect-camera').addEventListener('click', () => {
    if (camera.running || camera.connecting) camera.stop(); else camera.start();
  });
  $('add-prize').addEventListener('click', () => {
    if (state.prizes.length >= 12) return;
    state.prizes.push({ id: crypto.randomUUID(), name: '새로운 선물', quantity: 1, rank: state.prizes.length + 1 });
    renderEditor(); changed(); $('prize-rows').lastElementChild.querySelector('input').focus();
  });
  $('event-title').addEventListener('input', event => { state.title = event.target.value; save(); });
  document.querySelectorAll('[name=wheel-layout]').forEach(input => input.addEventListener('change', () => {
    if (!input.checked || busy) return;
    state.wheelLayout = input.value; changed();
  }));
  $('manual-spin').addEventListener('click', () => spin());
  $('show-history').addEventListener('click', showHistory);
  $('close-history').addEventListener('click', () => $('history-dialog').close());
  $('history-dialog').addEventListener('close', () => {
    const result = camera?.detector.lastResult;
    if (result) setProgress(result.progress, result.message);
  });
  $('result-dialog').addEventListener('close', nextParticipant);
  $('reset-sample').addEventListener('click', () => {
    if (!confirm('설정과 당첨 기록을 지우고 예시로 다시 채울까요?')) return;
    state = initialState(); renderEditor(); resetAutoMotion(); changed();
  });
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.hidden && !CameraWindow.isOpen() && (camera.running || camera.connecting)) camera.stop('다른 화면으로 이동해 카메라를 껐어요.'); });
  window.addEventListener('pagehide', () => { CameraWindow.close(); camera.dispose(); });
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  renderEditor(); changed(); showMotionStage('presence'); route(); updateSaveStatus();
  if (state.pending) {
    const savedAngle = state.pending.landingAngle;
    const recoveryOptions = math.visualSegments(state.prizes, state.wheelLayout).filter(p => p.id === state.pending.prizeId);
    const recovered = recoveryOptions.find(p => savedAngle > p.start && savedAngle < p.end) || recoveryOptions[0];
    if (recovered) {
      const midpoint = Number.isFinite(savedAngle) && savedAngle > recovered.start && savedAngle < recovered.end ? savedAngle : recovered.midpoint;
      rotation = math.rotationFor({ ...recovered, midpoint }, 0, 0);
      $('draw-wheel').style.transform = `rotate(${rotation}deg)`;
    }
    finalizeRound(); history.replaceState(null, '', '#draw'); route();
    $('wheel-message').textContent = '중단된 추첨 결과를 복구했어요. 상품은 한 번만 차감됩니다.';
    showResult();
  }
})();
