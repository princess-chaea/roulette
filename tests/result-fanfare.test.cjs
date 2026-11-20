const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apply, syncDialog } = require('../result-fanfare.js');

function dialog() {
  const doc = { createElement: () => node() };
  function node() {
    const style = new Map();
    style.setProperty = style.set;
    return {
      children: [], attributes: {}, dataset: {}, style,
      setAttribute(key, value) { this.attributes[key] = value; },
      append(child) { this.children.push(child); },
      prepend(child) {
        child.remove = () => { this.children = this.children.filter(x => x !== child); };
        this.children.unshift(child);
      },
      querySelector(selector) { return this.children.find(x => '.' + x.className === selector); },
      ownerDocument: doc,
    };
  }
  return Object.assign(node(), {
    open: false, shown: 0, closed: 0,
    showModal() { this.open = true; this.shown++; },
    close() { this.open = false; this.closed++; },
  });
}

test('only ranks 1 to 3 get distinct invisible-to-AT effects and rank 1 has the biggest burst', () => {
  const result = dialog();
  for (const [rank, color, shape, count] of [
    [1, 'gold', 'ribbon', 46], [2, 'silver', 'diamond', 32], [3, 'bronze', 'ember', 24],
  ]) {
    assert.equal(result.open, false);
    assert.equal(apply(result, rank, 'win-' + rank), true);
    assert.equal(result.dataset.fanfare, color);
    assert.equal(result.children.length, 1);
    const layer = result.children[0];
    assert.equal(layer.attributes['aria-hidden'], 'true');
    const pieces = layer.children.filter(piece => piece.className.startsWith('fanfare-piece '));
    assert.equal(pieces.length, count);
    assert.ok(pieces.some(piece => piece.className === 'fanfare-piece ' + shape));
    assert.equal(pieces[0].style.get('--wait'), '0ms');
    assert.equal(apply(result, rank, 'win-' + rank), false);
    assert.equal(result.children[0], layer);
    assert.equal(result.open, false, 'preparing effects must never publish a result');
  }
  for (const rank of [4, 5, 10, 11, 999]) {
    assert.equal(apply(result, rank, 'win-' + rank), true);
    assert.equal(result.dataset.fanfare, undefined);
    assert.equal(result.querySelector('.result-fanfare'), undefined);
  }
});

test('popup waits for the main result to open, builds once, closes, and builds once for the next result', () => {
  const main = dialog(), popup = dialog();
  let synced = 0;
  const sync = () => syncDialog(main, popup, () => { synced++; });
  apply(main, 1, 'a');
  sync(); sync();
  assert.equal(synced, 0);
  assert.equal(popup.open, false);
  main.showModal();
  sync(); sync(); sync();
  assert.equal(synced, 1);
  assert.equal(popup.shown, 1);
  assert.equal(popup.dataset.fanfare, 'gold');
  main.close();
  sync(); sync();
  assert.equal(popup.closed, 1);
  apply(main, 4, 'b'); sync();
  assert.equal(popup.shown, 1);
  main.showModal(); sync(); sync();
  assert.equal(synced, 2);
  assert.equal(popup.shown, 2);
  assert.equal(popup.dataset.fanfare, undefined, 'old celebration must not remain for rank four');
});
