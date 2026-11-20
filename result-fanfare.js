/* Visual-only effects for confirmed results. No lottery randomness is used. */
(() => {
  'use strict';
  const themes = Object.freeze({
    1: Object.freeze({ name: 'gold', count: 132, colors: ['#a34800', '#ffda4d', '#ff9b20', '#fff2a0', '#d85113'] }),
    2: Object.freeze({ name: 'silver', count: 32, colors: ['#4463b5', '#70ccff', '#dae9ff', '#93a8f2', '#0e8ed0'] }),
    3: Object.freeze({ name: 'bronze', count: 24, colors: ['#a34125', '#ffc16e', '#ea7d4c', '#fff0bf', '#cc572b'] })
  });

  const lighterThemes = [
    { name:'mint', type:'leaf', colors:['#49997d','#77bfa3','#ceeede','#2b8a76'] },
    { name:'sky', type:'diamond', colors:['#488ab5','#85c5e9','#cfedff','#4d86b1'] },
    { name:'violet', type:'star', colors:['#8565ad','#b9a2e3','#e4d9ff','#926acb'] },
    { name:'peach', type:'ribbon', colors:['#bb6c52','#ffb58e','#f8d4af','#cc7c5c'] },
    { name:'rose', type:'diamond', colors:['#b65f86','#e8a6c2','#ffd6e2','#d27ba2'] },
    { name:'lime', type:'leaf', colors:['#779940','#afca6d','#e5efac','#9eb953'] },
    { name:'ocean', type:'star', colors:['#247b8f','#68bcc4','#c1ebee','#3d95a6'] },
    { name:'plum', type:'ribbon', colors:['#905d9e','#c09bd2','#eacbed','#9b73b0'] },
    { name:'honey', type:'ember', colors:['#aa8038','#d7b568','#fae9b3','#c19649'] }
  ].map(theme => ({ ...theme, count: 16, light: true }));
  const themeFor = rank => Number.isInteger(rank) && rank > 0
    ? themes[rank] || lighterThemes[(rank - 4) % lighterThemes.length] : null;

  // Edge decoration is always visible, even after the burst has faded or
  // if animation is disabled. Keep its footprint out of the dialog's center.
  const edgeSparks = [
    [8, 12], [92, 13], [12, 30], [87, 32], [9, 69], [91, 69],
    [15, 86], [84, 86], [5, 47], [95, 46], [23, 17], [76, 19],
  ];

  const goldBursts = [[11, 23], [90, 20], [27, 46], [75, 43], [11, 73], [91, 72], [45, 11], [56, 92]];

  function particleFor(theme, i) {
    const angle = i * 2.39996323;
    const direction = i % 2 ? 1 : -1;
    const hue = theme.colors[i % theme.colors.length];
    if (theme.name === 'gold') {
      if (i >= 104) {
        return { x: (i * 19 + 5) % 100, y: 2 + i * 13 % 16,
          dx: direction * (6 + i % 10), dy: 74 + i * 13 % 24, unitX: 'vw', unitY: 'vh',
          turn: direction * (320 + i * 31 % 740), time: 1700 + i * 47 % 1000,
          wait: i % 4 ? 100 + i * 31 % 430 : 0, size: 7 + i * 11 % 13,
          type: i % 5 === 0 ? 'star' : 'ribbon', hue };
      }
      const [x, y] = goldBursts[i % goldBursts.length];
      const spoke = Math.floor(i / goldBursts.length);
      const heading = spoke * 2 * Math.PI / 13 + (i % goldBursts.length) * .35;
      const radius = 9 + i * 13 % 21;
      return { x, y, dx: Math.cos(heading) * radius, dy: Math.sin(heading) * radius + 4,
        unitX: 'vmin', unitY: 'vmin', turn: direction * (180 + i * 31 % 670),
        time: 1150 + i * 47 % 1060, wait: spoke < 5 ? 0 : 90 + i * 23 % 360,
        size: 6 + i * 11 % 14, type: i % 5 === 0 ? 'star' : i % 3 === 0 ? 'streak' : 'ribbon', hue };
    }
    if (theme.name === 'silver') {
      const y = 11 + i * 17 % 49;
      return { x: 50 + direction * (13 + i * 7 % 30), y,
        dx: -direction * (115 + (i * 17 % 120)), dy: -22 + direction * 48 + (i * 29 % 56),
        turn: direction * (70 + i * 19 % 270), time: 850 + i * 41 % 650,
        wait: i < 8 ? 0 : i * 28 % 380, size: 6 + i * 17 % 15,
        type: i % 5 === 0 ? 'star' : 'diamond', hue };
    }
    if (theme.light) {
      return { x: 50 + direction * (24 + i * 11 % 13), y: 22 + i * 17 % 54,
        dx: direction * (12 + i * 11 % 54), dy: -(32 + i * 19 % 106),
        turn: direction * (40 + i * 17 % 180), time: 1510 + i * 43 % 490,
        wait: i < 8 ? 0 : i * 23 % 170, size: 9 + i * 11 % 13,
        type: i % 5 === 0 ? 'star' : theme.type, hue };
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
    delete dialog.dataset.fanfareTier;
    const theme = themeFor(rank);
    if (!theme) return true;
    dialog.dataset.fanfare = theme.name;
    if (theme.light) dialog.dataset.fanfareTier = 'light';
    const doc = dialog.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'result-fanfare';
    layer.setAttribute('aria-hidden', 'true');
    for (const className of ['fanfare-halo', 'fanfare-wave', 'fanfare-wave echo']) {
      const effect = doc.createElement('span');
      effect.className = className;
      layer.append(effect);
    }
    if (theme.name === 'gold') goldBursts.forEach(([x, y], i) => {
      const burst = doc.createElement('span');
      burst.className = 'fanfare-salute';
      burst.style.setProperty('--x', x + '%');
      burst.style.setProperty('--y', y + '%');
      burst.style.setProperty('--wave-time', (950 + i * 53) + 'ms');
      layer.append(burst);
    });
    for (let i = 0; i < theme.count; i++) {
      const { type, x, y, dx, dy, unitX = 'px', unitY = 'px', turn, time, wait, size, hue } = particleFor(theme, i);
      const piece = doc.createElement('span');
      piece.className = 'fanfare-piece ' + type;
      for (const [key, value] of Object.entries({
        '--x': x + '%', '--y': y + '%', '--dx': dx.toFixed(1) + unitX, '--dy': dy.toFixed(1) + unitY,
        '--turn': turn + 'deg', '--time': time + 'ms', '--wait': wait + 'ms',
        '--piece': size + 'px', '--hue': hue
      })) piece.style.setProperty(key, value);
      layer.append(piece);
    }
    const sparkCount = theme.name === 'gold' ? 12 : theme.light ? 6 : 8;
    for (let i = 0; i < sparkCount; i++) {
      const spark = doc.createElement('span');
      const [x, y] = edgeSparks[i];
      spark.className = 'fanfare-edge-spark';
      spark.textContent = theme.name === 'silver' ? (i % 2 ? '✦' : '◆')
        : theme.name === 'bronze' ? (i % 2 ? '✧' : '✦')
        : i % 2 ? '✦' : '✷';
      spark.style.setProperty('--x', x + '%');
      spark.style.setProperty('--y', y + '%');
      spark.style.setProperty('--hue', theme.colors[i % 2 ? 0 : theme.colors.length - 1]);
      spark.style.setProperty('--spark-angle', (i % 2 ? 1 : -1) * (8 + i % 4 * 6) + 'deg');
      layer.append(spark);
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
