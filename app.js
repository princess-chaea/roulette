(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const math = globalThis.RouletteMath;
  const STORAGE_KEY = 'motion-roulette-prototype-v1';
  const COLORS = ['#f1aa91', '#f5d57a', '#91c7b4', '#c1b6e4', '#a8c8e5', '#e4b5d0'];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const initialState = () => ({
    version: 1,
    title: '우리 반 행운 뽑기',
    mode: 'pose',
    prizes: ['블루투스 스피커', '문구 세트', '간식 꾸러미', '달콤한 초콜릿'].map((name, index) => ({ id: crypto.randomUUID(), name, quantity: [1, 3, 6, 10][index], rank: index + 1 })),
    history: [], pending: null
  });
  let storageOK = true;
  function validState(value) {
    return value && value.version === 1 && typeof value.title === 'string' && value.title.length <= 40 && ['pose', 'circle'].includes(value.mode) &&
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
      if (validState(parsed)) return parsed;
      storageOK = false;
    } catch { storageOK = false; }
    return initialState();
  }
  let state = load();
  let busy = false;
  let rotation = 0;
  let completedRound = false;
  let lastResult = null;
  let gestureTimer = null;

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
    $('go-draw').disabled = !!getError();
    $('add-prize').disabled = state.prizes.length >= 12;
    document.querySelectorAll('[data-delete]').forEach(button => button.disabled = state.prizes.length === 1);
    $('history-count').textContent = state.history.length;
  }
  function renderEditor() {
    $('event-title').value = state.title;
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
    const options = math.segments(state.prizes);
    options.forEach(segment => {
      const [x1, y1] = point(segment.start), [x2, y2] = point(segment.end);
      const shape = segment.end - segment.start >= 359.99
        ? svgNode('circle', { cx: 300, cy: 300, r: 290, fill: color(segment) })
        : svgNode('path', { d: `M300 300L${x1} ${y1}A290 290 0 ${segment.end - segment.start > 180 ? 1 : 0} 1 ${x2} ${y2}Z`, fill: color(segment), stroke: '#fffdf2', 'stroke-width': 2 });
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
        const name = el('span', 'legend-name', id === 'preview-legend' ? `${prize.rank}등 · ${prize.name || '상품명 입력'}` : `${prize.rank}등 ${prize.quantity || 0}개`);
        name.title = prize.name;
        item.append(dot, name);
        if (id === 'preview-legend') item.append(el('span', 'legend-percent', ((options.find(p => p.id === prize.id)?.probability || 0) * 100).toFixed(1).replace(/\.0$/, '') + '%'));
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
    rotation = 0; $('draw-wheel').style.transition = 'none'; $('draw-wheel').style.transform = 'rotate(0deg)';
  }
  function setMode(mode) {
    if (busy) return;
    state.mode = mode;
    document.querySelectorAll('[data-mode]').forEach(button => {
      const selected = button.dataset.mode === mode;
      button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    });
    $('pose-guide').toggleAttribute('hidden', mode !== 'pose'); $('circle-guide').toggleAttribute('hidden', mode !== 'circle');
    $('gesture-title').textContent = mode === 'pose' ? '양손을 머리 위로 올려 주세요!' : '손으로 큰 원을 그려 주세요!';
    $('gesture-description').textContent = mode === 'pose' ? '자세를 유지하면 룰렛이 돌아가요.' : '화살표를 따라 돌리면 룰렛이 출발해요.';
    setProgress(0); save();
  }
  function setProgress(percent) {
    $('progress-fill').style.width = percent + '%'; $('progress-number').textContent = percent + '%';
    $('motion-progress').setAttribute('aria-valuenow', percent);
    $('camera-feedback').textContent = percent === 0 ? '동작 안내 미리보기' : percent === 100 ? '성공! 행운이 출발해요' : '동작 성공을 시연하는 중…';
  }
  function updateControls() {
    const disabled = busy || completedRound || !!getError();
    $('simulate-motion').disabled = disabled; $('manual-spin').disabled = disabled;
    $('participant').disabled = busy || completedRound;
    document.querySelectorAll('[data-mode]').forEach(button => button.disabled = busy);
    $('show-history').disabled = busy;
    $('draw-tab').setAttribute('aria-disabled', String(busy));
    $('setup-tab').setAttribute('aria-disabled', String(busy));
  }
  function canStart() {
    if (busy || completedRound) return false;
    const error = getError() || (!$('participant').value.trim() ? '이번 주인공의 이름을 먼저 입력해 주세요.' : '');
    $('draw-error').textContent = error;
    if (error) { if (!$('participant').value.trim()) $('participant').focus(); return false; }
    return true;
  }
  function spin(simulate) {
    if (!canStart()) return;
    busy = true; updateControls();
    if (!simulate) { beginRotation(); return; }
    let progress = 0;
    gestureTimer = setInterval(() => {
      progress += 10; setProgress(progress);
      if (progress >= 100) { clearInterval(gestureTimer); gestureTimer = null; beginRotation(); }
    }, reducedMotion.matches ? 30 : 100);
  }
  function beginRotation() {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const selected = math.pick(state.prizes, random);
    if (!selected) { busy = false; updateControls(); return; }
    state.pending = { id: crypto.randomUUID(), prizeId: selected.id, rank: selected.rank, prize: selected.name, name: $('participant').value.trim(), time: new Date().toISOString() };
    save();
    const target = math.rotationFor(selected, rotation);
    const duration = reducedMotion.matches ? 120 : 4600;
    $('wheel-message').textContent = '당신의 행운을 찾고 있어요…';
    $('draw-wheel').style.transition = `transform ${duration}ms cubic-bezier(.15,.65,.12,1)`;
    // Ensure geometry is painted before starting a new transition.
    $('draw-wheel').getBoundingClientRect();
    $('draw-wheel').style.transform = `rotate(${target}deg)`; rotation = target;
    setTimeout(() => { finalizeRound(); showResult(); }, duration + 80);
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
    $('wheel-message').textContent = `${result.name} 님, ${result.rank}등 당첨을 축하해요!`;
    // Keep the just-spun wheel unchanged until the next participant, so its pointer stays truthful.
  }
  function showResult() {
    if (!lastResult) return;
    $('result-rank').textContent = lastResult.rank + '등 당첨!';
    $('result-prize').textContent = lastResult.prize;
    $('result-person').textContent = lastResult.name + ' 님, 축하해요!';
    if (!$('result-dialog').open) $('result-dialog').showModal();
  }
  function nextParticipant() {
    completedRound = false; $('participant').value = '';
    renderEditor(); changed(); setProgress(0);
    $('wheel-message').textContent = math.total(state.prizes) ? '두근두근, 당신의 행운을 기다리는 중' : '모든 선물의 주인공을 찾았어요. 감사합니다!';
    $('draw-error').textContent = math.total(state.prizes) ? '' : '준비한 상품이 모두 소진됐어요. 설계 화면에서 추가할 수 있어요.';
    if (math.total(state.prizes)) $('participant').focus();
  }
  function route() {
    const draw = location.hash === '#draw';
    if (busy && !draw) { history.replaceState(null, '', '#draw'); return; }
    if (draw && inputError()) { history.replaceState(null, '', '#setup'); $('validation-message').textContent = inputError(); return route(); }
    $('setup-page').hidden = draw; $('draw-page').hidden = !draw;
    $('setup-tab').classList.toggle('active', !draw); $('draw-tab').classList.toggle('active', draw);
    $('setup-tab').setAttribute('aria-current', draw ? 'false' : 'page'); $('draw-tab').setAttribute('aria-current', draw ? 'page' : 'false');
    $('draw-event').textContent = state.title.trim() || '우리의 행운이 시작되는 순간';
    document.title = (draw ? '룰렛 돌리기' : '룰렛 설계') + ' · 모션 룰렛';
    if (!draw && completedRound) nextParticipant();
  }
  function showHistory() {
    const list = $('history-list'); list.replaceChildren();
    if (!state.history.length) list.append(el('p', 'empty-history', '아직 당첨 기록이 없어요.\n첫 번째 행운의 주인공을 만나 보세요!'));
    state.history.slice().reverse().forEach((entry, i) => {
      const row = el('div', 'history-entry');
      row.append(el('span', '', String(state.history.length - i).padStart(2, '0')), el('strong', '', entry.name), el('span', '', `${entry.rank}등 · ${entry.prize}`));
      list.append(row);
    });
    $('history-dialog').showModal();
  }
  $('add-prize').addEventListener('click', () => {
    if (state.prizes.length >= 12) return;
    state.prizes.push({ id: crypto.randomUUID(), name: '새로운 선물', quantity: 1, rank: state.prizes.length + 1 });
    renderEditor(); changed(); $('prize-rows').lastElementChild.querySelector('input').focus();
  });
  $('event-title').addEventListener('input', event => { state.title = event.target.value; save(); });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $('go-draw').addEventListener('click', () => { if (!getError()) location.hash = 'draw'; });
  $('simulate-motion').addEventListener('click', () => spin(true));
  $('manual-spin').addEventListener('click', () => spin(false));
  $('show-history').addEventListener('click', showHistory);
  $('close-history').addEventListener('click', () => $('history-dialog').close());
  $('result-dialog').addEventListener('close', nextParticipant);
  $('participant').addEventListener('input', () => { $('draw-error').textContent = ''; });
  $('reset-sample').addEventListener('click', () => {
    if (!confirm('설정과 시연 당첨 기록을 지우고 예시로 다시 채울까요?')) return;
    state = initialState(); renderEditor(); setMode(state.mode); changed();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  renderEditor(); changed(); setMode(state.mode); route(); updateSaveStatus();
  if (state.pending) {
    const recovered = math.segments(state.prizes).find(p => p.id === state.pending.prizeId);
    if (recovered) {
      rotation = math.rotationFor(recovered, 0, 0);
      $('draw-wheel').style.transform = `rotate(${rotation}deg)`;
    }
    finalizeRound(); history.replaceState(null, '', '#draw'); route();
    $('wheel-message').textContent = '중단된 추첨 결과를 복구했어요. 상품은 한 번만 차감됩니다.';
    showResult();
  }
})();
