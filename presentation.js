/* UI-only choices; these never alter weighted prize selection. */
(() => {
  const STARTER_POSES = [
    { kind:'hands_up', title:'양손을 머리 위로 높이 들어 주세요!', description:'양손을 높이 들고 1초 동안 유지해요.', image:'pose-guide.png', short:'양손 높이 들기' },
    { kind:'hands_near_shoulders', title:'양손을 어깨 가까이 올려 주세요!', description:'팔꿈치를 굽혀 양손을 어깨 옆에 두고 1초 동안 유지해요. 팔꿈치는 화면에 없어도 괜찮아요.', image:'starter-hands-near-shoulders.png', short:'양손 어깨 가까이' },
    { kind:'one_hand_up', title:'한 손을 머리 위로 높이 들어 주세요!', description:'한 손만 높이 들고 다른 손은 내린 채 1초 동안 유지해요.', image:'starter-one-hand-up.png', short:'한 손 높이 들기' },
    { kind:'arm_heart', title:'양팔로 머리 위에 큰 하트를 만들어 주세요!', description:'양손을 머리 위 가까이 모으고 팔꿈치를 벌려 1초 동안 유지해요.', image:'starter-arm-heart.png', short:'팔로 큰 하트' }
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
  const api = { STARTER_POSES, starterForRound, rankImage, wheelLabel };
  if(typeof module !== 'undefined' && module.exports) module.exports=api; else globalThis.RoulettePresentation=api;
})();
