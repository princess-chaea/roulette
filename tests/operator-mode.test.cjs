const { test } = require('node:test');
const assert = require('node:assert/strict');
const FirstPrizeMode = require('../operator-mode.js');
const options = [{ id: 'first', rank: 1, quantity: 1 }, { id: 'second', rank: 2, quantity: 9 }];
test('five consecutive clicks arm, one further click cancels, and five can arm again', () => {
  const mode = new FirstPrizeMode();
  for (let i=0;i<4;i++) assert.equal(mode.click(i*100,true),false);
  assert.equal(mode.click(400,true),true);
  assert.equal(mode.click(500,true),false);
  for (let i=0;i<5;i++) mode.click(600+i*100,true);
  assert.equal(mode.armed,true);
});
test('slow clicks reset the sequence and no first-prize inventory cannot arm', () => {
  const mode = new FirstPrizeMode();
  for (let i=0;i<9;i++) assert.equal(mode.click(i*1000,true),false);
  mode.reset();
  for (let i=0;i<5;i++) mode.click(i*100,false);
  assert.equal(mode.armed,false);
});
test('the selected first prize is consumed only once and does not create stock', () => {
  const mode = new FirstPrizeMode();
  for (let i=0;i<5;i++) mode.click(i*100,true);
  assert.equal(mode.take(options).id,'first');
  assert.equal(mode.take(options),null);
  for (let i=0;i<5;i++) mode.click(600+i*100,true);
  assert.equal(mode.take(options.slice(1)),null);
  assert.equal(mode.armed,false);
  assert.equal(options[0].quantity,1);
});
