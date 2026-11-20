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
    current.stopWatchingFit?.();
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
    doc.title = '모션 룰렛';
    const originalIcon = document.querySelector('link[rel="icon"]');
    if (originalIcon) {
      const favicon = doc.createElement('link');
      favicon.rel = 'icon'; favicon.type = originalIcon.type;
      favicon.href = originalIcon.href;
      doc.head.append(favicon);
    }
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
      body { margin: 0; height: 100vh; height: 100dvh; min-height: 300px; display: grid; grid-template-rows: auto minmax(0,1fr) auto; background: #122b24; color: #193b32; font-family: KERISBaeum,sans-serif; }
      header { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:46px; padding:5px clamp(10px,2vw,24px); background:#fafbf3; }
      header .brand { display:flex; align-items:center; gap:6px; font:700 clamp(16px,2.5vw,25px) SchoolPoster,KERISBaeum,sans-serif; white-space:nowrap; }
      header .brand img { width:36px; height:36px; object-fit:contain; }
      header .research-logo { width:clamp(108px,28vw,217px); max-width:47%; max-height:40px; object-fit:contain; object-position:right; }
      main { display:grid; grid-template:minmax(0,1fr)/minmax(0,1fr); min-height:0; padding:4px; }
      .feed { position:relative; display:grid; place-items:center; min-height:0; overflow:hidden; }
      canvas { position:absolute; inset:0; height:100%; width:100%; object-fit:contain; }
      .waiting { padding:1rem; color:#edf5d7; font-size:clamp(18px,3vw,31px); text-align:center; }
      .guide-bounds { position:absolute; inset:var(--fit-y,0px) var(--fit-x,0px); z-index:1; display:flex; align-items:flex-end; justify-content:center; visibility:hidden; pointer-events:none; container-type:inline-size; }
      .guide-bounds[data-frame-fit="ready"] { visibility:visible; }
      .feed-tracking { z-index:2; pointer-events:none; }
      .guide-panel { display:grid; grid-template-columns:minmax(0,1fr); justify-items:center; align-items:end; width:min(90%,760px); min-width:0; gap:clamp(3px,.8cqw,8px); margin:0 0 clamp(3px,1cqw,12px); color:#fff; }
      .guide-panel img { grid-row:1; display:block; width:auto; height:clamp(24px,calc(var(--fit-height,240px) * .32),230px); max-width:42cqw; max-height:40cqw; aspect-ratio:1; object-fit:contain; background:#faffebd9; border:1px solid #fff9; border-radius:14px; padding:2px; }
      .guide-panel > div { grid-row:2; width:100%; padding:clamp(4px,1cqw,11px) clamp(9px,2cqw,24px); min-width:0; text-align:center; border:1px solid #f4fff481; border-radius:12px; background:#102720f2; box-shadow:0 4px 18px #0007; }
      h1 { margin:0; font:700 clamp(15px,min(4cqw,calc(var(--fit-height,240px) * .078)),44px)/1.15 SchoolPoster,KERISBaeum,sans-serif; word-break:keep-all; overflow-wrap:anywhere; }
      .guide-panel p { margin:.25em 0 0; font-size:clamp(11px,min(2.25cqw,calc(var(--fit-height,240px) * .044)),23px); line-height:1.28; color:#f0f8e7; word-break:keep-all; }
      .guide-bounds[data-motion-stage="presence"] .guide-panel { position:absolute; top:81%; bottom:auto; left:50%; transform:translateX(-50%); display:block; width:max-content; max-width:96%; margin:0; }
      .guide-bounds[data-motion-stage="presence"] .guide-panel > div { padding:clamp(3px,1cqw,8px) clamp(7px,2cqw,16px); text-align:center; }
      .guide-bounds[data-motion-stage="presence"] h1 { font-size:clamp(12px,3.45cqw,32px); line-height:1.16; word-break:keep-all; }
      .guide-bounds[data-motion-stage="presence"] p { display:none; }
      footer { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:clamp(8px,1.5vw,22px); padding:8px clamp(10px,2vw,24px); background:#fafbf3; }
      .feedback { margin:0 0 3px; color:#557047; }
      progress { width:100%; height:8px; accent-color:#6d914c; }
      nav { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px; max-width:19rem; }
      button { border:1px solid #c9d8c2; border-radius:8px; background:#fff; color:#193b32; font:700 13px KERISBaeum,sans-serif; padding:.6em .7em; cursor:pointer; }
      .result { border:0; border-radius:28px; padding:clamp(24px,5vw,52px); width:min(90vw,620px); text-align:center; color:#193b32; background:#fff; box-shadow:0 20px 80px #0005; max-height:92dvh; overflow:auto; }
      .result::backdrop { background:#122b2488; backdrop-filter:blur(8px); }
      .result img { display:block; width:clamp(140px,24vh,240px); height:clamp(140px,24vh,240px); object-fit:contain; margin:0 auto 12px; }
      .result h2 { font:700 clamp(28px,4vw,48px)/1.3 SchoolPoster,KERISBaeum,sans-serif; margin:12px 0 28px; overflow-wrap:anywhere; }
      .result .rank { color:#6b8758; font-weight:700; font-size:clamp(18px,2.5vw,26px); }
      .result button { width:100%; background:#173d35; color:white; border:0; padding:18px; font-size:20px; }
      @media (max-width:650px) {
        footer { gap:5px; }
        nav { max-width:11rem; }
      }
    `);

    // Share the exact same scene stylesheet. Copy loaded rules to avoid
    // delaying a win effect while a popup stylesheet request is in flight.
    const fanfareStyle = source('result-fanfare-style');
    if (fanfareStyle) {
      try {
        const rules = Array.from(fanfareStyle.sheet.cssRules, rule => rule.cssText);
        element('style', doc.head, rules.join('\n'));
      } catch {
        const link = doc.importNode(fanfareStyle, false);
        link.href = fanfareStyle.href;
        doc.head.append(link);
      }
    }
    const top = element('header', doc.body);
    const brand = element('div', top);
    brand.className = 'brand';
    const brandArt = element('img', brand);
    brandArt.src = document.querySelector('.brand-wheel').src;
    brandArt.alt = '';
    element('span', brand, '모션 룰렛');
    const researchArt = element('img', top);
    researchArt.className = 'research-logo';
    researchArt.src = source('organization-mode').querySelector('img').src;
    researchArt.alt = '초등정보교과교육연구회';

    const stage = element('main', doc.body);
    const feed = element('div', stage);
    feed.className = 'feed';
    const canvas = element('canvas', feed);
    canvas.setAttribute('aria-label', '거울 카메라 영상과 동작 인식 표시');
    const context = canvas.getContext('2d');
    const tracking = element('canvas', feed);
    tracking.className = 'feed-tracking';
    tracking.setAttribute('aria-hidden', 'true');
    const trackingContext = tracking.getContext('2d');
    const waiting = element('div', feed);
    waiting.className = 'waiting';
    const guideBounds = element('div', feed);
    guideBounds.className = 'guide-bounds';
    const guidePanel = element('aside', guideBounds);
    guidePanel.className = 'guide-panel';
    guidePanel.setAttribute('aria-label', '현재 동작 안내');
    const guide = element('img', guidePanel);
    guide.alt = '';
    const instructions = element('div', guidePanel);
    const title = element('h1', instructions);
    const description = element('p', instructions);
    const footer = element('footer', doc.body);
    const meter = element('div', footer);
    const feedback = element('p', meter);
    feedback.className = 'feedback';
    const progress = element('progress', meter);
    progress.max = 100;
    progress.setAttribute('aria-label', '동작 인식 진행률');
    const controls = element('nav', footer);
    const connect = element('button', controls);
    connect.onclick = () => source('connect-camera').click();
    const restart = element('button', controls);
    restart.setAttribute('aria-label', '카메라와 동작 인식 새로 시작');
    restart.title = '카메라와 동작 인식 새로 시작';
    const refreshSvg = source('restart-camera').querySelector('svg').cloneNode(true);
    // Inline the icon path because SVG use cannot reliably reference another window.
    const refreshPath = source('i-refresh').firstElementChild.cloneNode(true);
    refreshSvg.replaceChildren(refreshPath); refreshSvg.setAttribute('viewBox', '0 0 24 24');
    refreshSvg.style.cssText = 'width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;display:block';
    restart.append(doc.importNode(refreshSvg, true));
    restart.onclick = () => source('restart-camera').click();
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

    const result = element('dialog', doc.body);
    result.className = 'result';
    result.setAttribute('aria-labelledby', 'camera-result-prize');
    const resultContent = element('div', result);
    resultContent.className = 'result-content';
    const closeResult = element('button', resultContent, '×');
    closeResult.className = 'dialog-close';
    closeResult.setAttribute('aria-label', '당첨 결과 닫기');
    closeResult.onclick = () => source('result-dialog').close();
    const resultArt = element('img', resultContent);
    const resultRank = element('p', resultContent); resultRank.className = 'rank fanfare-rank';
    const resultPrize = element('h2', resultContent); resultPrize.id = 'camera-result-prize';
    element('button', resultContent, '확인').onclick = () => source('result-dialog').close();
    result.addEventListener('close', () => { if (source('result-dialog').open) source('result-dialog').close(); });
    function syncResult() {
      const original = source('result-dialog');
      RouletteFanfare.syncDialog(original, result, () => {
        const art = original.querySelector('.result-art');
        if (resultArt.src !== art.src) resultArt.src = art.src;
        resultArt.alt = art.alt;
        resultRank.textContent = source('result-rank').textContent;
        resultPrize.textContent = source('result-prize').textContent;
      });
    }
    const video = source('camera-video');
    const overlay = source('tracking-overlay');
    current.stopWatchingFit = RoulettePresentation.watchContainedFrame(feed, video, guideBounds);
    function syncInstructions() {
      syncResult();
      title.textContent = source('gesture-title').textContent;
      description.textContent = source('gesture-description').textContent;
      feedback.textContent = source('camera-error').textContent || source('camera-feedback').textContent;
      progress.value = Number(source('motion-progress').getAttribute('aria-valuenow'));
      const originalGuide = source('live-guide-image');
      if (guide.src !== originalGuide.src) guide.src = originalGuide.src;
      guide.hidden = originalGuide.hidden;
      guidePanel.hidden = source('live-guide').hidden;
      guideBounds.dataset.motionStage = source('camera-guide-bounds').dataset.motionStage;
      connect.textContent = source('camera-button-label').textContent;
      connect.disabled = source('connect-camera').disabled;
      restart.disabled = source('restart-camera').disabled;
      waiting.textContent = source('camera-status').textContent === '준비 중' ? '카메라를 준비하고 있어요…' : '카메라를 연결해 주세요.';
    }
    current.observer = new MutationObserver(syncInstructions);
    current.observer.observe(source('camera-preview').closest('.camera-card'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'src', 'disabled', 'aria-valuenow', 'data-motion-stage'] });
    current.observer.observe(source('result-dialog'), { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['open','data-result-id'] });
    syncInstructions();

    function render() {
      if (view !== current || popup.closed) { release(current); return; }
      const live = !video.hidden && video.readyState >= 2 && video.videoWidth > 0;
      waiting.hidden = live;
      canvas.hidden = !live;
      tracking.hidden = !live;
      if (live) {
        const width = video.videoWidth, height = video.videoHeight;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        context.setTransform(-1, 0, 0, 1, width, 0);
        context.drawImage(video, 0, 0, width, height);
        context.resetTransform();
        if (tracking.width !== width || tracking.height !== height) { tracking.width = width; tracking.height = height; }
        trackingContext.clearRect(0, 0, width, height);
        if (!overlay.hidden && overlay.width && overlay.height) trackingContext.drawImage(overlay, 0, 0, width, height);
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
