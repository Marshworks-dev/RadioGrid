/**
 * The iPhone retint strips (retintSafariBars, tests/safari-bars.test.mjs)
 * are meant to be invisible: the header's colour over the header. They're
 * taller than the header's top padding, so they once painted over the top
 * of the logo and the Settings button for a moment after every Stop or
 * station tap. Held here by painting the header with and without the strips
 * and requiring the same pixels. Real Chromium (jsdom doesn't paint), so it
 * needs Playwright's Chromium (`npx playwright install chromium`), like the promise checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './browser-harness.mjs';

const asPhone = () => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
const SHAPES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone on its side (compact header)', width: 844, height: 390 },
];
// Long enough for the load-time pass (350 ms wait + 250 ms hold) to be over.
const SETTLED_MS = 800;
// The strip's new layer nudges text anti-aliasing (seen: up to 25 of 255 per
// channel); a covered logo or button moves pixels by 200+.
const CHANGED = 64;

/** Pixels that differ by more than CHANGED in any channel, decoded in the page. */
const changedPixels = (page, a, b) => page.evaluate(async ([a, b, limit]) => {
  const pixels = async (png) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + png;
    await img.decode();
    const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  };
  const [A, B] = [await pixels(a), await pixels(b)];
  let changed = 0;
  for (let i = 0; i < A.length; i += 4) {
    if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > limit) changed++;
  }
  return changed;
}, [a.toString('base64'), b.toString('base64'), CHANGED]);

/** The stop bar's painted colour the instant it turns to playing, and once settled. */
const stopBarColours = (page) => page.evaluate(async () => {
  const bar = document.getElementById('simple-stop');
  bar.classList.add('active');
  const now = getComputedStyle(bar).backgroundColor;
  await new Promise((done) => setTimeout(done, 400));
  return { now, settled: getComputedStyle(bar).backgroundColor };
});

test('on an iPhone the stop bar changes colour at once, so the home-bar strip can follow it straight away', async () => {
  const { page, close } = await openApp({ viewport: { width: 390, height: 844 }, initScript: asPhone });
  try {
    const { now, settled } = await stopBarColours(page);
    assert.equal(now, settled);
  } finally {
    await close();
  }
});

test('elsewhere it still fades (unhappy path: the snap is iPhone-only)', async () => {
  const { page, close } = await openApp({ viewport: { width: 390, height: 844 } });
  try {
    const { now, settled } = await stopBarColours(page);
    assert.notEqual(now, settled);
  } finally {
    await close();
  }
});

for (const shape of SHAPES) {
  test(`on a ${shape.name}, the retint strips leave the header looking the same`, async () => {
    const { page, close } = await openApp({ viewport: { width: shape.width, height: shape.height }, initScript: asPhone });
    try {
      await page.evaluate(() => localStorage.setItem('rgxl_cfg', JSON.stringify({ v: 1, settingsButton: 'on' })));
      await page.reload();
      await page.waitForTimeout(SETTLED_MS);
      const header = page.locator('#header');
      const before = await header.screenshot({ animations: 'disabled' });
      await page.evaluate(() => window.addRetintStrips());
      assert.equal(await page.locator('.retint-strip').count(), 2, 'the strips went up');
      const during = await header.screenshot({ animations: 'disabled' });
      assert.equal(await changedPixels(page, before, during), 0, 'a strip covers part of the header');
    } finally {
      await close();
    }
  });
}
