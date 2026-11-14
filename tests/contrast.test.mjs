/**
 * Colour contrast, measured from the app's own stylesheet and PALETTE, so a
 * colour edit can't quietly break the claim in the PALETTE comment: station
 * text holds WCAG AA 4.5:1 in every colour, theme and state, and the marks
 * that show a state (the ring, ▮▮ and ▶) hold 3:1 (WCAG 1.4.11).
 *
 * jsdom doesn't paint, so this reads RadioGridXL.html as text: theme tokens
 * from the :root and html.theme-* blocks, colours, opacities and filters from
 * the rules that style each state. It then composites them the way a browser
 * does: opacity and rgba blend over what's behind, brightness() and
 * grayscale() act on the sRGB values. It models only the rules named here.
 * Run with: npm run test:dom
 *
 * The same check also measures the painted page in Chromium
 * (contrast-rendered.mjs, imported below): every theme, size and screen
 * shape, which reaches the @media rules, size classes and selectors this
 * model doesn't name.
 */
import './contrast-rendered.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'RadioGridXL.html'), 'utf-8');

// ── WCAG 2.x contrast ─────────────────────────────────────────────────────
const linear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** `fg` at `alpha` over an opaque `bg`, blended in sRGB as browsers do. */
const over = (fg, alpha, bg) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

/** Notes a pair that falls short, so one run lists every failure at once. */
function measure(problems, what, fg, bg, min) {
  const r = contrast(fg, bg);
  if (r < min) problems.push(`${what}: ${r.toFixed(2)}:1, needs ${min}:1`);
}

// ── The stylesheet ────────────────────────────────────────────────────────
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule as { selectors, media, decls }; @media/@supports blocks nest one level. */
function parseRules(src) {
  const rules = [];
  const media = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    const close = src.indexOf('}', i);
    if (open === -1 && close === -1) break;
    if (close !== -1 && (open === -1 || close < open)) { media.pop(); i = close + 1; continue; }
    const prelude = src.slice(i, open).trim();
    if (prelude.startsWith('@')) { media.push(prelude); i = open + 1; continue; }
    const end = src.indexOf('}', open);
    const decls = {};
    for (const d of src.slice(open + 1, end).split(';')) {
      const k = d.indexOf(':');
      if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).replace('!important', '').trim();
    }
    rules.push({ selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), media: media.join(' '), decls });
    i = end + 1;
  }
  return rules;
}
const RULES = parseRules(css);

/** Declarations for `selector` outside any @media, later rules winning ({} if none). */
function decls(selector, media = '') {
  return Object.assign({}, ...RULES.filter((r) => r.media === media && r.selectors.includes(selector)).map((r) => r.decls));
}
/** Same, but the rule must exist: a renamed selector fails loudly instead of passing. */
function need(selector, media = '') {
  const d = decls(selector, media);
  assert.ok(Object.keys(d).length, `no CSS rule for ${selector} ${media}`);
  return d;
}

const THEMES = ['dark', 'light', 'mono-dark', 'mono-light', 'contrast-dark', 'contrast-light', 'night'];
const MONO = 'html[class*="theme-mono"] ';
const HC = 'html[class*="theme-contrast"] ';
const NIGHT = 'html.theme-night ';
/** The rules a theme family adds on top of the base ones ('' for the colour themes). */
const family = (theme) => (theme.startsWith('mono') ? MONO : theme.startsWith('contrast') ? HC : theme === 'night' ? NIGHT : '');
/** High Contrast promises more: text 7:1 (AAA), edges and marks 4.5:1. */
const textMin = (theme) => (theme.startsWith('contrast') ? 7 : 4.5);
const markMin = (theme) => (theme.startsWith('contrast') ? 4.5 : 3);

/** A theme's custom properties: dark is :root; the others override it on <html>. */
function tokens(theme) {
  return { ...need(':root'), ...(theme === 'dark' ? {} : need(`html.theme-${theme}`)) };
}
function resolve(value, tk) {
  for (let n = 0; /var\(/.test(value); n++) {
    assert.ok(n < 10, `var() loop in ${value}`);
    value = value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/, (_, name, fallback) => {
      const v = tk[name] ?? fallback;
      assert.ok(v !== undefined, `${name} is not defined`);
      return v;
    });
  }
  return value;
}
/** '#rgb', '#rrggbb' or 'rgba(r, g, b, a)' → { rgb, alpha }. */
function colour(value) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), alpha: 1 };
  }
  const fn = value.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(fn, `not a colour this test reads: ${value}`);
  const [r, g, b, a = 1] = fn[1].split(',').map(Number);
  return { rgb: [r, g, b], alpha: a };
}

/** CSS grayscale(amount): the Filter Effects matrix, on sRGB values. */
function grayscale([r, g, b], amount) {
  const k = 1 - amount;
  return [
    (0.2126 + 0.7874 * k) * r + (0.7152 - 0.7152 * k) * g + (0.0722 - 0.0722 * k) * b,
    (0.2126 - 0.2126 * k) * r + (0.7152 + 0.2848 * k) * g + (0.0722 - 0.0722 * k) * b,
    (0.2126 - 0.2126 * k) * r + (0.7152 - 0.7152 * k) * g + (0.0722 + 0.9278 * k) * b,
  ];
}
function applyFilter(c, filter = 'none') {
  for (const [, fn, arg] of filter.matchAll(/([a-z]+)\(([\d.]+)\)/g)) {
    if (fn === 'brightness') c = c.map((v) => Math.min(255, v * Number(arg)));
    else if (fn === 'grayscale') c = grayscale(c, Number(arg));
    else assert.fail(`filter ${fn}() isn't modelled`);
  }
  return c;
}

// ── PALETTE ───────────────────────────────────────────────────────────────
const PALETTE = [...html.matchAll(/\{ id: '([a-z]+)',\s*dark: \{ bg: '(#[0-9a-f]{6})', active: '(#[0-9a-f]{6})' \}, light: \{ bg: '(#[0-9a-f]{6})', active: '(#[0-9a-f]{6})' \} \}/g)]
  .map((m) => ({ id: m[1], dark: { bg: m[2], active: m[3] }, light: { bg: m[4], active: m[5] } }));

// ── A stream button, as painted ───────────────────────────────────────────
/** A selector's style in `theme`: the base rule, then the mono and theme overrides. */
function styleOf(theme, selector) {
  const layers = [selector];
  if (family(theme)) layers.push(family(theme) + selector);
  layers.push(`html.theme-${theme} ${selector}`);
  return Object.assign({}, ...layers.map((s) => decls(s)));
}

/** Inset rings in a box-shadow, outermost first, each only where it shows
    (a later shadow paints under an earlier one). Glows are skipped. */
function insetRings(shadow, tk) {
  const rings = [];
  let covered = 0;
  for (const part of (shadow || '').split(/,(?![^(]*\))/)) {
    const m = part.trim().match(/^inset 0 0 0 (\d+)px (.+)$/);
    if (m && Number(m[1]) > covered) { rings.push(colour(resolve(m[2], tk)).rgb); covered = Number(m[1]); }
  }
  return rings;
}

const HOVER_MEDIA = '@media (hover: hover) and (pointer: fine)';

/**
 * What a station button shows in `theme` and `state` (idle | active | paused |
 * failed), each colour as it reaches the screen. MonoRadio and High Contrast
 * ignore the station colour. `hover` lays the desktop hover tint (.stream-btn:hover::after, which
 * sits over the text too) on top.
 */
function paint(theme, state, entry, { hover = false } = {}) {
  const tk = tokens(theme);
  const flat = family(theme);
  const key = theme.endsWith('light') ? 'light' : 'dark';
  const page = colour(resolve(tk['--screen-bg'], tk)).rgb;
  const st = state === 'idle' ? {} : (need(`.stream-btn.${state}`), styleOf(theme, `.stream-btn.${state}`));
  // The station colour is an inline style, so only an !important background
  // replaces it; MonoRadio's and High Contrast's own !important rules are
  // more specific than a state's, so there only their state rules can.
  const bg = flat
    ? colour(resolve(decls(flat + `.stream-btn.${state}`).background ?? decls(flat + '.stream-btn').background, tk)).rgb
    : colour(resolve(st.background ?? entry[key][state === 'active' ? 'active' : 'bg'], tk)).rgb;
  const tint = hover ? colour(need('.stream-btn:hover::after', HOVER_MEDIA).background) : null;
  // The whole button (hover tint included) is filtered, then faded over the
  // page: its text too.
  const shown = (c) => over(applyFilter(tint ? over(tint.rgb, tint.alpha, c) : c, st.filter), Number(st.opacity ?? 1), page);
  const styleIn = (selector) => ({ ...styleOf(theme, selector), ...styleOf(theme, `.stream-btn.${state} ${selector}`) });
  const text = (selector) => {
    need(selector);
    const s = styleIn(selector);
    const c = colour(resolve(s.color, tk));
    return shown(over(c.rgb, c.alpha * Number(s.opacity ?? 1), bg));
  };
  need('.btn-state');
  const glyph = styleIn('.btn-state');
  const glyphOpacity = Number(glyph.opacity ?? 1);
  const border = (st.border || '').match(/^(\d+)px (solid|dashed|dotted) (.+)$/);
  return {
    page,
    bg: shown(bg),
    label: text('.btn-label'),
    sub: text('.btn-sublabel'),
    glyph: shown(colour(resolve(glyph.color, tk)).rgb),
    glyphOpacity,
    // A solid border on a playing button is the outermost band of its ring.
    rings: [...(state === 'active' && st['border-color'] ? [colour(resolve(st['border-color'], tk)).rgb] : []),
      ...insetRings(st['box-shadow'], tk)].map(shown),
    border: border && { style: border[2], colour: shown(colour(resolve(border[3], tk)).rgb) },
  };
}

/** Every station colour in the colour themes; MonoRadio and High Contrast paint them all alike. */
function* buttons() {
  for (const theme of THEMES) {
    for (const entry of family(theme) ? [PALETTE[0]] : PALETTE) {
      yield { theme, entry, name: family(theme) ? theme : `${theme} ${entry.id}` };
    }
  }
}

// ── The helper itself ─────────────────────────────────────────────────────
test('the contrast helper gives WCAG ratios and rejects a known-failing pair', () => {
  const white = [255, 255, 255];
  assert.equal(contrast([0, 0, 0], white).toFixed(2), '21.00');
  assert.equal(contrast(colour('#767676').rgb, white).toFixed(2), '4.54'); // the lightest grey that passes on white
  const problems = [];
  measure(problems, 'white on the old dark-theme green "playing"', white, colour('#2d8a5e').rgb, 4.5);
  measure(problems, 'black on white', [0, 0, 0], white, 4.5);
  assert.deepEqual(problems, ['white on the old dark-theme green "playing": 4.28:1, needs 4.5:1']);
});

// ── Stream buttons ────────────────────────────────────────────────────────
test('idle: station names and descriptions hold 4.5:1 on every colour and theme', () => {
  assert.equal(PALETTE.length, 8, 'PALETTE entries parse (format changed?)');
  const problems = [];
  for (const { theme, entry, name } of buttons()) {
    const p = paint(theme, 'idle', entry);
    measure(problems, `${name} idle label`, p.label, p.bg, textMin(theme));
    measure(problems, `${name} idle description`, p.sub, p.bg, textMin(theme));
  }
  assert.deepEqual(problems, []);
});

test('playing: text holds 4.5:1, with no brightness filter washing it out', () => {
  const problems = [];
  for (const { theme, entry, name } of buttons()) {
    const p = paint(theme, 'active', entry);
    measure(problems, `${name} playing label`, p.label, p.bg, textMin(theme));
    measure(problems, `${name} playing description`, p.sub, p.bg, textMin(theme));
  }
  assert.deepEqual(problems, []);
});

test('playing is marked by more than colour: a ring that shows against the page and the button, and ▮▮', () => {
  const problems = [];
  for (const { theme, entry, name } of buttons()) {
    const p = paint(theme, 'active', entry);
    if (!p.rings.length) { problems.push(`${name}: playing has no ring`); continue; }
    measure(problems, `${name} ring against the page`, p.rings[0], p.page, markMin(theme));
    measure(problems, `${name} ring against the playing colour`, p.rings[p.rings.length - 1], p.bg, markMin(theme));
    if (p.glyphOpacity !== 1) problems.push(`${name}: ▮▮ is not shown`);
    measure(problems, `${name} ▮▮`, p.glyph, p.bg, markMin(theme));
  }
  assert.deepEqual(problems, []);
});

test('paused: text holds 4.5:1 (no fade), marked by a dashed ring and ▶ at 3:1', () => {
  const problems = [];
  for (const { theme, entry, name } of buttons()) {
    const p = paint(theme, 'paused', entry);
    measure(problems, `${name} paused label`, p.label, p.bg, textMin(theme));
    measure(problems, `${name} paused description`, p.sub, p.bg, textMin(theme));
    // Dashed tells paused from playing by shape. The gaps show the button
    // colour, so the dashes have to stand out from it.
    if (!p.border || p.border.style === 'solid') problems.push(`${name}: paused has no dashed ring`);
    else measure(problems, `${name} paused ring`, p.border.colour, p.bg, markMin(theme));
    if (p.glyphOpacity !== 1) problems.push(`${name}: ▶ is not shown`);
    measure(problems, `${name} ▶`, p.glyph, p.bg, markMin(theme));
  }
  assert.deepEqual(problems, []);
});

test('a station that gave up greys out without fading its words: name and "Not available" at 4.5:1, ⚠ at 3:1', () => {
  const problems = [];
  for (const { theme, entry, name } of buttons()) {
    const p = paint(theme, 'failed', entry);
    measure(problems, `${name} failed label`, p.label, p.bg, textMin(theme));
    measure(problems, `${name} "Not available" line`, p.sub, p.bg, textMin(theme));
    if (p.glyphOpacity !== 1) problems.push(`${name}: ⚠ is not shown`);
    measure(problems, `${name} ⚠`, p.glyph, p.bg, markMin(theme));
    // Still looks unavailable: the name itself greys, so the cue survives
    // MonoRadio (one background for all) and the label-only layout.
    if (contrast(p.label, paint(theme, 'idle', entry).label) < 1.5) problems.push(`${name}: failed name looks like idle`);
  }
  assert.deepEqual(problems, []);
});

test('desktop hover keeps station text at 4.5:1 in every state', () => {
  const problems = [];
  for (const { theme, entry, name } of buttons()) {
    for (const state of ['idle', 'active', 'paused', 'failed']) {
      const p = paint(theme, state, entry, { hover: true });
      measure(problems, `${name} ${state} label, hovered`, p.label, p.bg, textMin(theme));
      measure(problems, `${name} ${state} description, hovered`, p.sub, p.bg, textMin(theme));
    }
  }
  assert.deepEqual(problems, []);
});

// ── Small text: overlays, header, transport bar, settings ─────────────────
test('small text holds 4.5:1 in every theme (7:1 in High Contrast): PIN error, Reset/Discard, LIVE, sleep timer, hints, warnings and the station browser', () => {
  const pinError = html.match(/<div id="pin-error"[^>]*style="([^"]*)"/);
  assert.ok(pinError, '#pin-error and its inline style');
  const problems = [];
  for (const theme of THEMES) {
    const tk = tokens(theme);
    const c = (value) => colour(resolve(value, tk));
    /** An opaque base with translucent layers on top, bottom first. */
    const layered = (base, ...layers) => layers.reduce((bg, l) => { const k = c(l); return over(k.rgb, k.alpha, bg); }, Array.isArray(base) ? base : c(base).rgb);
    /** A style's text colour, with its opacity, as it lands on `bg`. */
    const ink = (style, bg) => { const k = c(style.color); return over(k.rgb, k.alpha * Number(style.opacity ?? 1), bg); };
    const check = (what, style, bg) => measure(problems, `${theme} ${what}`, ink(style, bg), bg, textMin(theme));
    const style = (selector) => (need(selector), styleOf(theme, selector));

    // Overlays are translucent, so test them over the page and over the
    // darkest and lightest things that could be behind them.
    const overlay = need('.overlay').background;
    const pinStyle = { color: pinError[1].match(/(?:^|;)\s*color:\s*([^;]+)/)[1].trim() };
    for (const under of [c(tk['--screen-bg']).rgb, [0, 0, 0], [255, 255, 255]]) {
      const bg = layered(under, overlay);
      check(`PIN error over ${under.join(',')}`, pinStyle, bg);
      // The wrong-PIN dots aren't text: 3:1.
      measure(problems, `${theme} wrong-PIN dot over ${under.join(',')}`, c(style('.pin-dot.wrong').background).rgb, bg, markMin(theme));
    }
    const yes = style('.reset-confirm-yes');
    check('Reset/Discard button', yes, c(yes.background).rgb);

    const live = style('#adv-live-badge');
    check('LIVE badge, playing', live, layered(tk['--stop-active-bg'], live.background));
    check('LIVE badge, paused', live, layered(tk['--stop-paused-bg'], live.background));
    const sleep = style('#sleep-indicator');
    check('sleep timer countdown', sleep, layered(tk['--header-bg'], sleep.background));

    const panel = c(tk['--settings-bg']).rgb;
    // Settings groups sit on a card (the input colour) over the panel.
    const entryBg = layered(need('.s-card').background);
    check('settings hint', style('.s-hint'), panel);
    check('settings hint on a card', style('.s-hint'), entryBg);
    check('station row line', style('.stream-row-sub'), entryBg);
    check('station count', style('.s-group-count'), panel);
    check('Remove station', style('.stream-action-btn.danger'), entryBg);
    check('Reset to Defaults', style('#reset-btn'), panel);
    check('theme group label', style('.theme-group-label'), panel);
    check('settings version', style('#settings-version'), panel);
    check('settings credit', style('#settings-credit'), panel);
    check('apply/backup error line', style('#apply-status'), panel);
    const warn = style('.stream-entry .url-warn');
    check('http:// warning', warn, layered(entryBg, warn.background));
    const primary = style('.stream-primary-badge');
    check('Primary badge', primary, layered(entryBg, primary.background));
    const hint = style('.stream-hint');
    check('stream hint', hint, layered(panel, hint.background));
    const chosen = style('.chip.selected');
    check('selected chip', chosen, layered(chosen.background ?? need('.chip').background));
    check('emoji picker tab', style('.emoji-tab.active'), layered(need('.emoji-picker').background));

    const browser = layered(need('.stream-browser').background);
    const shelf = style('.sb-shelf');
    check('station browser shelf', shelf, layered(shelf.background));
    const preview = style('.sb-result-play');
    check('station browser preview ▶', preview, layered(preview.background));
    const close = style('.stream-browser-actions button');
    check('station browser Close', close, layered(close.background));
    check('station browser shelves intro', style('.sb-shelves-intro'), browser);
    check('station browser All shelves', style('.sb-back'), browser);
    check('station browser result line', style('.sb-result-meta'), browser);
    check('station browser Added', style('.sb-result-added'), browser);
    // Buttons filled with the accent: Search, + Add, Apply & Close, and the
    // sleep options and PIN keys while pressed.
    for (const sel of ['.stream-browser-search button', '.sb-result-add', '#apply-btn', '.sleep-opt:active', '.pin-key:active']) {
      const b = style(sel);
      assert.equal(b.background ?? need(sel).background, 'var(--accent)', `${sel} is filled with the accent`);
      check(`${sel} text on the accent`, b, c(tk['--accent']).rgb);
    }
    const mood = style('.sb-mood');
    check('mood chip', mood, layered(mood.background));
    const chosenMood = style('.sb-mood[aria-checked="true"]');
    check('chosen mood chip', chosenMood, layered(chosenMood.background ?? mood.background));
  }
  assert.deepEqual(problems, []);
});

// ── MonoRadio: one background for every station ──────────────────────────
test('MonoRadio buttons show where they are: a 2px edge at 3:1 against the page, idle and playing', () => {
  const problems = [];
  for (const theme of ['mono-dark', 'mono-light']) {
    const tk = tokens(theme);
    const page = colour(resolve(tk['--screen-bg'], tk)).rgb;
    const idle = need(MONO + '.stream-btn').border.match(/^(\d+)px solid (.+)$/);
    assert.ok(idle, `${theme}: idle border is a solid width and colour`);
    if (Number(idle[1]) < 2) problems.push(`${theme}: idle edge is ${idle[1]}px, needs 2px`);
    measure(problems, `${theme} idle edge`, colour(resolve(idle[2], tk)).rgb, page, 3);
    const active = need(MONO + '.stream-btn.active')['border-color'];
    measure(problems, `${theme} playing edge`, colour(resolve(active, tk)).rgb, page, 3);
  }
  assert.deepEqual(problems, []);
});

test('MonoRadio keeps the station emoji as strong as the colour themes do', () => {
  const problems = [];
  const floor = Math.min(...['.btn-emoji', 'html.theme-light .btn-emoji'].map((s) => Number(need(s).opacity ?? 1)));
  assert.ok(Number.isFinite(floor), 'colour-theme emoji opacity parses');
  for (const selector of [MONO + '.btn-emoji', 'html.theme-mono-light .btn-emoji']) {
    const opacity = Number(need(selector).opacity ?? 1);
    if (opacity < floor) problems.push(`${selector}: opacity ${opacity}, the colour themes use ${floor}`);
  }
  assert.deepEqual(problems, []);
});

// ── High Contrast ─────────────────────────────────────────────────────────
test('High Contrast buttons have a solid edge at 4.5:1 against the page and the button', () => {
  const problems = [];
  for (const theme of ['contrast-dark', 'contrast-light']) {
    const tk = tokens(theme);
    const page = colour(resolve(tk['--screen-bg'], tk)).rgb;
    const edge = need(HC + '.stream-btn').border.match(/^(\d+)px solid (.+)$/);
    assert.ok(edge, `${theme}: idle border is a solid width and colour`);
    if (Number(edge[1]) < 3) problems.push(`${theme}: idle edge is ${edge[1]}px, needs 3px`);
    const p = paint(theme, 'idle', PALETTE[0]);
    measure(problems, `${theme} idle edge against the page`, colour(resolve(edge[2], tk)).rgb, page, 4.5);
    measure(problems, `${theme} idle edge against the button`, colour(resolve(edge[2], tk)).rgb, p.bg, 4.5);
  }
  assert.deepEqual(problems, []);
});

test('High Contrast ignores the station colour: every station paints the same in every state', () => {
  for (const theme of ['contrast-dark', 'contrast-light']) {
    for (const state of ['idle', 'active', 'paused', 'failed']) {
      const first = JSON.stringify(paint(theme, state, PALETTE[0]));
      for (const entry of PALETTE) assert.equal(JSON.stringify(paint(theme, state, entry)), first, `${theme} ${state} ${entry.id}`);
    }
  }
});

// ── Night ─────────────────────────────────────────────────────────────────
test('Night has no blue: every colour in its tokens and rules has blue at or below red and green', () => {
  const problems = [];
  const nightRules = RULES.filter((r) => r.selectors.some((sel) => sel === 'html.theme-night' || sel.startsWith(NIGHT) || sel.startsWith('html.is-desktop.theme-night')));
  assert.ok(nightRules.length > 5, 'Night rules parse');
  for (const rule of nightRules) {
    for (const [prop, value] of Object.entries(rule.decls)) {
      for (const lit of value.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi) || []) {
        const [r, g, b] = colour(lit).rgb;
        if (b > r || b > g) problems.push(`${rule.selectors[0]} ${prop}: ${lit}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('Night buttons have an edge at 3:1 against the page, and ignore the station colour', () => {
  const tk = tokens('night');
  const page = colour(resolve(tk['--screen-bg'], tk)).rgb;
  const edge = need(NIGHT + '.stream-btn').border.match(/^(\d+)px solid (.+)$/);
  assert.ok(edge, 'idle border is a solid width and colour');
  const problems = [];
  measure(problems, 'night idle edge', colour(resolve(edge[2], tk)).rgb, page, 3);
  assert.deepEqual(problems, []);
  for (const state of ['idle', 'active', 'paused', 'failed']) {
    const first = JSON.stringify(paint('night', state, PALETTE[0]));
    for (const entry of PALETTE) assert.equal(JSON.stringify(paint('night', state, entry)), first, `${state} ${entry.id}`);
  }
});

// ── Logo ──────────────────────────────────────────────────────────────────
/** The header logo in `theme`, as painted: the one colour its tiles take, and
    the header behind them. */
function logoColours(theme) {
  const tk = tokens(theme);
  const header = colour(resolve(tk['--header-bg'], tk)).rgb;
  const tileOverride = decls(`html.theme-${theme} .logo-tile`).fill;
  return { header, tile: colour(resolve(tileOverride ?? need('.logo-tile').fill, tk)).rgb };
}

test('the logo holds 3:1 on the header in every theme (4.5:1 in High Contrast)', () => {
  assert.equal([...html.matchAll(/class="logo-tile" fill="#58c6f8"/g)].length, 10, 'the logo\'s tiles parse');
  const problems = [];
  for (const theme of THEMES) {
    const { header, tile } = logoColours(theme);
    measure(problems, `${theme} logo`, tile, header, markMin(theme));
  }
  assert.deepEqual(problems, []);
});

test('the logo is one blue in the dark and light themes, and takes each plain theme\'s own colour: grey in MonoRadio, white or black in High Contrast, no blue in Night', () => {
  const tile = (theme) => logoColours(theme).tile.join();
  assert.equal(tile('dark'), '88,198,248', 'dark: #58c6f8');
  assert.equal(tile('light'), '19,103,168', 'light: #1367a8');
  assert.equal(tile('mono-dark'), '224,224,224');
  assert.equal(tile('mono-light'), '26,26,26');
  assert.equal(tile('contrast-dark'), '255,255,255');
  assert.equal(tile('contrast-light'), '0,0,0');
  const [r, g, b] = logoColours('night').tile;
  assert.ok(b <= r && b <= g, `night logo has no blue: ${[r, g, b]}`);
});

test('the preview hint holds 4.5:1 in every theme (7:1 in High Contrast), and its border shows', () => {
  const hint = need('#preview-hint');
  const problems = [];
  for (const theme of THEMES) {
    const tk = tokens(theme);
    const bg = colour(resolve(hint.background, tk)).rgb;
    const page = colour(resolve(tk['--screen-bg'], tk)).rgb;
    measure(problems, `${theme} preview hint text`, colour(resolve(hint.color, tk)).rgb, bg, textMin(theme));
    const edge = hint.border.match(/^(\d+)px solid (.+)$/);
    measure(problems, `${theme} preview hint edge`, colour(resolve(edge[2], tk)).rgb, page, markMin(theme));
  }
  assert.deepEqual(problems, []);
});

test('header text holds 4.5:1 in every theme (7:1 in High Contrast): the name and the Desktop Preview badge, its opacity included', () => {
  const problems = [];
  for (const theme of THEMES) {
    const tk = tokens(theme);
    const c = (value) => colour(resolve(value, tk));
    const bg = c(styleOf(theme, '#header').background).rgb;
    for (const selector of ['#org-name', '#platform-badge']) {
      const style = (need(selector), styleOf(theme, selector));
      const k = c(style.color);
      measure(problems, `${theme} ${selector}`, over(k.rgb, k.alpha * Number(style.opacity ?? 1), bg), bg, textMin(theme));
    }
  }
  assert.deepEqual(problems, []);
});
