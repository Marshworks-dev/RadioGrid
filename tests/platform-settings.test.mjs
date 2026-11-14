/**
 * Settings that only work on some platforms: the Device buttons need the
 * APK's AndroidBridge, and iPhone/iPad ignore a volume set by script. Where a
 * control can't work it is hidden, with a line saying what to do instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { STREAMS } from './playback-fakes.mjs';

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UA_IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/** Boot as a given device. `touchPoints` > 1 with a Mac user agent is an iPad. */
function bootAs({ ua, touchPoints = 0, bridge, seed } = {}) {
  return loadApp({
    seed,
    beforeParse(win) {
      if (ua) Object.defineProperty(win.navigator, 'userAgent', { value: ua, configurable: true });
      Object.defineProperty(win.navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
      if (bridge) win.AndroidBridge = bridge;
    },
  });
}

const $ = (w, id) => w.document.getElementById(id);
const shown = (w, el) => !el.closest('[hidden]') && w.getComputedStyle(el).display !== 'none';

test('a phone browser points to the Settings app instead of showing dead Device buttons', () => {
  const w = bootAs();
  assert.ok(shown(w, $(w, 'device-section')));
  assert.ok(!shown(w, $(w, 'device-buttons')), 'intent: links to Android Settings are refused in Chrome');
  assert.ok(shown(w, $(w, 'device-hint-web')));
});

test('a desktop browser shows no Device section', () => {
  const w = loadApp({ desktop: true });
  assert.ok(!shown(w, $(w, 'device-section')));
});

test('the APK shows the Device buttons, and they go through the bridge', () => {
  const calls = [];
  const bridge = Object.fromEntries(['openWifiSettings', 'openOsSettings', 'openAccessibilitySettings']
    .map((m) => [m, () => calls.push(m)]));
  const w = bootAs({ bridge });
  assert.ok(shown(w, $(w, 'device-buttons')));
  assert.ok(!shown(w, $(w, 'device-hint-web')));
  for (const btn of $(w, 'device-buttons').querySelectorAll('button')) btn.click();
  assert.deepEqual(calls, ['openWifiSettings', 'openAccessibilitySettings', 'openOsSettings']);
});

test('a Settings screen the device blocks says so instead of failing silently — unhappy path', () => {
  const blocked = () => { throw new Error('Java exception was raised during method invocation'); };
  const w = bootAs({ bridge: { openWifiSettings: blocked, openOsSettings: blocked, openAccessibilitySettings: blocked } });
  w.console.warn = () => {};
  w.openWifiSettings();
  assert.match($(w, 'device-status').textContent, /Couldn't open Settings/);
});

test('iPhone and iPad hide the volume cap and trims, and point to the side buttons', () => {
  for (const [name, device] of Object.entries({ iPhone: { ua: UA_IPHONE }, iPad: { ua: UA_IPAD, touchPoints: 5 } })) {
    const w = bootAs(device);
    w.openSettings();
    const vol = $(w, 'vol-section');
    assert.ok(!shown(w, vol.querySelector('.vol-row')), name + ': no volume slider');
    assert.ok(shown(w, vol.querySelector('.ios-only')), name + ': side-button hint');
    const trim = w.document.querySelector('#stream-editor [data-field="gain"]').closest('.s-row');
    assert.ok(!shown(w, trim), name + ': no volume trim');
  }
});

test('a Mac without touch keeps the volume controls', () => {
  const w = bootAs({ ua: UA_IPAD, touchPoints: 0 });
  assert.ok(shown(w, $(w, 'vol-section').querySelector('.vol-row')));
  assert.ok(!shown(w, $(w, 'vol-section').querySelector('.ios-only')));
});

test('a saved volume trim survives Apply on an iPad — unhappy path', () => {
  const streams = STREAMS.map((s, i) => (i === 0 ? { ...s, gain: 0.5 } : s));
  const w = bootAs({ ua: UA_IPAD, touchPoints: 5, seed: { rgxl_cfg: JSON.stringify({ streams }) } });
  w.openSettings();
  w.applySettings();
  assert.equal(JSON.parse(w.localStorage.getItem('rgxl_cfg')).streams[0].gain, 0.5);
});
