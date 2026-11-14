/**
 * iPhone safe areas. An installed iPhone app draws under the status bar
 * (status-bar-style black-translucent, viewport-fit=cover), and a landscape
 * iPhone's notch sits on a side edge. Controls pinned to an edge must clear
 * env(safe-area-inset-*), or they sit under the status bar where a tap
 * can't reach them, and pulling the page down only rubber-bands back.
 *
 * jsdom has no layout and Playwright can't set the insets on its own, so this
 * reads the stylesheet: each rule that pins a control to an edge must use the
 * inset for that edge.
 * Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'RadioGridXL.html'), 'utf-8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the top-level rule whose selector is exactly `selector`. */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  assert.ok(m, `no CSS rule for ${selector}`);
  return Object.fromEntries(m[1].split(';').map((d) => d.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
}

test('the settings header (Settings, Preview, ×) starts below the status bar', () => {
  const header = rule('#settings-header');
  assert.equal(header.position, 'sticky', 'the header stays pinned while settings scroll');
  assert.match(header['padding-top'], /env\(safe-area-inset-top/);
});

test('the settings panel and Back to settings clear a landscape notch on the right', () => {
  assert.match(rule('#settings-panel')['padding-right'], /env\(safe-area-inset-right/);
  const back = rule('#preview-back');
  assert.match(back.top, /env\(safe-area-inset-top/);
  assert.match(back.right, /env\(safe-area-inset-right/);
});

test('the pinned Apply bar clears the home indicator', () => {
  assert.match(rule('#settings-footer').padding, /env\(safe-area-inset-bottom/);
});

test('centred sheets (help, station browser, emoji picker) fit inside the safe area', () => {
  for (const [overlay, sheet, size] of [['.help-overlay', '.help-sheet', 'height'], ['.stream-browser-overlay', '.stream-browser', 'max-height'], ['.emoji-picker-overlay', '.emoji-picker', 'max-height']]) {
    const pad = rule(overlay).padding ?? '';
    for (const edge of ['top', 'right', 'bottom', 'left']) assert.match(pad, new RegExp(`env\\(safe-area-inset-${edge}`), `${overlay} pads the ${edge} inset`);
    // A vh size alone overflows the padded box on a phone and pushes the top
    // edge back under the status bar; 100% caps it at the safe area.
    assert.match(rule(sheet)[size], /^min\([^)]*100%\)$/, `${sheet} ${size} is capped at the safe area`);
    assert.match(rule(sheet).width, /^min\([^)]*100%\)$/, `${sheet} width is capped at the safe area`);
  }
});

test('sideways, the main screen clears the notch: header (and its logo), station buttons, transport bar', () => {
  for (const selector of ['#header', '#header.compact', '#adv-transport']) {
    const d = rule(selector);
    assert.match(d['padding-left'], /env\(safe-area-inset-left/, `${selector} left`);
    assert.match(d['padding-right'], /env\(safe-area-inset-right/, `${selector} right`);
  }
  assert.match(rule('.adv-sleep-btn').right, /env\(safe-area-inset-right/, 'the sleep button is placed absolutely, so it needs the inset itself');
  // renderButtons() reads #buttons' width and takes its padding to be the
  // gap; the inset has to be margin, or the text-size sums run too wide.
  const buttons = rule('#buttons');
  assert.match(buttons.margin, /env\(safe-area-inset-right[^)]*\) 0 env\(safe-area-inset-left/);
  assert.doesNotMatch(buttons.padding, /safe-area/);
});

// iOS hands a tap on the home indicator to the page. When the Stop bar's
// button reached down into that strip, swiping home or between apps paused
// or resumed the radio. The strip is a separate, inert element now.
test('the Stop bar ends above the home indicator; a separate strip fills it in the bar\'s colour', () => {
  const stop = rule('#simple-stop');
  for (const prop of ['height', 'min-height', 'padding', 'padding-bottom']) {
    assert.doesNotMatch(stop[prop] ?? '', /safe-area/, `#simple-stop ${prop} must not reach into the home-indicator strip`);
  }
  const inset = rule('#simple-stop-inset');
  assert.match(inset.height, /env\(safe-area-inset-bottom/);
  assert.equal(inset.background, stop.background, 'the strip matches the idle bar');
  for (const state of ['.active', '.paused']) {
    assert.equal(rule(`#simple-stop${state} + #simple-stop-inset`).background, rule(`#simple-stop${state}`).background, `the strip matches the bar when ${state.slice(1)}`);
  }
});

test('the home-indicator strip is not a control, and Advanced mode (which pads its own inset) hides it', async () => {
  const { bootPlayback } = await import('./playback-fakes.mjs');
  for (const advanced of ['off', 'on']) {
    const t = bootPlayback({ cfg: { advanced } });
    t.w.updateMode(); // the harness re-runs only loadSettings() after seeding; init() follows it with this
    const inset = t.w.document.getElementById('simple-stop-inset');
    assert.equal(inset.closest('button, a, [onclick], [role="button"]'), null);
    assert.equal(inset.getAttribute('aria-hidden'), 'true');
    assert.equal(inset.hidden, advanced === 'on');
  }
});
