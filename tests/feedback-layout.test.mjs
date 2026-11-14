/**
 * The feedback card's two addresses each read on one unbroken line, so
 * nobody has to piece "marsh.city/radio/" and "feedback" back together
 * (Jason, 2026-11-07: at phone widths both broke mid-address beside the QR).
 * On a narrow phone the text moves under the QR instead. Real Chromium
 * layout (jsdom has none), so it needs the sandbox off like the promise checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, openSettingsByButton } from './browser-harness.mjs';

const WIDTHS = [320, 375, 430, 768];

for (const width of WIDTHS) {
  test(`at ${width}px wide, each feedback address is on one line of its own`, async () => {
    const { page, close } = await openApp({ viewport: { width, height: 900 } });
    try {
      await openSettingsByButton(page);
      await page.locator('#feedback-section').scrollIntoViewIfNeeded();
      const lines = await page.evaluate(() => [...document.querySelectorAll('#feedback-section .feedback-address')].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        // One line box per rendered line: distinct tops of the text's rects.
        const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        return { text: el.textContent, lines: tops.size, overflows: el.scrollWidth > el.clientWidth + 1 };
      }));
      assert.deepEqual(lines.map((l) => l.text), ['marsh.city/radio/feedback', 'radio@marsh.city']);
      for (const l of lines) {
        assert.equal(l.lines, 1, `${l.text} wraps onto ${l.lines} lines`);
        assert.equal(l.overflows, false, `${l.text} runs past its box`);
      }
    } finally {
      await close();
    }
  });
}
