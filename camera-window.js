/* Second-monitor view of the existing camera session. */
(() => {
  'use strict';
  let view = null;
  const source = id => document.getElementById(id);
  const getWindow = () => view && !view.popup.closed ? view.popup : null;
  const announce = open => window.dispatchEvent(new CustomEvent('camera-window-change', { detail: { open } }));

  function release(current) {
    if (view !== current) return;
    view = null;
    current.popup.cancelAnimationFrame(current.frame);
    current.observer?.disconnect();
    announce(false);
  }

  function close() {
    if (!view) return;
    const current = view;
    release(current);
    if (!current.popup.closed) current.popup.close();
  }

  function open() {
    if (getWindow()) { view.popup.focus(); return true; }
    if (view) release(view);
    const popup = window.open('', '_blank', 'popup=yes,width=1000,height=760,resizable=yes');
    if (!popup) return false;
    const current = view = { popup, frame: 0, observer: null };
    const doc = popup.document;
    doc.documentElement.lang = 'ko';
    doc.title = '모션 카메라 · 모션 룰렛';
    function element(tag, parent, content = '') {
      const node = doc.createElement(tag);
      node.textContent = content;
      parent.append(node);
      return node;
    }
    // Use the same loaded font definitions as the main screen, including the
    // embedded fonts in the standalone preview.
    for (const sheet of document.styleSheets) {
      try {
        const fonts = Array.from(sheet.cssRules).filter(rule => rule.type === CSSRule.FONT_FACE_RULE);
        if (fonts.length) element('style', doc.head, fonts.map(rule => rule.cssText).join('\n'));
      } catch { /* External style sheets may not expose their rules. */ }
    }
    const base = element('base', doc.head);
    base.href = document.baseURI;
    element('style', doc.head, `
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      body { margin: 0; height: 100vh; height: 100dvh; display: grid; grid-template-rows: minmax(0,1fr) auto; background: #122b24; color: #193b32; font-family: KERISBaeum,sans-serif; }
      main { position: relative; min-height: 0; overflow: hidden; display: grid; place-items: center; }
      canvas { position: absolute; inset: 0; height: 100%; width: 100%; object-fit: contain; }
      .waiting { padding: 1rem; color: #edf5d7; font-size: clamp(18px,3vw,32px); text-align: center; }
      footer { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: clamp(10px,2vw,28px); padding: clamp(12px,2.5vw,30px); background: #fafbf3; }
      footer img { width: clamp(52px,8vw,110px); height: clamp(52px,8vw,110px); object-fit: contain; }
      h1 { margin: 0; font: 700 clamp(20px,3vw,44px)/1.2 SchoolPoster,KERISBaeum,sans-serif; }
      p { margin: .35em 0 0; font-size: clamp(14px,1.75vw,25px); }
      .feedback { color: #557047; }
      progress { width: 100%; height: 8px; accent-color: #6d914c; }
      nav { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: 17rem; }
      button { border: 1px solid #c9d8c2; border-radius: 8px; background: #fff; color: #193b32; font: 700 15px KERISBaeum,sans-serif; padding: .6em .85em; cursor: pointer; }
      @media (max-width: 650px) { footer { grid-template-columns: auto 1fr; } nav { grid-column: 1/-1; max-width: none; } }
    `);

    const stage = element('main', doc.body);
    const canvas = element('canvas', stage);
    canvas.setAttribute('aria-label', '거울 카메라 영상과 동작 인식 표시');
    const context = canvas.getContext('2d');
    const waiting = element('div', stage);
    waiting.className = 'waiting';
    const footer = element('footer', doc.body);
    const guide = element('img', footer);
    guide.alt = '';
    const instructions = element('section', footer);
    const title = element('h1', instructions);
    const description = element('p', instructions);
    const feedback = element('p', instructions);
    feedback.className = 'feedback';
    const progress = element('progress', instructions);
    progress.max = 100;
    progress.setAttribute('aria-label', '동작 인식 진행률');
    const controls = element('nav', footer);
    const connect = element('button', controls);
    connect.onclick = () => source('connect-camera').click();
    const fullscreen = element('button', controls, '전체화면');
    fullscreen.hidden = !doc.fullscreenEnabled;
    fullscreen.onclick = async () => {
      try {
        if (doc.fullscreenElement) await doc.exitFullscreen();
        else await doc.documentElement.requestFullscreen();
      } catch { feedback.textContent = '이 브라우저에서 전체화면을 열 수 없어요.'; }
    };
    doc.addEventListener('fullscreenchange', () => { fullscreen.textContent = doc.fullscreenElement ? '전체화면 해제' : '전체화면'; });
    element('button', controls, '창 닫기').onclick = close;

    const video = source('camera-video');
    const overlay = source('tracking-overlay');
    function syncInstructions() {
      title.textContent = source('gesture-title').textContent;
      description.textContent = source('gesture-description').textContent;
      feedback.textContent = source('camera-error').textContent || source('camera-feedback').textContent;
      progress.value = Number(source('motion-progress').getAttribute('aria-valuenow'));
      const guideUrl = source('live-guide-image').src;
      if (guide.src !== guideUrl) guide.src = guideUrl;
      connect.textContent = source('camera-button-label').textContent;
      connect.disabled = source('connect-camera').disabled;
      waiting.textContent = source('camera-status').textContent === '준비 중' ? '카메라를 준비하고 있어요…' : '카메라를 연결해 주세요.';
    }
    current.observer = new MutationObserver(syncInstructions);
    current.observer.observe(source('camera-preview').closest('.camera-card'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'src', 'disabled', 'aria-valuenow'] });
    syncInstructions();

    function render() {
      if (view !== current || popup.closed) { release(current); return; }
      const live = !video.hidden && video.readyState >= 2 && video.videoWidth > 0;
      waiting.hidden = live;
      canvas.hidden = !live;
      if (live) {
        const width = video.videoWidth, height = video.videoHeight;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        context.setTransform(-1, 0, 0, 1, width, 0);
        context.drawImage(video, 0, 0, width, height);
        context.resetTransform();
        if (!overlay.hidden && overlay.width && overlay.height) context.drawImage(overlay, 0, 0, width, height);
      }
      current.frame = popup.requestAnimationFrame(render);
    }
    popup.addEventListener('pagehide', () => release(current), { once: true });
    render();
    announce(true);
    return true;
  }
  window.addEventListener('pagehide', close);
  window.CameraWindow = { open, close, getWindow, isOpen: () => Boolean(getWindow()) };
})();
