/* UI-only choices; these never alter weighted prize selection. */
(() => {
  const STARTER_POSES = [
    { kind:'hands_up', title:'양손을 머리 위로 높이 들어 주세요!', description:'양손을 높이 들고 1초 동안 유지해요.', image:'pose-guide.png', short:'양손 높이 들기' },
    { kind:'hands_near_shoulders', title:'양손을 어깨 가까이 올려 주세요!', description:'팔꿈치를 굽혀 양손을 어깨 옆에 두고 1초 동안 유지해요. 팔꿈치는 화면에 없어도 괜찮아요.', image:'starter-hands-near-shoulders.png', short:'양손 어깨 가까이' },
    { kind:'one_hand_up', title:'한 손을 이마나 머리 위로 들어 주세요!', description:'한 손만 이마 근처나 머리 위로 들고 다른 팔은 내려 1초 동안 유지해요.', image:'starter-one-hand-up.png', short:'한 손 높이 들기' },
    { kind:'arm_heart', title:'양팔을 머리 위로 둥글게 들어 주세요!', description:'팔꿈치를 벌려 큰 하트처럼 둥글게 1초 동안 유지해요. 손끝을 꼭 붙이지 않아도 돼요.', image:'starter-arm-heart.png', short:'팔로 큰 하트' }
  ];
  const starterForRound = completed => STARTER_POSES[Math.max(0, Math.floor(completed)) % STARTER_POSES.length];
  const rankImage = rank => `assets/art/ranks/rank-${String(Math.min(10, Math.max(1, Math.floor(Number(rank) || 1)))).padStart(2,'0')}.png`;
  function wheelLabel(segment, mode = 'large') {
    const angle = Math.max(0, segment.end - segment.start);
    const radius = Math.min(88, 190 * Math.sin(Math.min(180, angle) * Math.PI / 360) * .88);
    const rank = `${segment.rank}등`;
    const lines = [{ text: rank, size: mode === 'rank' ? 34 : mode === 'small' ? 18 : 26 }];
    if (mode !== 'rank' && angle >= 24) {
      const limit = mode === 'small' ? 10 : 8;
      const name = segment.name.length > limit ? segment.name.slice(0, limit - 1) + '…' : segment.name;
      lines.push({ text: name, size: mode === 'small' ? 15 : 22 },
        { text: `${segment.quantity}개`, size: mode === 'small' ? 12 : 16 });
    }
    const width = Math.max(...lines.map(line => line.text.length * line.size));
    const height = lines.reduce((sum, line) => sum + line.size * 1.4, 0);
    const scale = Math.min(1, radius * 2 / Math.hypot(width, height));
    let top = -height * scale / 2;
    return { radius, lines: lines.map(line => {
      const size = line.size * scale, y = top + size * .7;
      top += size * 1.4;
      return { text: line.text, size, y };
    }) };
  }
  function containedFrame(boxWidth, boxHeight, mediaWidth, mediaHeight) {
    if (![boxWidth, boxHeight, mediaWidth, mediaHeight].every(size => Number.isFinite(size) && size > 0)) return null;
    const scale = Math.min(boxWidth / mediaWidth, boxHeight / mediaHeight);
    const width = mediaWidth * scale, height = mediaHeight * scale;
    return { width, height, x: Math.max(0, (boxWidth - width) / 2), y: Math.max(0, (boxHeight - height) / 2) };
  }

  // Match the *painted image*, not the letterboxed CSS element. This adjusts
  // only where the guide is drawn; the video/model/tracking canvas are untouched.
  function watchContainedFrame(viewport, video, guide) {
    const view = viewport.ownerDocument.defaultView;
    let boxWidth = viewport.clientWidth, boxHeight = viewport.clientHeight;
    const refresh = () => {
      const fit = containedFrame(boxWidth, boxHeight, video.videoWidth, video.videoHeight);
      if (!fit) { delete guide.dataset.frameFit; return; }
      guide.style.setProperty('--fit-x', fit.x.toFixed(2) + 'px');
      guide.style.setProperty('--fit-y', fit.y.toFixed(2) + 'px');
      guide.style.setProperty('--fit-height', fit.height.toFixed(2) + 'px');
      guide.dataset.frameFit = 'ready';
    };
    const updateSize = (width, height) => {
      boxWidth = width; boxHeight = height;
      refresh();
    };
    const viewportResize = () => updateSize(viewport.clientWidth, viewport.clientHeight);
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) updateSize(rect.width, rect.height);
    }) : null;
    if (observer) observer.observe(viewport);
    else view.addEventListener('resize', viewportResize);
    for (const name of ['loadedmetadata', 'resize', 'emptied']) video.addEventListener(name, refresh);
    refresh();
    return () => {
      observer?.disconnect();
      if (!observer) view.removeEventListener('resize', viewportResize);
      for (const name of ['loadedmetadata', 'resize', 'emptied']) video.removeEventListener(name, refresh);
    };
  }

  const api = { STARTER_POSES, starterForRound, rankImage, wheelLabel, containedFrame, watchContainedFrame };
  if(typeof module !== 'undefined' && module.exports) module.exports=api; else globalThis.RoulettePresentation=api;
})();
