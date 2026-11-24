/**
 * Every overlay (the PIN pad, sleep timer, no-network, discard, hide
 * practice, reset, idle) shows whole: its title and every button on screen
 * and tappable, without scrolling. The PIN pad is the only way into settings
 * on a radio with a PIN, so a key off the screen locks the setter-up out.
 *
 * The case that slipped: a radio set to turn sideways on a phone held
 * upright. Short-screen rules read the screen's height, which stays tall
 * when the app turns itself, and the bottom row of the PIN pad fell off the
 * edge. Held on phones and in the desktop preview, upright, on their side and
 * forced sideways. Real Chromium layout (jsdom has none), so it needs
 * Playwright's Chromium (`npx playwright install chromium`), like the promise checks. The radio itself is held whole too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './browser-harness.mjs';

const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHAPES = [
  { name: '320px phone', width: 320, height: 568, phone: true },
  { name: '375px phone', width: 375, height: 667, phone: true },
  { name: '390px phone', width: 390, height: 844, phone: true },
  { name: '430px phone', width: 430, height: 932, phone: true },
  { name: 'phone on its side', width: 667, height: 375, phone: true },
  { name: 'small phone on its side', width: 568, height: 320, phone: true },
  { name: 'laptop', width: 1280, height: 720, phone: false },
  { name: 'narrow desktop window', width: 390, height: 844, phone: false },
  { name: 'short desktop window', width: 1024, height: 560, phone: false },
];
const ORIENTATIONS = ['auto', 'landscape-cw', 'landscape-ccw'];
const OVERLAYS = ['pin-overlay', 'sleep-overlay', 'nonet-overlay', 'discard-overlay', 'hide-overlay', 'reset-overlay', 'idle-overlay'];

/** The overlay's title and every visible button: on screen, and a tap in its middle lands on it. */
const measure = (page, id) => page.evaluate((id) => {
  const overlay = document.getElementById(id);
  const targets = [overlay.querySelector('.overlay-title'), ...overlay.querySelectorAll('button')]
    .filter((el) => el.getClientRects().length > 0);
  return targets.map((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30),
      title: el.classList.contains('overlay-title'),
      onScreen: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
      tapLands: !!hit && el.contains(hit),
      short: Math.round(Math.min(r.width, r.height)),
    };
  });
}, id);

for (const shape of SHAPES) {
  test(`on a ${shape.name}, every overlay shows whole, upright or turned sideways (unhappy path: a radio forced to landscape)`, async () => {
    const asPhone = new Function(`Object.defineProperty(navigator, 'userAgent', { get: () => ${JSON.stringify(PHONE_UA)} });`);
    const { page, close } = await openApp({ viewport: { width: shape.width, height: shape.height }, reducedMotion: 'reduce', initScript: shape.phone ? asPhone : undefined });
    const problems = [];
    try {
      for (const orientation of ORIENTATIONS) {
        await page.evaluate((cfg) => { localStorage.setItem('rgxl_cfg', JSON.stringify(cfg)); localStorage.setItem('rgxl_pin', '2580'); },
          { v: 1, orientation, settingsButton: 'on', advanced: 'on' });
        await page.reload();
        const app = await page.evaluate(() => {
          const r = document.getElementById('app').getBoundingClientRect();
          return { onScreen: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, w: Math.round(r.width), h: Math.round(r.height) };
        });
        if (!app.onScreen) problems.push(`${orientation} the radio itself runs off the screen: ${JSON.stringify(app)}`);
        for (const id of OVERLAYS) {
          // The hide practice draws its logo button when it opens, so open it the real way.
          await page.evaluate((id) => (id === 'hide-overlay' ? window.openHidePractice() : window.showOverlay(document.getElementById(id))), id);
          await page.waitForFunction((id) => getComputedStyle(document.getElementById(id)).opacity === '1', id);
          for (const m of await measure(page, id)) {
            const bad = [!m.onScreen && 'off the screen', !m.tapLands && 'covered', !m.title && m.short < 30 && 'too small'].filter(Boolean);
            if (bad.length) problems.push(`${orientation} ${id} "${m.name}": ${bad.join(', ')}`);
          }
          await page.evaluate((id) => window.hideOverlay(document.getElementById(id)), id);
        }
      }
    } finally {
      await close();
    }
    assert.deepEqual(problems, []);
  });
}
