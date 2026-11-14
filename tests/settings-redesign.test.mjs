/**
 * The grouped settings panel:
 * groups, station rows, the theme picker, switches, every screen size, and
 * motion that shows what changed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../RadioGridXL.html', import.meta.url), 'utf-8');
const CSS = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');

const station = (id, label = 'Station ' + id) => ({ id, label, sub: 'About ' + id, url: 'https://radio.example/' + id, emoji: '📻', color: 'blue' });
const boot = (cfg = {}, opts = {}) => loadApp({ ...opts, seed: { rgxl_cfg: JSON.stringify({ streams: [station('a'), station('b'), station('c')], ...cfg }) } });
const entry = (w, i) => w.document.querySelector(`#stream-editor .stream-entry[data-idx="${i}"]`);
const row = (w, i) => entry(w, i).querySelector('.stream-row');
const reducedMotion = (win) => {
  const base = win.matchMedia;
  win.matchMedia = (q) => (/prefers-reduced-motion/.test(q) ? { ...base(q), matches: true } : base(q));
};

/** The declarations of a top-level CSS rule whose selector is exactly `selector`. */
function rule(selector, within = CSS) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = within.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`));
  assert.ok(m, `no CSS rule for ${selector}`);
  return Object.fromEntries(m[1].split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
}
/** The text of the @media block that opens with `query`. */
function media(query) {
  const at = CSS.indexOf('@media ' + query + ' {');
  assert.ok(at >= 0, `no @media ${query}`);
  let depth = 0;
  for (let i = CSS.indexOf('{', at); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    if (CSS[i] === '}' && --depth === 0) return CSS.slice(at, i + 1);
  }
  return '';
}

// ── Order and grouping ─────────────────────────────────────────────────────

test('settings reads Stations, Look, Sound and controls, Setup, each under a real heading', () => {
  const w = boot();
  const heads = [...w.document.querySelectorAll('#settings-body h2')].map((h) => h.textContent);
  assert.deepEqual(heads, ['Stations', 'Look', 'Sound and controls', 'Setup']);
  // Every setting lives in one group (none lost in the move).
  const settings = ['stream-editor', 'preset-section', 'theme-section', 'size-section', 'view-section', 'orientation-section',
    'controls-section', 'vol-section', 'haptics-section', 'in-org-name', 'pin-section', 'backup-section', 'help-section', 'device-section', 'reset-btn'];
  for (const id of settings) {
    assert.ok(w.document.getElementById(id).closest('.s-group'), `${id} sits in a group`);
  }
  for (const sw of ['tts', 'chime', 'resume', 'haptics']) {
    assert.ok(w.document.querySelector(`.s-switch[data-switch="${sw}"]`).closest('.s-group'), `${sw} switch in a group`);
  }
  w.close();
});

test('each hint is a short line', () => {
  const w = boot();
  w.openSettings();
  for (const h of w.document.querySelectorAll('#settings-body .s-hint')) {
    if (h.id === 'tts-hint') continue; // carries the per-platform voice note (F18)
    assert.ok(h.textContent.trim().length <= 140, `too long: "${h.textContent.trim()}"`);
  }
  w.close();
});

// ── Stations ───────────────────────────────────────────────────────────────

test('a station is one row that opens its fields under it; only one is open at a time', () => {
  const w = boot();
  w.openSettings();
  assert.ok([0, 1, 2].every((i) => row(w, i).getAttribute('aria-expanded') === 'false'), 'all closed on open');
  assert.ok([0, 1, 2].every((i) => entry(w, i).querySelector('.stream-body').hasAttribute('inert')), 'closed fields are out of reach');
  assert.match(row(w, 1).textContent, /Station b/);
  assert.match(row(w, 1).textContent, /About b/);
  row(w, 1).click();
  assert.equal(row(w, 1).getAttribute('aria-expanded'), 'true');
  assert.equal(entry(w, 1).querySelector('.stream-body').hasAttribute('inert'), false);
  row(w, 0).click();
  assert.equal(row(w, 0).getAttribute('aria-expanded'), 'true');
  assert.equal(row(w, 1).getAttribute('aria-expanded'), 'false', 'the other one closed');
  row(w, 0).click();
  assert.equal(row(w, 0).getAttribute('aria-expanded'), 'false', 'tapping again closes it');
  w.close();
});

test('the tapped row stays put when a station above it closes', () => {
  const w = boot();
  w.openSettings();
  row(w, 0).click(); // station 1 open, above station 3
  const body = w.document.getElementById('settings-body');
  body.scrollTop = 500;
  // Station 3's row sits 300px down while station 1 is open, 100px once it shuts.
  row(w, 2).getBoundingClientRect = () => ({ top: entry(w, 0).classList.contains('open') ? 300 : 100 });
  row(w, 2).click();
  assert.equal(body.scrollTop, 300, 'scrolled by what closed above, so the row did not move');
  w.close();
});

test('typing a name or description updates its row as you go', () => {
  const w = boot();
  w.openSettings();
  row(w, 0).click();
  const name = entry(w, 0).querySelector('[data-field="label"]');
  name.value = 'Kitchen Radio';
  name.dispatchEvent(new w.Event('input'));
  assert.match(row(w, 0).textContent, /Kitchen Radio/);
  w.close();
});

test('Move and Remove are labelled 44pt buttons that never vanish, and focus follows the station', () => {
  const w = boot();
  w.openSettings();
  row(w, 0).click();
  const actions = [...entry(w, 0).querySelectorAll('.stream-action-btn')];
  assert.deepEqual(actions.map((b) => b.textContent.split(':')[0]), ['Move up', 'Move down', 'Remove']);
  assert.equal(actions[0].disabled, true, 'the first station can\'t move up, and says so by being off');
  assert.match(rule('.stream-action-btn')['min-height'], /44px/);
  actions[1].click(); // Station a moves down to second place
  assert.equal(w.eval('cfg').streams[1].id, 'a');
  assert.equal(w.document.activeElement, entry(w, 1).querySelector('[data-action="down"]'), 'focus stays on Move down of the moved station');
  assert.equal(row(w, 1).getAttribute('aria-expanded'), 'true', 'it stays open where it went');
  entry(w, 1).querySelector('[data-action="remove"]').click();
  assert.equal(w.document.activeElement, w.document.getElementById('stream-undo-btn'), 'Remove hands focus to Undo');
  w.document.getElementById('stream-undo-btn').click();
  assert.equal(w.eval('cfg').streams[1].id, 'a', 'back where it was');
  assert.equal(w.document.activeElement, row(w, 1), 'Undo returns focus to the restored station');
  w.close();
});

test('Add by address opens a new station with its address field focused', () => {
  const w = boot();
  w.openSettings();
  w.document.getElementById('stream-add-btn').click();
  assert.equal(w.document.getElementById('stream-add-btn').textContent, 'Add by address');
  assert.equal(row(w, 3).getAttribute('aria-expanded'), 'true');
  assert.equal(w.document.activeElement, entry(w, 3).querySelector('[data-field="url"]'));
  w.close();
});

test('Apply with a bad address on a closed station opens it and puts focus on the field — unhappy path', () => {
  const w = boot();
  w.openSettings();
  entry(w, 2).querySelector('[data-field="url"]').value = 'ftp://nope';
  w.applySettings();
  assert.equal(row(w, 2).getAttribute('aria-expanded'), 'true');
  assert.equal(w.document.activeElement, entry(w, 2).querySelector('[data-field="url"]'));
  assert.equal(w.eval('settingsOpen'), true);
  w.close();
});

test('the station count and the main add button', () => {
  const w = boot();
  w.openSettings();
  assert.equal(w.document.getElementById('stream-count').textContent, '3 of 8');
  assert.match(w.document.querySelector('.stream-browse-btn').textContent, /Browse stations/);
  w.close();
});

// ── Look ───────────────────────────────────────────────────────────────────

const THEMES = ['dark', 'light', 'auto', 'mono-dark', 'mono-light', 'mono-auto', 'contrast-dark', 'contrast-light', 'contrast-auto', 'night'];

test('every saved theme shows as its family and mode, and saves back unchanged', () => {
  for (const theme of THEMES) {
    const w = boot({ theme });
    w.openSettings();
    const parts = w.themeParts(theme);
    assert.equal(w.themeFromParts(parts.family, parts.mode), theme, `${theme} round-trips`);
    const fam = w.document.querySelector('.theme-swatch[aria-checked="true"]');
    assert.equal(fam.dataset.family, parts.family, `${theme}: family`);
    const mode = w.document.querySelector('.theme-modes [aria-checked="true"]');
    assert.equal(mode ? mode.dataset.mode : null, parts.mode, `${theme}: mode`);
    w.applySettings();
    assert.equal(JSON.parse(w.localStorage.getItem('rgxl_cfg')).theme, theme, `${theme}: saved unchanged`);
    w.close();
  }
});

test('Night turns Dark/Light/Auto off and says why; leaving Night brings the last mode back', () => {
  const w = boot({ theme: 'contrast-light' });
  w.openSettings();
  w.selectThemeFamily('night');
  assert.equal(w.eval('cfg').theme, 'night');
  assert.ok([...w.document.querySelectorAll('.theme-modes .chip')].every((b) => b.disabled));
  assert.match(w.document.getElementById('theme-hint').textContent, /Night is always dim/);
  w.selectThemeMode('dark'); // can't happen by tap; ignored anyway
  assert.equal(w.eval('cfg').theme, 'night');
  w.selectThemeFamily('mono');
  assert.equal(w.eval('cfg').theme, 'mono-light', 'Light came back with the new family');
  w.close();
});

test('an unknown theme value shows as Classic Dark rather than nothing — unhappy path', () => {
  const w = loadApp();
  assert.deepEqual({ ...w.themeParts('purple') }, { family: 'default', mode: 'dark' });
  w.close();
});

test('text size shows "Aa" growing from Normal to Ultra, named by the plain size', () => {
  const px = ['normal', 'large', 'xlarge', 'ultra'].map((v) => parseFloat(rule(`.size-chips [data-val="${v}"] .size-aa`)['font-size']));
  assert.ok(px.every((p, i) => i === 0 || p > px[i - 1]), `grows: ${px}`);
  const w = loadApp();
  const ultra = w.document.querySelector('.size-chips [data-val="ultra"]');
  assert.equal(ultra.querySelector('.size-aa').getAttribute('aria-hidden'), 'true');
  assert.ok(!ultra.hasAttribute('aria-label'), 'its name is its visible word');
  w.close();
});

test('orientation choices say what happens, and save the same values', () => {
  const w = loadApp();
  const labels = [...w.document.querySelectorAll('.chip[data-group="orientation"]')].map((b) => [b.dataset.val, b.textContent]);
  assert.deepEqual(labels, [['auto', 'Turn freely'], ['landscape-cw', 'Sideways, buttons left'], ['landscape-ccw', 'Sideways, buttons right']]);
  w.close();
});

// ── Sound and controls ─────────────────────────────────────────────────────

test('Voice, Tones, Auto-resume and Haptics are switches that save on/off', () => {
  const w = boot({ tts: 'off' });
  w.openSettings();
  const tts = w.document.querySelector('.s-switch[data-switch="tts"]');
  assert.equal(tts.getAttribute('role'), 'switch');
  assert.equal(tts.getAttribute('aria-checked'), 'false');
  assert.equal(w.document.getElementById(tts.getAttribute('aria-labelledby')).textContent, 'Voice announcements');
  tts.click();
  assert.equal(tts.getAttribute('aria-checked'), 'true');
  w.applySettings();
  assert.equal(JSON.parse(w.localStorage.getItem('rgxl_cfg')).tts, 'on');
  assert.equal(rule('.s-switch').height, '44px');
  w.close();
});

test('a greyed-out switch does nothing when pressed — unhappy path', () => {
  const w = loadApp({ desktop: true });
  w.openSettings();
  const sw = w.document.querySelector('.s-switch[data-switch="haptics"]');
  const before = w.eval('cfg').haptics;
  assert.equal(sw.disabled, true);
  w.toggleSwitch(sw);
  assert.equal(w.eval('cfg').haptics, before);
  w.close();
});

test('the Simple/Advanced hint describes the one that is picked', () => {
  const w = boot({ advanced: 'off' });
  w.openSettings();
  const hint = w.document.getElementById('controls-hint');
  assert.match(hint.textContent, /One Stop button/);
  w.document.querySelector('.chip[data-group="advanced"][data-val="on"]').click();
  assert.match(hint.textContent, /sleep timer/);
  w.close();
});

// ── Every screen size ──────────────────────────────────────────────────────

test('the header and Apply stay pinned while only the settings scroll', () => {
  const w = loadApp();
  const panel = w.document.getElementById('settings-panel');
  const kids = [...panel.children].map((c) => c.id);
  assert.deepEqual(kids, ['settings-header', 'settings-body', 'settings-footer']);
  assert.ok(w.document.getElementById('settings-footer').contains(w.document.getElementById('apply-btn')));
  assert.equal(rule('#settings-panel').overflow, 'hidden');
  assert.equal(rule('#settings-body')['overflow-y'], 'auto');
  w.close();
});

test('panel width: the full phone screen, a side panel above 480px, wider on a big screen', () => {
  assert.equal(rule('#settings-panel').width, '360px');
  assert.equal(rule('#settings-panel').width && rule('#settings-panel')['max-width'], '100vw', 'never wider than the screen');
  assert.match(media('(max-width: 479px)'), /#settings-panel \{ width: 100vw;/);
  assert.match(media('(min-width: 1200px)'), /#settings-panel \{ width: 480px; \}/);
});

test('a short panel puts the header and Apply on one row (sideways, forced sideways, or keyboard up)', () => {
  for (const [sel, want] of [['#settings-panel.short-panel', /display: grid/], ['#settings-panel.short-panel #settings-footer', /grid-column: 2; grid-row: 1;/], ['#settings-panel.short-panel #settings-body', /grid-column: 1 \/ -1; grid-row: 2;/]]) {
    assert.match(Object.entries(rule(sel)).map(([k, v]) => `${k}: ${v};`).join(' '), want, sel);
  }
  const w = loadApp();
  const panel = w.document.getElementById('settings-panel');
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => 375 });
  w.openSettings();
  assert.ok(panel.classList.contains('short-panel'), '375 tall: one row');
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => 874 });
  w.fitSettingsPanel();
  assert.ok(!panel.classList.contains('short-panel'), '874 tall: header on top, Apply at the bottom');
  w.close();
});

test('with the keyboard up the panel shrinks to what is visible, and goes back on close', () => {
  const w = loadApp({ beforeParse: (win) => {
    const vv = new win.EventTarget();
    Object.assign(vv, { height: 400, offsetTop: 30, width: 402 });
    win.visualViewport = vv;
  } });
  const panel = w.document.getElementById('settings-panel');
  w.openSettings();
  assert.equal(panel.style.top, '30px');
  // jsdom's window is 768 tall: the contents end at 30 + 400, the keyboard's top.
  assert.equal(panel.style.paddingBottom, (w.innerHeight - 430) + 'px');
  assert.ok(panel.classList.contains('short-panel'), '400 visible: one-row header');
  w.doCloseSettings();
  assert.equal(panel.style.paddingBottom, '', 'whole screen again once closed');
  w.close();
});

test('with no keyboard the panel keeps its stylesheet size — unhappy path', () => {
  const w = loadApp({ beforeParse: (win) => {
    const vv = new win.EventTarget();
    Object.assign(vv, { height: win.innerHeight, offsetTop: 0, width: 402 });
    win.visualViewport = vv;
  } });
  w.openSettings();
  assert.equal(w.document.getElementById('settings-panel').style.paddingBottom, '');
  w.close();
});

test('the settings body has no notch padding on its inner edge (sideways, the panel is nowhere near the notch)', () => {
  assert.doesNotMatch(rule('#settings-body').padding, /safe-area/);
  assert.match(rule('#settings-panel')['padding-right'], /safe-area-inset-right/);
  assert.match(rule('#settings-footer').padding, /safe-area-inset-bottom/);
});

test('opening a station never scrolls it away from the finger afterwards', async () => {
  const w = boot();
  w.openSettings();
  let scrolled = 0;
  for (const e of w.document.querySelectorAll('.stream-entry')) e.scrollIntoView = () => { scrolled++; };
  row(w, 1).click();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(scrolled, 0);
  w.close();
});

test('a moved station keeps its place on screen: the list scrolls by what it moved', () => {
  const w = boot();
  w.openSettings();
  const body = w.document.getElementById('settings-body');
  body.scrollTop = 100;
  // In jsdom offsetTop is 0; give each row a real one: 64px apart.
  const orig = Object.getOwnPropertyDescriptor(w.HTMLElement.prototype, 'offsetTop');
  Object.defineProperty(w.HTMLElement.prototype, 'offsetTop', { configurable: true, get() { return this.classList.contains('stream-entry') ? 64 * Number(this.dataset.idx) : 0; } });
  w.moveStream(0, 1); // a: 0 -> 64
  assert.equal(body.scrollTop, 164, 'scrolled 64 down with it');
  assert.equal(w.document.activeElement, entry(w, 1).querySelector('[data-action="down"]'));
  if (orig) Object.defineProperty(w.HTMLElement.prototype, 'offsetTop', orig);
  w.close();
});

test('an unavailable Move shows as a dashed grey outline in High Contrast and Night, which do not fade', () => {
  assert.match(CSS, /html\[class\*="theme-contrast"\] \.stream-action-btn:disabled,\s*html\.theme-night \.stream-action-btn:disabled \{ border-style: dashed; color: var\(--settings-label\); text-decoration: line-through; \}/);
});

// ── Motion that explains ───────────────────────────────────────────────────

test('a station unfolds its height from the row in about 200 ms', () => {
  const body = rule('.stream-body');
  assert.equal(body['grid-template-rows'], '0fr');
  assert.match(body.transition, /grid-template-rows 0\.2s ease-out/);
  assert.equal(rule('.stream-entry.open .stream-body')['grid-template-rows'], '1fr');
});

test('a moved station is highlighted where it lands', () => {
  const w = boot();
  w.openSettings();
  w.moveStream(1, -1);
  assert.equal(entry(w, 0).dataset.id, 'b');
  assert.ok(entry(w, 0).classList.contains('s-changed'));
  w.close();
});

test('FLIP: each station starts where it was and slides home; with reduced motion it just appears', async () => {
  for (const reduced of [false, true]) {
    const w = boot({}, reduced ? { beforeParse: reducedMotion } : {});
    w.openSettings();
    // a and b swapped places: a was at 0, now at 64; b was at 64, now at 0.
    const now = [64, 0, 128];
    [...w.document.querySelectorAll('.stream-entry')].forEach((e, i) => { e.getBoundingClientRect = () => ({ top: now[i] }); });
    const seen = [];
    const mo = new w.MutationObserver((recs) => recs.forEach((r) => seen.push(r.target.dataset.id + ' ' + r.target.getAttribute('style'))));
    mo.observe(w.document.getElementById('stream-editor'), { attributes: true, subtree: true, attributeFilter: ['style'] });
    w.slideStations({ a: 0, b: 64, c: 128 });
    await new Promise((r) => setTimeout(r, 0));
    mo.disconnect();
    if (reduced) {
      assert.deepEqual(seen, [], 'nothing moves');
    } else {
      // The record shows the final style; the start offset is in the sequence of writes.
      const a = entry(w, 0);
      assert.equal(a.style.transition, 'transform 0.22s ease-out');
      assert.equal(a.style.transform, '', 'ends at rest');
      assert.equal(entry(w, 2).style.transition, '', 'a station that did not move is left alone');
    }
    w.close();
  }
});

test('a preset points at each setting it changed', () => {
  const w = boot({ theme: 'auto', size: 'large', tts: 'off' });
  w.openSettings();
  w.applyPreset('Low Vision');
  for (const id of ['theme-section', 'size-section']) {
    assert.ok(w.document.getElementById(id).classList.contains('s-changed'), `${id} highlighted`);
  }
  assert.ok(w.document.querySelector('.s-switch[data-switch="tts"]').closest('.s-section').classList.contains('s-changed'), 'Voice switch highlighted');
  assert.ok(!w.document.getElementById('orientation-section').classList.contains('s-changed'), 'untouched settings are not');
  w.close();
});

test('opening settings highlights nothing — nothing changed yet', () => {
  const w = boot({ theme: 'night', advanced: 'on' });
  w.openSettings();
  assert.equal(w.document.querySelectorAll('.s-changed').length, 0);
  w.close();
});

test('Night points at the modes it switched off, and a rewritten hint is highlighted', () => {
  const w = boot({ theme: 'dark' });
  w.openSettings();
  w.selectThemeFamily('night');
  assert.ok(w.document.querySelector('.theme-modes').classList.contains('s-changed'));
  assert.ok(w.document.getElementById('theme-hint').classList.contains('s-changed'));
  w.close();
});

test('a theme change cross-fades the colours for a moment', () => {
  const w = boot({ theme: 'dark' });
  w.openSettings();
  w.selectThemeMode('light');
  assert.ok(w.document.documentElement.classList.contains('theme-fading'));
  assert.match(CSS, /html\.theme-fading, html\.theme-fading \* \{\s*transition: background-color 0\.25s/);
  w.close();
});

test('settings motion stays at 300 ms or less, and reduced motion keeps the ring without the movement', () => {
  for (const sel of ['.stream-body', '.s-switch-knob', '.stream-row-chevron']) {
    for (const d of rule(sel).transition.match(/\d*\.?\d+s/g)) assert.ok(parseFloat(d) <= 0.3, `${sel}: ${d}`);
  }
  const reduced = media('(prefers-reduced-motion: reduce)');
  assert.match(reduced, /\.s-changed \{ animation: none; box-shadow: 0 0 0 3px var\(--accent\); \}/);
  assert.match(reduced, /html\.theme-fading, html\.theme-fading \* \{ transition: none !important; \}/);
});

// ── Saved settings ─────────────────────────────────────────────────────────

test('a 7.16 config loads with the same choices showing', () => {
  const w = boot({ theme: 'mono-light', size: 'xlarge', advanced: 'on', tts: 'on', chime: 'off', resume: 'on', orientation: 'landscape-ccw' });
  w.openSettings();
  const d = w.document;
  assert.equal(d.querySelector('.theme-swatch[aria-checked="true"]').dataset.family, 'mono');
  assert.equal(d.querySelector('.theme-modes [aria-checked="true"]').dataset.mode, 'light');
  assert.equal(d.querySelector('.chip[data-group="size"][aria-checked="true"]').dataset.val, 'xlarge');
  assert.equal(d.querySelector('.chip[data-group="advanced"][aria-checked="true"]').dataset.val, 'on');
  assert.equal(d.querySelector('.chip[data-group="orientation"][aria-checked="true"]').dataset.val, 'landscape-ccw');
  const on = [...d.querySelectorAll('.s-switch[aria-checked="true"]')].map((s) => s.dataset.switch);
  assert.ok(on.includes('tts') && on.includes('resume') && !on.includes('chime'));
  w.close();
});

// ── VoiceOver stops (a11y/settings-panel.txt) ──────────────────────────────

test('groups are not named regions, so VoiceOver reads each heading once', () => {
  const w = loadApp();
  for (const g of w.document.querySelectorAll('.s-group')) {
    assert.ok(!g.hasAttribute('aria-labelledby') && !g.hasAttribute('aria-label'), 'a named section repeats its heading');
  }
  w.close();
});

test('a switch is one stop: its words name and describe it instead of being read on their own', () => {
  const w = loadApp();
  for (const sw of w.document.querySelectorAll('.s-switch')) {
    const text = sw.closest('.s-switch-row').querySelector('.s-switch-text');
    assert.equal(text.getAttribute('aria-hidden'), 'true');
    assert.ok(text.contains(w.document.getElementById(sw.getAttribute('aria-labelledby'))), 'named by the label beside it');
    assert.ok(text.contains(w.document.getElementById(sw.getAttribute('aria-describedby'))), 'described by the hint beside it');
  }
  w.close();
});

// ── Nothing jumps ──────────────────────────────────────────────────────────

test('Custom holds its place beside the presets, so going custom moves nothing below it', () => {
  const w = boot({ theme: 'auto', size: 'large' });
  w.openSettings();
  const custom = w.document.querySelector('#preset-chips [data-val="custom"]');
  assert.equal(custom.hidden, false, 'always there');
  assert.equal(custom.disabled, true, 'but off until it applies');
  assert.ok(w.document.getElementById('preset-chips').classList.contains('chip-grid-4'), 'on the presets\' own row');
  w.selectThemeMode('dark'); // now custom
  assert.equal(custom.hidden, false);
  assert.equal(custom.disabled, false);
  assert.equal(custom.getAttribute('aria-checked'), 'true');
  assert.ok(custom.classList.contains('s-changed'), 'pointed at as it lights up');
  w.close();
});

test('hints that rewrite themselves keep two lines of room', () => {
  assert.match(CSS, /#theme-hint, #controls-hint \{ min-height: 2\.8em; \}/);
});

test('the Full width badge sits beside a long name instead of being cut off with it — unhappy path', () => {
  const long = 'KNOW 91.1 Minnesota Public Radio News and Classical and Everything Else';
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams: ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ ...station(id, i === 0 ? long : undefined), sub: i === 0 ? long : 'x' })) }) } });
  w.openSettings();
  const badge = row(w, 0).querySelector('.stream-primary-badge');
  assert.ok(badge, 'first of an odd count of 5+ is full width');
  assert.ok(badge.parentElement.classList.contains('stream-row-text'), 'a line of its own under the name and description');
  assert.ok(!badge.closest('.stream-row-sub, .stream-row-name'), 'not inside a line that truncates');
  w.close();
});

test('with the keyboard up, the field in use scrolls into view inside the list, never by moving the panel', () => {
  const w = loadApp({ beforeParse: (win) => {
    const vv = new win.EventTarget();
    Object.assign(vv, { height: 300, offsetTop: 0, width: 402 });
    win.visualViewport = vv;
  } });
  w.openSettings();
  const panel = w.document.getElementById('settings-panel');
  const body = w.document.getElementById('settings-body');
  const field = w.document.getElementById('in-org-name');
  field.focus();
  body.getBoundingClientRect = () => ({ top: 60, bottom: 300 });
  field.getBoundingClientRect = () => ({ top: 500, bottom: 560 });
  field.scrollIntoView = () => assert.fail('scrollIntoView moves the panel too');
  panel.scrollTop = 40;
  w.fitSettingsPanel();
  assert.equal(panel.scrollTop, 0, 'the panel itself is put back');
  assert.equal(body.scrollTop, 268, 'the list scrolled by what the field was below its edge, plus a little');
  w.close();
});

test('the version line shows a build code, the same each time, with no offline cache needed', () => {
  const w = loadApp(); // jsdom has no Cache API, like a phone on a plain-http address
  w.openSettings();
  const first = w.document.getElementById('settings-version').textContent;
  assert.match(first, /^RadioGrid v[0-9.]+ · [0-9a-f]{8}$/);
  w.openSettings();
  assert.equal(w.document.getElementById('settings-version').textContent, first, 'not appended twice, and stable');
  w.close();
});

test('a different build shows a different code — unhappy path for a stale copy', () => {
  const code = (w) => { w.openSettings(); return w.document.getElementById('settings-version').textContent.split(' · ')[1]; };
  const a = loadApp();
  const b = loadApp();
  const extra = b.document.createElement('style');
  extra.textContent = '/* one byte different */';
  b.document.head.appendChild(extra);
  assert.notEqual(code(a), code(b));
  a.close(); b.close();
});
