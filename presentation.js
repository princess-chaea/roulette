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
  const api = { STARTER_POSES, starterForRound, rankImage };
  if(typeof module !== 'undefined' && module.exports) module.exports=api; else globalThis.RoulettePresentation=api;
})();
