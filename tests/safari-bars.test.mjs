/**
 * iOS Safari colours its status bar and home-bar strip from the page's edges
 * and re-reads them only when a new fixed layer appears at an edge. After a
 * light/dark switch (or closing settings) the app adds a fixed strip at each
 * edge, in the colour already there, and removes it (retintSafariBars in
 * RadioGridXL.html). Seen fixed in the iOS Simulator by sampling the bars'
 * pixels; these tests hold the wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootPlayback } from './playback-fakes.mjs';

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const AFTER_MS = 350;
const HOLD_MS = 250;

/** Boot with the phone's light/dark switch under the test's control. */
function boot({ iphone = true, theme = 'auto' } = {}) {
  let light = false;
  const listeners = [];
  const t = bootPlayback({ cfg: { theme }, beforeParse: (w) => {
    if (iphone) Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: UA_IPHONE });
    const stub = w.matchMedia;
    w.matchMedia = (q) => {
      const mq = stub(q);
      if (/prefers-color-scheme:\s*light/.test(q)) {
        Object.defineProperty(mq, 'matches', { get: () => light });
        mq.addEventListener = (type, fn) => listeners.push(fn);
      }
      return mq;
    };
  } });
  // The load-time pass was scheduled on the real clock, before the fake went
  // in, so it would sit pending for the whole test and hold off a quick retint.
  t.w.eval('clearTimeout(retintTimer); retintTimer = null;');
  t.switchTo = (mode) => { light = mode === 'light'; listeners.forEach((fn) => fn()); };
  t.strips = () => [...t.w.document.querySelectorAll('.retint-strip')];
  return t;
}

test('iPhone: a light/dark switch adds a strip at the top and bottom edges once the fades end, then removes them', async () => {
  const t = boot();
  await t.clock.tick(AFTER_MS + HOLD_MS + 50); // the load-time pass
  assert.equal(t.strips().length, 0);
  t.switchTo('light');
  assert.ok(t.w.document.documentElement.classList.contains('theme-light'));
  await t.clock.tick(AFTER_MS - 50);
  assert.equal(t.strips().length, 0, 'not mid-fade');
  await t.clock.tick(100);
  const [top, bottom] = t.strips();
  assert.ok(top && bottom, 'two strips');
  assert.match(top.style.cssText, /top: 0/);
  assert.match(top.style.background, /--header-bg/);
  assert.match(bottom.style.cssText, /bottom: 0/);
  assert.equal(top.getAttribute('aria-hidden'), 'true');
  assert.equal(top.style.pointerEvents, 'none', 'never catches a tap');
  await t.clock.tick(HOLD_MS + 50);
  assert.equal(t.strips().length, 0, 'gone again');
});

test('iPhone: closing settings re-reads the bars after the panel slides out', async () => {
  const t = boot();
  await t.clock.tick(AFTER_MS + HOLD_MS + 50);
  t.w.openSettings();
  t.w.closeSettings();
  await t.clock.tick(350 + AFTER_MS + 50);
  assert.equal(t.strips().length, 2);
});

test('a theme picked by hand ignores the switch: no change, no strips', async () => {
  const t = boot({ theme: 'dark' });
  await t.clock.tick(AFTER_MS + HOLD_MS + 50);
  t.switchTo('light');
  await t.clock.tick(AFTER_MS + 50);
  assert.ok(t.w.document.documentElement.classList.contains('theme-dark'));
  assert.equal(t.strips().length, 0);
});

test('Android follows the switch with no strips (its bar reads theme-color)', async () => {
  const t = boot({ iphone: false });
  await t.clock.tick(AFTER_MS + HOLD_MS + 50);
  t.switchTo('light');
  await t.clock.tick(AFTER_MS + 50);
  assert.ok(t.w.document.documentElement.classList.contains('theme-light'));
  assert.equal(t.strips().length, 0);
});

// The stop bar doesn't fade on an iPhone (04-transport.css), so a Stop or a
// station tap re-reads the bars straight after the paint, not after a fade.
const SNAPPED_MS = 50;

test('iPhone: starting and stopping a station re-reads the bottom bar at once, which changes colour with the stop bar', async () => {
  const t = boot();
  await t.clock.tick(AFTER_MS + HOLD_MS + 50);
  t.w.playStream('s1');
  await t.clock.tick(SNAPPED_MS + 10);
  assert.equal(t.strips().length, 2, 'after the bar turned to playing');
  await t.clock.tick(HOLD_MS + 50);
  t.w.stopPlayback();
  await t.clock.tick(SNAPPED_MS + 10);
  assert.equal(t.strips().length, 2, 'after the bar turned back');
});

test('iPhone: a Stop straight after a light/dark switch still waits out the theme\'s fade — unhappy path', async () => {
  const t = boot();
  await t.clock.tick(AFTER_MS + HOLD_MS + 50);
  t.w.playStream('s1');
  await t.clock.tick(SNAPPED_MS + HOLD_MS + 50); // that tap's strips have come and gone
  t.switchTo('light');
  t.w.stopPlayback();
  await t.clock.tick(SNAPPED_MS + 10);
  assert.equal(t.strips().length, 0, 'not mid-fade');
  await t.clock.tick(AFTER_MS - SNAPPED_MS);
  assert.equal(t.strips().length, 2);
});

test('iPhone: an update that leaves the bar\'s colour alone adds no strips — unhappy path', async () => {
  const t = boot();
  await t.clock.tick(AFTER_MS + HOLD_MS + 50);
  t.w.updateSimpleStop();
  t.w.updateAdvTransport();
  await t.clock.tick(AFTER_MS + 50);
  assert.equal(t.strips().length, 0);
});
