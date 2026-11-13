const {test}=require('node:test');
const assert=require('node:assert/strict');
const {STARTER_POSES,starterForRound,rankImage,wheelLabel}=require('../presentation.js');
test('four starter poses cycle independently of prize odds and include an arm heart',()=>{
  assert.deepEqual(STARTER_POSES.map(p=>p.kind),['hands_up','hands_near_shoulders','one_hand_up','arm_heart']);
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


test('wheel text choices adapt to sector size and never alter the prize',()=>{
  for(const angle of [.1,5,18,36,90,360]){
    const prize=Object.freeze({rank:12,name:'아주 긴 상품 이름 테스트',quantity:99,start:0,end:angle});
    const big=wheelLabel(prize,'large'),small=wheelLabel(prize,'small'),rank=wheelLabel(prize,'rank');
    assert.ok(big.lines[0].size>=small.lines[0].size);
    assert.equal(rank.lines.length,1);assert.equal(rank.lines[0].text,'12등');
    if(angle<24)assert.equal(big.lines.length,1);
    for(const result of [big,small,rank]){
      assert.ok(result.radius>0&&Number.isFinite(result.radius));
      for(const line of result.lines)assert.ok(Number.isFinite(line.size)&&line.size>0);
    }
  }
});
