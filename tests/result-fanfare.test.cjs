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

test('top three effects are distinct, decorative and tiered, with the biggest burst on rank 1', () => {
  const result = dialog();
  for (const [rank, color, shape, count] of [
    [1, 'gold', 'ribbon', 132], [2, 'silver', 'diamond', 32], [3, 'bronze', 'ember', 24],
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
  assert.equal(popup.dataset.fanfare, 'mint', 'the next rank should replace the old celebration');
});


test('gold fireworks start at eight points across the viewport with viewport-relative travel', () => {
  const result = dialog();
  apply(result, 1, 'gold');
  const effects = result.querySelector('.result-fanfare').children;
  const launchPoints = effects.filter(x => x.className === 'fanfare-salute');
  assert.equal(launchPoints.length, 8);
  const xs = launchPoints.map(x => parseInt(x.style.get('--x'), 10));
  const ys = launchPoints.map(x => parseInt(x.style.get('--y'), 10));
  assert.ok(Math.min(...xs) < 15 && Math.max(...xs) > 85);
  assert.ok(Math.min(...ys) < 15 && Math.max(...ys) > 85);
  assert.ok(effects.some(x => x.style.get('--dy')?.endsWith('vmin')));
  assert.ok(effects.some(x => x.style.get('--dy')?.endsWith('vh')));
  assert.equal(result.open, false);
});

test('all ranks get a viewport-sized card while gold effects have their own unclipped layer', () => {
  const css = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../result-fanfare.css'), 'utf8');
  assert.match(css, /dialog\[open\]:is\(\.result-dialog,\.result\)\s*\{[^}]*height:100dvh;[^}]*max-width:none;/);
  assert.match(css, /> \.result-content \{[^}]*z-index:2; width:100%; height:100%;/);
  assert.match(css, /\.result-fanfare\s*\{[^}]*z-index:3;[^}]*pointer-events:none;/);
  assert.match(css, /\[data-fanfare="gold"\] \.result-fanfare\s*\{ inset:0;/);
  assert.match(css, /\.result-content > img \{[^}]*52dvh/);
  assert.match(css, /@media \(max-height:500px\) and \(min-width:540px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.fanfare-piece,\.fanfare-salute \{ display:none;/);
});

test('ranks 4 to 12 each get a different lighter palette and use fewer pieces than bronze', () => {
  const result = dialog(), palettes = new Set();
  for (let rank = 4; rank <= 12; rank++) {
    assert.equal(apply(result, rank, 'lower-' + rank), true);
    palettes.add(result.dataset.fanfare);
    assert.equal(result.dataset.fanfareTier, 'light');
    const layer = result.querySelector('.result-fanfare');
    assert.equal(layer.children.filter(x => x.className.startsWith('fanfare-piece ')).length, 16);
    assert.ok(layer.children.every(x => x.className !== 'fanfare-salute'));
  }
  assert.equal(palettes.size, 9);
  assert.equal(apply(result, 3, 'bronze'), true);
  assert.equal(result.dataset.fanfareTier, undefined);
  assert.equal(apply(result, null, 'invalid'), true);
  assert.equal(result.dataset.fanfare, undefined);
  assert.equal(result.querySelector('.result-fanfare'), undefined);
});

test('every rank has contrast-colored stationary edge celebration, including reduced motion', () => {
  const result = dialog();
  for (let rank = 1; rank <= 12; rank += 1) {
    apply(result, rank, 'spark-' + rank);
    const sparks = result.querySelector('.result-fanfare').children.filter(x => x.className === 'fanfare-edge-spark');
    assert.equal(sparks.length, rank === 1 ? 12 : rank <= 3 ? 8 : 6);
    assert.ok(sparks.every(x => Number.parseInt(x.style.get('--x'), 10) < 25 || Number.parseInt(x.style.get('--x'), 10) > 75));
    assert.ok(sparks.every(x => x.textContent && /^#[0-9a-f]+$/i.test(x.style.get('--hue'))));
  }
  const css = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../result-fanfare.css'), 'utf8');
  assert.match(css, /\.fanfare-edge-spark \{[^}]*color:var\(--hue\);[^}]*text-shadow:/);
  assert.doesNotMatch(css.split('@media (prefers-reduced-motion: reduce)')[1], /\.fanfare-edge-spark/);
});
