const {test}=require('node:test');
const assert=require('node:assert/strict');
const {STARTER_POSES,starterForRound,rankImage,wheelLabel,containedFrame,watchContainedFrame}=require('../presentation.js');
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

test('contained media bounds exclude letterboxes on wide, tall and same-ratio viewports', () => {
  assert.deepEqual(containedFrame(1300, 600, 640, 480), { width:800, height:600, x:250, y:0 });
  assert.deepEqual(containedFrame(640, 600, 1280, 720), { width:640, height:360, x:0, y:120 });
  assert.deepEqual(containedFrame(320, 240, 640, 480), { width:320, height:240, x:0, y:0 });
  assert.deepEqual(containedFrame(320, 260, 480, 640), { width:195, height:260, x:62.5, y:0 });
  assert.equal(containedFrame(0, 600, 640, 480), null);
  assert.equal(containedFrame(640, 600, 0, 0), null);
});

test('the live guide recalculates on media metadata and viewport resize, then cleans up', () => {
  const listeners = new Map(), props = new Map();
  let resized, disconnected = false;
  const video = {
    videoWidth:0, videoHeight:0,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const viewport = {
    clientWidth:1300, clientHeight:600,
    ownerDocument: { defaultView: { ResizeObserver: class {
      constructor(callback) { resized = callback; }
      observe(node) { assert.equal(node, viewport); }
      disconnect() { disconnected = true; }
    } } },
  };
  const guide = { dataset:{}, style:{ setProperty: (name, value) => props.set(name, value) } };
  const stop = watchContainedFrame(viewport, video, guide);
  assert.equal(guide.dataset.frameFit, undefined);
  video.videoWidth = 640; video.videoHeight = 480;
  listeners.get('loadedmetadata')();
  assert.equal(guide.dataset.frameFit, 'ready');
  assert.equal(props.get('--fit-x'), '250.00px');
  resized([{ contentRect: { width:480, height:480 } }]);
  assert.equal(props.get('--fit-x'), '0.00px');
  assert.equal(props.get('--fit-y'), '60.00px');
  assert.equal(props.get('--fit-height'), '360.00px');
  stop();
  assert.equal(disconnected, true);
  assert.equal(listeners.size, 0);
});
