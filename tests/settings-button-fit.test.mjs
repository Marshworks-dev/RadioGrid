/**
 * The header's Settings button is the only way into settings while it
 * shows (five taps on the logo are off then), so a clipped or covered
 * button would lock the setter-up out. Held here at the narrowest phones,
 * a long two-line name and every text size. Real Chromium layout (jsdom
 * has none), so it needs the sandbox off like the promise checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './browser-harness.mjs';

const SHAPES = [
  { name: '320px phone', width: 320, height: 568 },
  { name: '375px phone', width: 375, height: 667 },
  { name: 'phone on its side', width: 667, height: 375 },
  { name: 'tablet', width: 768, height: 1024 },
];
const NAMES = ['RadioGridXL', 'Northland Centers\nfor Assisted Living and Wellbeing'];
const SIZES = ['normal', 'large', 'xlarge', 'ultra'];
// As a phone: on a desktop the app sits in a fixed preview frame instead.
const asPhone = () => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });

/** Where the button sits and what a tap in its middle would land on. */
const measure = (page) => page.evaluate(() => {
  const btn = document.getElementById('settings-btn');
  const r = btn.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const words = btn.querySelector('span') || btn;
  return {
    hidden: btn.hidden, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
    viewport: innerWidth, tapLands: !!hit && btn.contains(hit),
    clipped: btn.scrollWidth > btn.clientWidth + 1 || words.scrollWidth > words.clientWidth + 1,
    text: btn.textContent.trim(),
  };
});

for (const shape of SHAPES) {
  test(`on a ${shape.name}, the Settings button is whole, on screen and tappable with any name and text size`, async () => {
    const { page, close } = await openApp({ viewport: { width: shape.width, height: shape.height }, initScript: asPhone });
    try {
      for (const orgName of NAMES) for (const size of SIZES) for (const advanced of ['off', 'on']) {
        await page.evaluate((cfg) => localStorage.setItem('rgxl_cfg', JSON.stringify(cfg)), { v: 1, orgName, size, advanced, settingsButton: 'on' });
        await page.reload();
        const m = await measure(page);
        const where = `${JSON.stringify(orgName)} at ${size}, advanced ${advanced}: ${JSON.stringify(m)}`;
        assert.equal(m.hidden, false, where);
        assert.equal(m.text, 'Settings', where);
        assert.ok(m.left >= 0 && m.right <= m.viewport + 0.5 && m.top >= 0, 'runs off the screen: ' + where);
        assert.ok(m.width >= 44 && m.height >= 44, 'smaller than 44 px: ' + where);
        assert.equal(m.clipped, false, 'its word is cut off: ' + where);
        assert.equal(m.tapLands, true, 'something covers it: ' + where);
      }
    } finally {
      await close();
    }
  });
}

test('a tap on it opens settings on the narrowest phone with the longest name — and with it hidden, five taps on the logo do (unhappy path: no button)', async () => {
  const { page, close } = await openApp({ viewport: { width: 320, height: 568 }, initScript: asPhone });
  try {
    const save = (settingsButton) => page.evaluate((cfg) => localStorage.setItem('rgxl_cfg', JSON.stringify(cfg)), { v: 1, orgName: NAMES[1], size: 'ultra', settingsButton });
    await save('on');
    await page.reload();
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel.open', { timeout: 5000 });
    await save('off');
    await page.reload();
    assert.equal(await page.isVisible('#settings-btn'), false);
    for (let i = 0; i < 5; i++) await page.click('#logo-area');
    await page.waitForSelector('#settings-panel.open', { timeout: 5000 });
  } finally {
    await close();
  }
});

test('the practice dialog sits on top of settings, so real taps reach its logo and Done', async () => {
  const { page, close } = await openApp({ viewport: { width: 390, height: 844 }, initScript: asPhone });
  try {
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-panel.open', { timeout: 5000 });
    // Real clicks: Playwright refuses one whose target is covered.
    await page.click('.s-switch[data-switch="settingsButton"]');
    await page.waitForSelector('#hide-overlay.visible');
    // Painted on top too: the panel behind is inert, so clicks would reach a
    // dialog drawn underneath it, where nobody could see it.
    const stack = await page.evaluate(() => {
      const z = (id) => Number(getComputedStyle(document.getElementById(id)).zIndex);
      return { dialog: z('hide-overlay'), panel: z('settings-panel'), position: getComputedStyle(document.getElementById('hide-overlay')).position };
    });
    assert.ok(stack.dialog > stack.panel, 'the dialog is drawn under settings: ' + JSON.stringify(stack));
    assert.equal(stack.position, 'fixed');
    for (let i = 0; i < 5; i++) await page.click('#hide-practice', { timeout: 3000 });
    await page.click('#hide-done', { timeout: 3000 });
    assert.equal(await page.isVisible('#settings-btn'), false);
    assert.equal(await page.getAttribute('.s-switch[data-switch="settingsButton"]', 'aria-checked'), 'false');
  } finally {
    await close();
  }
});

/** The dot's box, and the right edge of whatever else in the header is showing. */
const measureDot = (page) => page.evaluate(() => {
  const box = (id) => document.getElementById(id).getBoundingClientRect();
  const dot = box('conn-dot'), header = box('header');
  const others = ['logo-area', 'sleep-indicator', 'platform-badge', 'settings-btn'].map(box).filter((r) => r.width > 0);
  return {
    left: dot.left, right: dot.right, middle: dot.top + dot.height / 2, width: dot.width,
    othersEnd: Math.max(...others.map((r) => r.right)), headerMiddle: header.top + (header.height - 1) / 2,
    paddingRight: parseFloat(getComputedStyle(document.getElementById('header')).paddingRight), viewport: innerWidth,
  };
});

test('the activity dot sits at the header\'s right end, in the same place whether the Settings button shows or is hidden', async () => {
  for (const shape of [SHAPES[0], SHAPES[2], SHAPES[3]]) {
    const { page, close } = await openApp({ viewport: { width: shape.width, height: shape.height }, initScript: asPhone });
    try {
      for (const orgName of NAMES) {
        const spots = {};
        for (const settingsButton of ['on', 'off']) {
          await page.evaluate((cfg) => localStorage.setItem('rgxl_cfg', JSON.stringify(cfg)), { v: 1, orgName, settingsButton });
          await page.reload();
          const m = await measureDot(page);
          const where = `${shape.name}, ${JSON.stringify(orgName)}, button ${settingsButton}: ${JSON.stringify(m)}`;
          assert.ok(m.width > 0, 'the dot is not showing: ' + where);
          assert.ok(m.left >= m.othersEnd, 'something sits to the right of the dot: ' + where);
          assert.ok(Math.abs(m.right - (m.viewport - m.paddingRight)) <= 0.5, 'the dot is not at the header\'s right edge: ' + where);
          assert.ok(Math.abs(m.middle - m.headerMiddle) <= 1, 'the dot is not level with the middle of the header: ' + where);
          spots[settingsButton] = m.right;
        }
        assert.ok(Math.abs(spots.on - spots.off) <= 0.5, `${shape.name}, ${JSON.stringify(orgName)}: the dot moves when the button is hidden (${spots.on} vs ${spots.off})`);
      }
    } finally {
      await close();
    }
  }
});

test('unhappy path: with a sleep timer counting down, the countdown sits left of the dot, not past it', async () => {
  const { page, close } = await openApp({ viewport: { width: 390, height: 844 }, initScript: asPhone });
  try {
    await page.evaluate(() => document.getElementById('sleep-indicator').classList.add('visible'));
    await page.evaluate(() => { document.getElementById('sleep-countdown').textContent = '29:59'; });
    const m = await measureDot(page);
    assert.ok(m.left >= m.othersEnd, 'the countdown runs past the dot: ' + JSON.stringify(m));
    assert.ok(Math.abs(m.right - (m.viewport - m.paddingRight)) <= 0.5, JSON.stringify(m));
  } finally {
    await close();
  }
});
