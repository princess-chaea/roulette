/* Visual-only effects for confirmed results. No lottery randomness is used. */
(() => {
  'use strict';
  const themes = Object.freeze({
    1: Object.freeze({ name: 'gold', count: 46, colors: ['#a34800', '#ffda4d', '#ff9b20', '#fff2a0', '#d85113'] }),
    2: Object.freeze({ name: 'silver', count: 32, colors: ['#4463b5', '#70ccff', '#dae9ff', '#93a8f2', '#0e8ed0'] }),
    3: Object.freeze({ name: 'bronze', count: 24, colors: ['#a34125', '#ffc16e', '#ea7d4c', '#fff0bf', '#cc572b'] })
  });

  function particleFor(theme, i) {
    const angle = i * 2.39996323;
    const direction = i % 2 ? 1 : -1;
    const hue = theme.colors[i % theme.colors.length];
    if (theme.name === 'gold') {
      const radius = 95 + (i * 19 % 106);
      return { x: i % 3 ? 50 : 50 + 24 * direction, y: i % 3 ? 30 : 20,
        dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius * .88 + 28,
        turn: direction * (170 + i * 31 % 460), time: 1100 + i * 47 % 900,
        wait: i < 20 ? 0 : 160 + i * 23 % 330, size: 6 + i * 11 % 11 + i % 4 * 3,
        type: i % 5 === 0 ? 'star' : 'ribbon', hue };
    }
    if (theme.name === 'silver') {
      const y = 11 + i * 17 % 49;
      return { x: 50 + direction * (13 + i * 7 % 30), y,
        dx: -direction * (115 + (i * 17 % 120)), dy: -22 + direction * 48 + (i * 29 % 56),
        turn: direction * (70 + i * 19 % 270), time: 850 + i * 41 % 650,
        wait: i < 8 ? 0 : i * 28 % 380, size: 6 + i * 17 % 15,
        type: i % 5 === 0 ? 'star' : 'diamond', hue };
    }
    return { x: 50 + direction * (20 + i * 11 % 20), y: 59 + i * 13 % 26,
      dx: direction * (8 + i * 11 % 67), dy: -(80 + i * 27 % 138),
      turn: direction * (35 + i * 13 % 120), time: 900 + i * 29 % 520,
      wait: i < 6 ? 0 : i * 45 % 525, size: 4 + i * 19 % 9,
      type: i % 4 === 0 ? 'star' : 'ember', hue };
  }

  function apply(dialog, rank, id) {
    if (!id || dialog.dataset.resultId === id) return false;
    dialog.dataset.resultId = id;
    dialog.dataset.resultRank = String(rank);
    dialog.querySelector('.result-fanfare')?.remove();
    delete dialog.dataset.fanfare;
    const theme = Number.isInteger(rank) ? themes[rank] : null;
    if (!theme) return true;
    dialog.dataset.fanfare = theme.name;
    const doc = dialog.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'result-fanfare';
    layer.setAttribute('aria-hidden', 'true');
    for (const className of ['fanfare-halo', 'fanfare-wave', 'fanfare-wave echo']) {
      const effect = doc.createElement('span');
      effect.className = className;
      layer.append(effect);
    }
    for (let i = 0; i < theme.count; i++) {
      const { type, x, y, dx, dy, turn, time, wait, size, hue } = particleFor(theme, i);
      const piece = doc.createElement('span');
      piece.className = 'fanfare-piece ' + type;
      for (const [key, value] of Object.entries({
        '--x': x + '%', '--y': y + '%', '--dx': dx.toFixed(1) + 'px', '--dy': dy.toFixed(1) + 'px',
        '--turn': turn + 'deg', '--time': time + 'ms', '--wait': wait + 'ms',
        '--piece': size + 'px', '--hue': hue
      })) piece.style.setProperty(key, value);
      layer.append(piece);
    }
    dialog.prepend(layer);
    return true;
  }

  function syncDialog(original, mirror, copyContent) {
    if (!original.open) {
      if (mirror.open) mirror.close();
      return;
    }
    const { resultId, resultRank } = original.dataset;
    if (!resultId) return;
    // Camera status mutations can call this function repeatedly. Each window
    // prepares the visual effect exactly once for this result ID.
    if (mirror.dataset.resultId !== resultId) {
      copyContent();
      apply(mirror, Number(resultRank), resultId);
    }
    if (!mirror.open) mirror.showModal();
  }

  const api = { apply, syncDialog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.RouletteFanfare = api;
})();
