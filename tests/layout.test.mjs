/**
 * The sizing math in renderButtons(), on a stubbed screen.
 *
 * jsdom has no layout engine, so these tests give the elements renderButtons()
 * measures fixed sizes and read back what it sets: the header's height follows
 * its .compact class, as it does in a browser. They check the arithmetic, not
 * the paint; how real text wraps still needs a real screen
 * (a real Android WebView or phone).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { bootPlayback, CONNECT_MS } from './playback-fakes.mjs';

// What the CSS gives: the header is a 50 px logo + 20 px padding + 1 px border,
// and 32 + 8 + 1 when compact. The Simple Stop bar is 74 px.
const HEADER_H = 71;
const HEADER_COMPACT_H = 41;
const STOP_H = 74;

const COLORS = ['blue', 'green', 'purple', 'teal', 'red', 'amber', 'slate', 'rose'];
/** n stations, each with a description and an emoji. */
function stations(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 's' + (i + 1),
    label: 'Station ' + (i + 1),
    sub: 'Description ' + (i + 1),
    url: 'https://radio.example/' + (i + 1),
    emoji: '📻',
    color: COLORS[i],
  }));
}

/** Give the app a width x height screen, which #app fills as on a phone. */
function setScreen(w, width, height) {
  const d = w.document;
  const header = d.getElementById('header');
  Object.defineProperty(w, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(w, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(d.getElementById('app'), 'clientHeight', { configurable: true, get: () => height });
  Object.defineProperty(header, 'offsetHeight', {
    configurable: true,
    get: () => (header.classList.contains('compact') ? HEADER_COMPACT_H : HEADER_H),
  });
  Object.defineProperty(d.getElementById('simple-stop'), 'offsetHeight', { configurable: true, value: STOP_H });
}

/** Boot with `cfg` saved, on a width x height screen. */
function boot(cfg, width, height) {
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify(cfg) } });
  setScreen(w, width, height);
  w.applyTheme(); // applies the seeded size and lays the buttons out again
  return w;
}

/** Height the grid takes: its rows, plus the gaps between and around them. */
function gridHeight(w, rows) {
  const style = w.document.getElementById('buttons').style;
  const rowH = parseFloat(style.getPropertyValue('--btn-row-h'));
  const gap = parseFloat(style.getPropertyValue('--btn-gap'));
  return rows * rowH + (rows + 1) * gap;
}

const isCompactHeader = (w) => w.document.getElementById('header').classList.contains('compact');

// ── The header's height after a rotation ───────────────────────────────────

test('turning a phone from landscape to portrait sizes the rows for the full header', () => {
  // 8 stations on a 640 x 300 phone: two rows under 80 px, so the header goes compact.
  const w = boot({ streams: stations(8) }, 640, 300);
  assert.ok(isCompactHeader(w), 'compact header in landscape');
  setScreen(w, 300, 640);
  w.renderButtons();
  assert.ok(!isCompactHeader(w), 'full header in portrait');
  // Portrait: 2 columns, so 4 rows.
  const room = 640 - HEADER_H - STOP_H;
  assert.ok(gridHeight(w, 4) <= room, `rows take ${gridHeight(w, 4)} px of ${room}`);
  w.close();
});

test('laying out the same landscape phone again keeps the compact header, and the rows fit under it', () => {
  const w = boot({ streams: stations(8) }, 640, 300);
  w.renderButtons(); // any later render: a station starts, the theme changes
  assert.ok(isCompactHeader(w), 'still compact');
  // Landscape: two rows of 4.
  const room = 300 - HEADER_COMPACT_H - STOP_H;
  assert.ok(gridHeight(w, 2) <= room, `rows take ${gridHeight(w, 2)} px of ${room}`);
  w.close();
});

test("the header's padding doesn't animate, so measuring it after a change reads its final height", () => {
  const w = loadApp();
  const header = w.document.getElementById('header');
  assert.doesNotMatch(w.getComputedStyle(header).transition, /padding|all/);
  header.classList.add('compact');
  assert.doesNotMatch(w.getComputedStyle(header).transition, /padding|all/);
  w.close();
});

// ── Text sizes: each larger setting shows larger text ──────────────────────

const SIZES = ['normal', 'large', 'xlarge', 'ultra'];
const SCREENS = [[390, 844], [360, 780], [844, 390], [1024, 768], [768, 1024]];

// Real station names, and how wide their words are in em, measured with
// CoreText at 100 px: the widest of SF Pro Black (the iPhone's system font at
// the titles' weight, 900), Helvetica Neue Bold and Arial Bold. jsdom can't
// measure text, so tests that need a width use these.
const NAMES = ['SomaFM Groove Salad', 'SomaFM Drone Zone', 'World News Radio', 'Groove Salad Radio',
  'Classical MPR', 'The Current', 'KUMD Duluth', 'BBC World Service'];
const SPACE_EM = 0.278;
const MEASURED_EM = {
  SomaFM: 4.259, Groove: 3.523, Salad: 2.771, Drone: 2.968, Zone: 2.473,
  News: 2.746, Radio: 2.781, Classical: 4.475, MPR: 2.296, The: 1.849,
  Current: 3.824, KUMD: 3.111, Duluth: 3.290, BBC: 2.167, World: 2.895, Service: 3.740,
  // A station's status
  Not: 1.753, 'available.': 4.670, available: 4.404, Tap: 1.744, to: 1.024, try: 1.440, 'again.': 2.989,
  'Reconnecting…': 7.629,
};

/** n stations with real names. */
function namedStations(n) {
  return stations(n).map((s, i) => ({ ...s, label: NAMES[i] }));
}

/** Give the grid a width as well, so titles are sized to fit it. */
function setGridWidth(w, width) {
  Object.defineProperty(w.document.getElementById('buttons'), 'clientWidth', { configurable: true, get: () => width });
}

/** Lay out `list` at a text size; returns the tiers and the sizes set. */
function layoutAt(w, size, list) {
  w.localStorage.setItem('rgxl_cfg', JSON.stringify({ size, streams: list }));
  w.loadSettings();
  w.applyTheme();
  const buttons = w.document.getElementById('buttons');
  const px = (name) => parseFloat(buttons.style.getPropertyValue(name));
  return {
    compact: buttons.classList.contains('compact-mode'),
    hideSub: buttons.classList.contains('hide-sub'),
    label: px('--btn-label-size'),
    sub: px('--btn-sub-size'),
    emoji: px('--btn-emoji-size'),
  };
}

/** The parts of a button each layout shows. */
const partsShown = ({ compact, hideSub }) => (compact ? ['emoji'] : hideSub ? ['label'] : ['label', 'sub', 'emoji']);

/** A custom property's value on `el`, set inline on it or on a parent. */
function cssVar(el, name) {
  for (let e = el; e; e = e.parentElement) {
    const v = e.style && e.style.getPropertyValue(name);
    if (v) return v;
  }
  return '';
}

/** A CSS length as a browser works it out on `el`: jsdom leaves var(),
    calc(a * b) and vmin as written. */
function cssPx(w, el, value) {
  let v = value;
  while (/var\(/.test(v)) {
    v = v.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, name, fallback) => cssVar(el, name) || (fallback || '').trim());
  }
  v = v.replace(/([\d.]+)vmin/g, (_, n) => (n * Math.min(w.innerWidth, w.innerHeight)) / 100 + 'px');
  const product = v.match(/^calc\(\s*([\d.]+)px\s*\*\s*([\d.]+)\s*\)$/);
  return product ? product[1] * product[2] : parseFloat(v);
}

/** Width the text in `btn` has: its share of a `gridW` px grid, less its
    padding and the border MonoRadio (2 px) and High Contrast (3 px) draw. */
function textWidth(w, btn, gridW) {
  const buttons = w.document.getElementById('buttons');
  const gap = parseFloat(cssVar(buttons, '--btn-gap'));
  const cols = Number(cssVar(buttons, '--btn-cols'));
  const btnW = !buttons.classList.contains('grid-mode') ? gridW - 8 // the stack's 4 px padding
    : btn.classList.contains('primary') ? gridW - 2 * gap
    : (gridW - (cols + 1) * gap) / cols;
  const edge = /theme-contrast/.test(w.document.documentElement.className) ? 3 : 2;
  return btnW - 2 * parseFloat(cssVar(btn, '--btn-pad-h')) - 2 * edge;
}

/** Lines `text` takes at `px` in `width`, wrapping at spaces, at the measured widths. */
function measuredLines(text, px, width) {
  let lines = 1;
  let used = 0;
  for (const word of text.split(' ')) {
    assert.ok(word in MEASURED_EM, `no measured width for "${word}"`);
    const wordW = MEASURED_EM[word] * px;
    if (used > 0 && used + SPACE_EM * px + wordW > width) { lines++; used = wordW; }
    else used += (used > 0 ? SPACE_EM * px : 0) + wordW;
  }
  return lines;
}

/** Whether CSS shows `el`: neither it nor anything above it is display: none. */
function isShown(w, el) {
  for (let e = el; e; e = e.parentElement) {
    if (w.getComputedStyle(e).display === 'none') return false;
  }
  return true;
}

/** How tall `btn`'s content is in a browser: its padding, then each part
    shown at its font size and line height (1 for the emoji, 1.05 a line for
    titles, which wrap; 1.1 a line for a status, which wraps to two at most;
    normal, about 1.2, for the rest), and the gaps between. */
function contentHeight(w, btn, width) {
  let height = 2 * parseFloat(cssVar(btn, '--btn-pad'));
  let parts = 0;
  for (const el of btn.children) {
    if (el.classList.contains('tap-flash') || !isShown(w, el)) continue;
    const px = cssPx(w, el, w.getComputedStyle(el).fontSize);
    const is = (name) => el.classList.contains(name);
    const lines = is('btn-label') ? measuredLines(el.textContent, px, width)
      : is('btn-status') ? Math.min(2, measuredLines(el.textContent, px, width)) : 1;
    const lineHeight = is('btn-emoji') ? 1 : is('btn-label') ? 1.05 : is('btn-status') ? 1.1 : 1.2;
    height += px * lineHeight * lines;
    parts++;
  }
  return height + (parts - 1) * cssPx(w, btn, w.getComputedStyle(btn).gap);
}

/** Height of one row of buttons on a `height` px screen: set on the grid, or
    an equal share of a stack of n (4 px padding and gaps). */
function rowHeight(w, n, height) {
  const buttons = w.document.getElementById('buttons');
  if (buttons.classList.contains('grid-mode')) return parseFloat(cssVar(buttons, '--btn-row-h'));
  const room = height - w.document.getElementById('header').offsetHeight - STOP_H;
  return (room - 8 - (n - 1) * 4) / n;
}

test('each larger text size shows larger text, on phones and tablets, for 1 to 8 stations', () => {
  // Sized by height alone: the grid has no width here, so no title is held
  // to the width of its longest word (the next test covers that).
  const w = loadApp();
  for (const [width, height] of SCREENS) {
    setScreen(w, width, height);
    for (let n = 1; n <= 8; n++) {
      const at = SIZES.map((size) => layoutAt(w, size, stations(n)));
      assert.ok(at.every((a) => a.compact === at[0].compact && a.hideSub === at[0].hideSub), 'one layout for every size');
      for (const part of partsShown(at[0])) {
        const px = at.map((a) => a[part]);
        const where = `${width}x${height}, ${n} stations, ${part}: ${px.join(' < ')}`;
        for (let i = 1; i < px.length; i++) assert.ok(px[i] > px[i - 1], where);
      }
    }
  }
  w.close();
});

test('with real station names in any order, every word of a title fits its button, and a larger size never shows smaller text', () => {
  // Which names share the grid, and where, decides which word holds titles to
  // a width and where they wrap, so every rotation of NAMES is laid out.
  const w = loadApp();
  for (const [width, height] of SCREENS) {
    setScreen(w, width, height);
    setGridWidth(w, width);
    for (let first = 0; first < NAMES.length; first++) {
      const names = [...NAMES.slice(first), ...NAMES.slice(0, first)];
      for (let n = 1; n <= 8; n++) {
        const list = stations(n).map((s, i) => ({ ...s, label: names[i] }));
        const at = SIZES.map((size) => {
          const a = layoutAt(w, size, list);
          if (a.compact) return a; // no titles
          for (const btn of w.document.querySelectorAll('.stream-btn')) {
            const room = textWidth(w, btn, width);
            for (const word of btn.querySelector('.btn-label').textContent.split(' ')) {
              const wordW = MEASURED_EM[word] * a.label;
              assert.ok(wordW <= room, `${width}x${height}, ${n} stations from "${names[0]}", ${size}: "${word}" is ${wordW.toFixed(1)} px, its button has ${room.toFixed(1)}`);
            }
          }
          return a;
        });
        for (const part of partsShown(at[0])) {
          const px = at.map((a) => a[part]);
          const where = `${width}x${height}, ${n} stations from "${names[0]}", ${part}: ${px.join(', ')}`;
          // Titles can tie where a long word or a wrap holds every size to
          // one size; descriptions and emoji never do.
          for (let i = 1; i < px.length; i++) assert.ok(part === 'label' ? px[i] >= px[i - 1] : px[i] > px[i - 1], where);
        }
      }
    }
  }
  w.close();
});

test('a word too long for its button at any size still leaves a larger size with larger text', () => {
  // Past the smallest title the word is cut off at every size, so every size
  // stops at that same title, and the description and icon keep their order.
  // A small phone (320x568) is where a different smallest title per size
  // showed Ultra a smaller description than X-Large.
  const w = loadApp();
  for (const [width, height] of [...SCREENS, [320, 568], [412, 915]]) {
    setScreen(w, width, height);
    setGridWidth(w, width);
    for (let n = 1; n <= 8; n++) {
      const list = stations(n).map((s, i) => ({ ...s, label: i === 1 ? 'Supercalifragilisticexpialidocious Radio' : NAMES[i] }));
      const at = SIZES.map((size) => layoutAt(w, size, list));
      for (const part of partsShown(at[0])) {
        const px = at.map((a) => a[part]);
        const where = `${width}x${height}, ${n} stations, ${part}: ${px.join(', ')}`;
        for (let i = 1; i < px.length; i++) assert.ok(part === 'label' ? px[i] >= px[i - 1] : px[i] > px[i - 1], where);
      }
    }
  }
  w.close();
});

test('the width estimate for titles errs wide of the real fonts, by less than a fifth', () => {
  const w = loadApp();
  for (const [word, em] of Object.entries(MEASURED_EM)) {
    const estimate = w.textWidthEm(word);
    assert.ok(estimate >= em && estimate < em * 1.2, `${word}: ${estimate.toFixed(3)} em estimated, ${em} measured`);
  }
  w.close();
});

test('Ultra text takes the sizes the fit math sets in every layout, compact included', () => {
  const w = loadApp();
  // Stacked, grid, a full grid, and compact (7 on a very short landscape screen).
  for (const [n, width, height] of [[2, 390, 844], [4, 390, 844], [8, 390, 844], [7, 640, 240]]) {
    setScreen(w, width, height);
    const at = layoutAt(w, 'ultra', stations(n));
    if (n === 7) assert.ok(at.compact, '7 stations at 640 x 240 are compact');
    const btn = w.document.querySelector('.stream-btn');
    for (const [part, prop] of [['.btn-label', '--btn-label-size'], ['.btn-sublabel', '--btn-sub-size'], ['.btn-emoji', '--btn-emoji-size']]) {
      const el = btn.querySelector(part);
      if (!el) continue; // compact shows only the emoji
      assert.match(w.getComputedStyle(el).fontSize, new RegExp('^var\\(' + prop + '\\b'), `${n} stations, ${part}`);
    }
  }
  w.close();
});

test('Ultra on a phone shows bigger text than X-Large: 64 px titles with 1 station', () => {
  const w = loadApp();
  setScreen(w, 390, 844);
  assert.equal(layoutAt(w, 'xlarge', stations(1)).label, 52);
  assert.equal(layoutAt(w, 'ultra', stations(1)).label, 64);
  w.close();
});

// ── The playing/paused glyph ────────────────────────────────────────────────

test('a playing station shows its ▮▮ glyph in compact mode, at every text size', async () => {
  const t = bootPlayback({ cfg: { streams: stations(8) } });
  setScreen(t.w, 300, 390); // rows under 70 px: compact
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  for (const size of SIZES) {
    assert.ok(layoutAt(t.w, size, stations(8)).compact, `${size}: compact`);
    const glyph = t.button('s1').querySelector('.btn-state');
    const px = cssPx(t.w, glyph, t.w.getComputedStyle(glyph).fontSize);
    assert.ok(px >= 12, `${size}: the glyph is ${px} px`);
    // The 12 px floor is counted in the fit: the playing button still fits its row.
    const btn = t.button('s1');
    const content = contentHeight(t.w, btn, textWidth(t.w, btn, 300));
    const row = rowHeight(t.w, 8, 390);
    assert.ok(content <= row, `${size}: ${content.toFixed(1)} px of content in a ${row} px row`);
  }
  t.w.close();
});

test("a playing station's button fits its row, glyph and all, and starting it resizes nothing", async () => {
  for (const [width, height] of SCREENS) {
    const t = bootPlayback({ cfg: { streams: namedStations(1) } });
    setScreen(t.w, width, height);
    setGridWidth(t.w, width);
    const idle = {};
    for (let n = 1; n <= 8; n++) for (const size of SIZES) idle[n + size] = layoutAt(t.w, size, namedStations(n));
    t.w.playStream('s1');
    await t.clock.tick(CONNECT_MS);
    for (let n = 1; n <= 8; n++) {
      for (const size of SIZES) {
        const where = `${width}x${height}, ${n} stations, ${size}`;
        assert.deepEqual(layoutAt(t.w, size, namedStations(n)), idle[n + size], `${where}: same sizes as before it started`);
        const btn = t.button('s1');
        assert.ok(btn.classList.contains('active'), where);
        const content = contentHeight(t.w, btn, textWidth(t.w, btn, width));
        const row = rowHeight(t.w, n, height);
        assert.ok(content <= row, `${where}: ${content.toFixed(1)} px of content in a ${row.toFixed(1)} px row`);
      }
    }
    t.w.close();
  }
});

// ── A station in trouble says so in every layout ───────────────────────────

const GIVE_UP_MS = 4 * (4000 + CONNECT_MS); // four tries, 4 s apart
const FULL_STATUS = 'Not available. Tap to try again.';
const FAILED_LABEL = NAMES[0] + ', not available';

/** n named stations on a width x height screen, with station 1 tried until
    the app gives up on it. `cfg` adds settings (size, theme). Runs on the
    fake clock and media element. */
async function failFirst(n, width, height, cfg = {}) {
  const list = namedStations(n);
  const t = bootPlayback({ cfg: { size: 'large', ...cfg, streams: list } });
  setScreen(t.w, width, height);
  setGridWidth(t.w, width);
  t.w.applyTheme(); // applies the seeded size and theme
  t.audio.route(list[0].url, 'dead');
  t.w.playStream('s1');
  await t.clock.tick(GIVE_UP_MS + 1000);
  return t;
}

/** n named stations at `size`, with station 1 playing and then dropping out,
    so the app is trying it again. */
async function reconnectFirst(n, width, height, size) {
  const t = bootPlayback({ cfg: { size, streams: namedStations(n) } });
  setScreen(t.w, width, height);
  setGridWidth(t.w, width);
  t.w.applyTheme(); // applies the seeded size
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  t.audio.drop();
  await t.clock.tick(0);
  return t;
}

const statusOf = (t, id) => t.button(id).querySelector('.btn-status');
const fontPx = (w, el) => cssPx(w, el, w.getComputedStyle(el).fontSize);

test('where descriptions are hidden, a failed station still shows "Not available. Tap to try again.", wrapping', async () => {
  // 4 stations on a landscape phone: rows under 130 px, so descriptions go.
  const t = await failFirst(4, 844, 390);
  assert.ok(t.w.document.getElementById('buttons').classList.contains('hide-sub'));
  const status = statusOf(t, 's1');
  assert.equal(status && status.textContent, FULL_STATUS);
  assert.ok(isShown(t.w, status), 'status is shown');
  assert.equal(t.w.getComputedStyle(status).whiteSpace, 'normal', 'it wraps instead of being cut short');
  assert.equal(t.label('s1'), FAILED_LABEL);
  // Another station's description stays hidden.
  assert.ok(!isShown(t.w, t.button('s2').querySelector('.btn-sublabel')));
  t.w.close();
});

test('in compact mode a failed station shows "Not available"', async () => {
  // Screens short enough that 6 to 8 stations' rows are under 70 px.
  for (const [n, width, height] of [[6, 640, 240], [7, 640, 240], [8, 300, 390]]) {
    const t = await failFirst(n, width, height);
    assert.ok(t.w.document.getElementById('buttons').classList.contains('compact-mode'), `${n} stations: compact`);
    const status = statusOf(t, 's1');
    assert.equal(status && status.textContent, 'Not available', `${n} stations`);
    assert.ok(isShown(t.w, status), `${n} stations: status is shown`);
    assert.ok(fontPx(t.w, status) >= 12, `${n} stations: status is ${fontPx(t.w, status)} px`);
    assert.equal(t.label('s1'), FAILED_LABEL);
    assert.equal(statusOf(t, 's2'), null, 'only the failed station');
    t.w.close();
  }
});

test('while retrying, "Reconnecting…" shows even where descriptions are hidden', async () => {
  const t = await reconnectFirst(4, 844, 390, 'large');
  assert.ok(t.w.document.getElementById('buttons').classList.contains('hide-sub'));
  const status = statusOf(t, 's1');
  assert.equal(status && status.textContent, 'Reconnecting…');
  assert.ok(isShown(t.w, status), 'status is shown');
  t.w.close();
});

test("a failed station's button makes room for its status, and the other stations keep their size", async () => {
  // Landscape phone: 4 to 6 stations hide descriptions, and the rows are short.
  for (const size of ['large', 'ultra']) {
    for (const n of [4, 5, 6]) {
      const t = await failFirst(n, 844, 390, { size });
      const where = `${size}, ${n} stations`;
      const btn = t.button('s1');
      assert.ok(isShown(t.w, statusOf(t, 's1')), `${where}: status is shown`);
      const content = contentHeight(t.w, btn, textWidth(t.w, btn, 844));
      const row = rowHeight(t.w, n, 390);
      assert.ok(content <= row, `${where}: ${content.toFixed(1)} px of content in a ${row} px row`);
      // The grid has the sizes of the same screen with nothing failed.
      const calm = loadApp();
      setScreen(calm, 844, 390);
      setGridWidth(calm, 844);
      layoutAt(calm, size, namedStations(n));
      for (const name of ['--btn-label-size', '--btn-sub-size', '--btn-emoji-size', '--btn-pad']) {
        assert.equal(cssVar(t.w.document.getElementById('buttons'), name), cssVar(calm.document.getElementById('buttons'), name), `${where}: ${name}`);
      }
      assert.equal(t.button('s2').style.getPropertyValue('--btn-label-size'), '', `${where}: station 2 has the grid's sizes`);
      calm.close();
      t.w.close();
    }
  }
});

test('on a two-column phone, the status says just "Not available" where the full text would need a third line', async () => {
  // 4 stations on a 390 x 844 phone: two columns, about 150 px for text. The
  // full text takes two lines at Normal's 15 px; from Large's 18 px up, three.
  const expected = [['normal', FULL_STATUS], ['large', 'Not available'], ['xlarge', 'Not available'], ['ultra', 'Not available']];
  for (const [size, text] of expected) {
    const t = await failFirst(4, 390, 844, { size });
    const status = statusOf(t, 's1');
    assert.equal(status && status.textContent, text, size);
    const px = fontPx(t.w, status);
    const lines = measuredLines(status.textContent, px, textWidth(t.w, t.button('s1'), 390));
    assert.ok(lines <= 2, `${size}: ${lines} lines at ${px} px`);
    assert.equal(t.label('s1'), FAILED_LABEL, `${size}: the full text is still in its name`);
    t.w.close();
  }
});

test("on a landscape phone, a failed station's status is never under 12 px, and its button still fits its row", async () => {
  // Rows there are short enough that the grid's scale alone would take the
  // status to about 10 px at Normal and Large.
  for (const [width, height] of [[844, 390], [780, 360]]) {
    for (const size of SIZES) {
      for (let n = 1; n <= 8; n++) {
        const t = await failFirst(n, width, height, { size });
        const where = `${width}x${height}, ${size}, ${n} stations`;
        const status = statusOf(t, 's1');
        assert.ok(status && isShown(t.w, status), `${where}: status is shown`);
        assert.ok(fontPx(t.w, status) >= 12, `${where}: status is ${fontPx(t.w, status)} px`);
        const btn = t.button('s1');
        const content = contentHeight(t.w, btn, textWidth(t.w, btn, width));
        const row = rowHeight(t.w, n, height);
        assert.ok(content <= row, `${where}: ${content.toFixed(1)} px of content in a ${row.toFixed(1)} px row`);
        t.w.close();
      }
    }
  }
});

test('"Reconnecting…" fits its button on a two-column phone, at every text size', async () => {
  for (const size of SIZES) {
    const t = await reconnectFirst(4, 390, 844, size);
    const status = statusOf(t, 's1');
    assert.equal(status && status.textContent, 'Reconnecting…', size);
    const wordW = MEASURED_EM['Reconnecting…'] * fontPx(t.w, status);
    const room = textWidth(t.w, t.button('s1'), 390);
    assert.ok(wordW <= room, `${size}: ${wordW.toFixed(1)} px of text in ${room.toFixed(1)}`);
    t.w.close();
  }
});

test('the status is as strong as the title, not dimmed like a description, on dark and Low Vision themes', async () => {
  for (const theme of ['dark', 'mono-dark']) {
    const t = await failFirst(2, 390, 844, { theme });
    const status = statusOf(t, 's1');
    const title = t.button('s1').querySelector('.btn-label');
    const css = t.w.getComputedStyle(status);
    assert.equal(css.opacity, '1', theme);
    assert.equal(css.color, t.w.getComputedStyle(title).color, `${theme}: title colour`);
    t.w.close();
  }
});

test('6 to 8 stations keep their names on a phone and a tablet, with descriptions where rows are tall', () => {
  const w = loadApp();
  for (const [width, height] of [[390, 844], [844, 390], [1024, 768], [768, 1024], [1280, 800]]) {
    for (const n of [6, 7, 8]) {
      setScreen(w, width, height);
      setGridWidth(w, width);
      const at = layoutAt(w, 'large', namedStations(n));
      assert.equal(at.compact, false, `${n} stations on ${width} x ${height}: names shown`);
    }
  }
  // A portrait tablet has the room for descriptions too.
  setScreen(w, 768, 1024);
  setGridWidth(w, 768);
  assert.equal(layoutAt(w, 'large', namedStations(8)).hideSub, false, '8 on a portrait tablet: descriptions shown');
  w.close();
});

test('a row too short for a name still goes emoji-only, at any station count from 5 — unhappy path', () => {
  const w = loadApp();
  for (const [n, width, height] of [[5, 640, 240], [6, 640, 240], [7, 640, 240], [8, 300, 390]]) {
    setScreen(w, width, height);
    assert.equal(layoutAt(w, 'large', stations(n)).compact, true, `${n} stations on ${width} x ${height}`);
  }
  w.close();
});

test('names-only rows keep the station icon where it fits, and the button still fits its row', () => {
  const w = loadApp();
  setScreen(w, 844, 390);
  setGridWidth(w, 844);
  for (const n of [4, 7, 8]) {
    const at = layoutAt(w, 'large', namedStations(n));
    assert.ok(at.hideSub && !at.compact, `${n} stations: names only`);
    assert.ok(w.document.getElementById('buttons').classList.contains('keep-icon'), `${n} stations: icon kept`);
    const btn = w.document.querySelectorAll('.stream-btn')[n % 2 ? 1 : 0]; // not the odd grid's wide primary
    assert.ok(isShown(w, btn.querySelector('.btn-emoji')), `${n} stations: icon shown`);
    const content = contentHeight(w, btn, textWidth(w, btn, 844));
    const row = rowHeight(w, n, 390);
    assert.ok(content <= row, `${n} stations: ${content.toFixed(1)} px of content in a ${row} px row`);
  }
  w.close();
});

test('where the icon would cost the name more than 15%, names-only rows drop it — unhappy path', () => {
  const w = loadApp();
  setScreen(w, 844, 390);
  setGridWidth(w, 844);
  for (const n of [5, 6]) { // 3 + 2 and 3 + 3: titles held by height, which the icon would take
    const at = layoutAt(w, 'large', namedStations(n));
    assert.ok(at.hideSub && !at.compact, `${n} stations: names only`);
    assert.ok(!w.document.getElementById('buttons').classList.contains('keep-icon'), `${n} stations: no icon`);
    assert.ok(!isShown(w, w.document.querySelector('.stream-btn .btn-emoji')), `${n} stations: icon hidden`);
  }
  w.close();
});

// ── Sideways phones: two even rows, with names ─────────────────────────────

test('a sideways phone splits 5 to 8 stations into two even rows, never a full-width first button', () => {
  const w = loadApp();
  // iPhone 17 and iPhone SE, sideways.
  for (const [width, height] of [[874, 402], [667, 375]]) {
    setScreen(w, width, height);
    setGridWidth(w, width);
    for (const [n, cols] of [[5, 3], [6, 3], [7, 4], [8, 4]]) {
      const at = layoutAt(w, 'normal', namedStations(n));
      const buttons = w.document.getElementById('buttons');
      assert.equal(Number(buttons.style.getPropertyValue('--btn-cols')), cols, `${width}x${height}, ${n} stations: ${cols} a row`);
      assert.equal(buttons.querySelectorAll('.stream-btn.primary').length, 0, `${width}x${height}, ${n} stations: no full-width button`);
      assert.ok(!at.compact, `${width}x${height}, ${n} stations: names, not icons only`);
      const room = height - w.document.getElementById('header').offsetHeight - STOP_H;
      assert.ok(gridHeight(w, 2) <= room, `${width}x${height}, ${n} stations: two rows fit (${gridHeight(w, 2)} of ${room} px)`);
    }
  }
  w.close();
});

test('upright, an odd count still leads with a full-width first button — unhappy path for the sideways rule', () => {
  const w = loadApp();
  setScreen(w, 402, 874);
  setGridWidth(w, 402);
  layoutAt(w, 'normal', namedStations(5));
  assert.equal(w.document.querySelectorAll('#buttons .stream-btn.primary').length, 1);
  w.close();
});
