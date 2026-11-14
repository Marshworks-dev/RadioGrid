/**
 * Contrast as Chromium actually paints it. contrast.test.mjs imports this,
 * so it is part of the PROMISES.md check "Text meets WCAG AA in every theme
 * and 7:1 in High Contrast".
 *
 * The stylesheet model in contrast.test.mjs reads exact rules and covers
 * every station colour and button state. What it can't see: rules inside
 * @media blocks, the size classes, and any selector it doesn't name. This
 * walks every theme × text size × screen shape (phone upright and sideways, a
 * short landscape screen, desktop with a mouse), opens each screen and
 * dialog, and measures every visible text node with getComputedStyle: its
 * colour, faded by every opacity above it, over the background colours
 * stacked behind it. Text sitting on a background image or under a filter
 * can't be measured that way, so it fails as "unmeasured" until someone adds
 * a way to measure it.
 *
 * WCAG thresholds: 4.5:1, or 3:1 for large text (24px, or 18.66px bold).
 * High Contrast: 7:1, and 4.5:1 for large text (AAA). Disabled controls and
 * text with no letters or digits (emoji, ▶) are exempt, as WCAG allows; the
 * marks have their own 3:1 tests in contrast.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './browser-harness.mjs';

const THEMES = ['dark', 'light', 'mono-dark', 'mono-light', 'contrast-dark', 'contrast-light', 'night'];
const SIZES = ['normal', 'large', 'xlarge', 'ultra'];
const SCREENS = [
  { name: 'phone upright', width: 390, height: 844 },
  { name: 'phone sideways', width: 844, height: 390 },
  { name: 'short landscape', width: 640, height: 340 },
  { name: 'desktop', width: 1280, height: 800 },
];
const DIALOGS = ['nonet-overlay', 'sleep-overlay', 'discard-overlay', 'hide-overlay', 'pin-overlay', 'reset-overlay', 'idle-overlay'];

/** Runs in the page: every visible text node that falls short, plus any
    that can't be measured. */
function lowContrastText({ normal, large }) {
  const parse = (c) => {
    const m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, a, bg) => fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
  const name = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');

  const out = [];
  // Off to the side is skipped (a panel slid away); above or below the fold
  // is not: settings scrolls, and the feedback addresses sat at 1.09:1 below
  // it unmeasured.
  const onScreen = (r) => r.width && r.height && r.right > 0 && r.left < innerWidth;

  const candidates = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    candidates.push({ el: node.parentElement, text: node.textContent.trim(), rect: range.getBoundingClientRect() });
  }
  // Form controls draw text that isn't a text node: a placeholder, a typed
  // value, a dropdown's chosen option. ("Search by name..." sat at 4.06:1.)
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.matches('input[type="checkbox"], input[type="radio"], input[type="file"], input[type="range"], input[type="color"]')) continue;
    const rect = el.getBoundingClientRect();
    if (el.tagName === 'SELECT') {
      const opt = el.options[el.selectedIndex];
      if (opt) candidates.push({ el, text: opt.text.trim(), rect });
    } else if (el.value) {
      candidates.push({ el, text: el.value.trim(), rect });
    } else if (el.placeholder) {
      candidates.push({ el, text: el.placeholder.trim(), rect, pseudo: '::placeholder' });
    }
  }

  for (const { el, text, rect: r, pseudo } of candidates) {
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    if (!el || el.closest('svg, script, style, [hidden]')) continue;
    if (el.closest('button:disabled, select:disabled, input:disabled, textarea:disabled, [aria-disabled="true"]')) continue;
    if (!onScreen(r)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    const textStyle = pseudo ? getComputedStyle(el, pseudo) : cs;

    // Fade: every opacity from the text up; a filter anywhere can't be
    // modelled. Clipped away entirely (.sr-only, for screen readers) isn't seen.
    let alpha = pseudo ? parseFloat(textStyle.opacity) : 1;
    let filtered = null;
    let clipped = false;
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') clipped = true;
      alpha *= parseFloat(s.opacity);
      if (s.filter !== 'none' && !filtered) filtered = name(a) + ' filter ' + s.filter;
    }
    if (clipped || alpha < 0.05) continue; // not shown (screen-reader text, a closed dialog)

    // Background: the colours stacked behind, from the root down.
    const stack = [];
    let image = null;
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.backgroundImage !== 'none' && !image) image = name(a);
      const bg = parse(s.backgroundColor);
      if (bg && bg[3] > 0) { stack.push(bg); if (bg[3] >= 1) break; }
    }
    let bg = [255, 255, 255];
    for (const c of stack.reverse()) bg = over(c, c[3], bg);

    const what = `${name(el)}${pseudo || ''} "${text.slice(0, 30)}"`;
    const fg = parse(textStyle.color);
    if (!fg || image || filtered) { out.push(`${what}: unmeasured (${!fg ? 'colour ' + textStyle.color : image ? 'background image on ' + image : filtered})`); continue; }
    const size = parseFloat(textStyle.fontSize);
    const isLarge = size >= 24 || (size >= 18.66 && parseInt(textStyle.fontWeight, 10) >= 700);
    const min = isLarge ? large : normal;
    const got = ratio(over(fg, fg[3] * alpha, bg), bg);
    if (got < min - 0.005) out.push(`${what}: ${got.toFixed(2)}:1, needs ${min}:1`);
  }
  return out;
}

/** Wait until the page has painted and nothing is still mid-change. Even
    with Reduce Motion a transition lasts 0.01 ms and only finishes on the
    next frame: until then getComputedStyle reports where it started (a
    just-enabled dropdown still at its disabled 0.7 opacity read 4.22:1).
    A fixed 30 ms wait covered that on a quiet machine and not on a busy
    CI runner. Capped at 2 s, so an animation that never ends is measured
    as it stands instead of hanging the walk. */
const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  const deadline = performance.now() + 2000;
  const check = () => {
    // A closing dialog's delayed visibility step runs for 0.4 s and changes
    // no colour: it is already at opacity 0, which the measure skips. Only
    // that case is let through; a delayed reveal is still waited for.
    const fadedOut = (a) => a.transitionProperty === 'visibility' && a.effect && a.effect.target
      && getComputedStyle(a.effect.target).opacity === '0';
    const moving = document.getAnimations().some((a) => (a.playState === 'running' || a.pending) && !fadedOut(a));
    if (moving && performance.now() < deadline) requestAnimationFrame(check);
    else resolve();
  };
  requestAnimationFrame(() => requestAnimationFrame(check));
}));

test('rendered text holds WCAG AA (7:1 in High Contrast) in every theme, size and screen shape, on every screen and dialog', { timeout: 300000 }, async () => {
  const problems = [];
  for (const screen of SCREENS) {
    // Reduce Motion so dialogs appear at once, at full strength.
    const { page, close } = await openApp({ reducedMotion: 'reduce', viewport: { width: screen.width, height: screen.height } });
    try {
      for (const theme of THEMES) {
        const min = theme.startsWith('contrast') ? { normal: 7, large: 4.5 } : { normal: 4.5, large: 3 };
        for (const size of SIZES) {
          const where = `${theme}, ${size}, ${screen.name}`;
          const look = async (view) => {
            await settle(page);
            for (const p of await page.evaluate(lowContrastText, min)) problems.push(`${where}, ${view}: ${p}`);
          };
          const load = async (advanced) => {
            await page.evaluate((set) => {
              const c = JSON.parse(localStorage.getItem('rgxl_cfg') || '{}');
              localStorage.setItem('rgxl_cfg', JSON.stringify({ ...c, v: 1, ...set }));
            }, { theme, size, advanced, settingsButton: advanced }); // the header's Settings button shows on the second pass
            await page.reload();
          };
          // Simple controls (one Stop bar), then advanced (skip, pause, sleep)
          // with the header's Settings button shown.
          await load('off');
          await look('stations, simple controls');
          await load('on');
          await look('stations');
          for (const id of DIALOGS) {
            await page.evaluate((id) => window.showOverlay(document.getElementById(id)), id);
            await look(id);
            await page.evaluate((id) => window.hideOverlay(document.getElementById(id)), id);
          }
          await page.evaluate(() => window.openSettings());
          await page.waitForSelector('#settings-panel.open');
          await look('settings');
          await page.evaluate(() => window.openStreamBrowser());
          await look('station browser');
          // A shelf's station rows (a search draws the same rows), then a
          // country picked so the region list shows.
          await page.evaluate(() => window.openShelf(document.querySelector('.sb-shelf').dataset.shelf));
          await look('station browser, a shelf');
          await page.evaluate(() => window.backToShelves());
          await page.selectOption('#sb-country', 'US');
          await page.waitForSelector('#sb-region:not([disabled])', { timeout: 10000 });
          await look('station browser, country and region');
          await page.evaluate(() => window.closeStreamBrowser());
          // The guide's frame and, offline, the message in its place. The
          // guide page inside the frame is marsh.city's, outside this check.
          await page.evaluate(() => window.openHelp());
          await look('guide');
          await page.evaluate(() => {
            window.closeHelp(false);
            document.getElementById('help-body').replaceChildren();
            Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
            window.openHelp();
          });
          await look('guide, offline');
          await page.evaluate(() => {
            window.closeHelp(false);
            document.getElementById('help-body').replaceChildren();
            delete navigator.onLine;
            window.closeSettings();
          });
        }
      }
    } finally {
      await close();
    }
  }
  assert.deepEqual([...new Set(problems)], [], 'text below the contrast the promise sets');
});
