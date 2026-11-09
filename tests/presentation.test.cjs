const {test}=require('node:test');
const assert=require('node:assert/strict');
const {STARTER_POSES,starterForRound,rankImage}=require('../presentation.js');
test('four starter poses cycle independently of prize odds and include an arm heart',()=>{
  assert.deepEqual(STARTER_POSES.map(p=>p.kind),['hands_up','arms_out','one_hand_up','arm_heart']);
  assert.equal(starterForRound(0).kind,'hands_up');
  assert.equal(starterForRound(3).kind,'arm_heart');
  assert.equal(starterForRound(4).kind,'hands_up');
});
test('each rank from one through ten has its own picture',()=>{
  assert.equal(new Set(Array.from({length:10},(_,i)=>rankImage(i+1))).size,10);
  assert.equal(rankImage(1),'assets/art/ranks/rank-01.png');
});
test('every rank above ten uses exactly the rank-ten illustration',()=>{
  for(const rank of [10,11,12,20,100,999])assert.equal(rankImage(rank),'assets/art/ranks/rank-10.png');
});
