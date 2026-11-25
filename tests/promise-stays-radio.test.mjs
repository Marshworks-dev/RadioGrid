/**
 * Checks that the radio never opens a website, another app or a new window;
 * the how-to guide opens inside it.
 *
 * Three layers:
 *   - the source has no way to leave: no window.open, no link target, no
 *     page address assigned, no mailto/tel/sms link, no form;
 *   - in Chromium, every screen (walkEverything) has no link off the page
 *     and nothing with a target or a form action;
 *   - the walk, and then a tap on every button and link on the stations
 *     screen and in settings, never opens a window or moves the page
 *     itself anywhere but the app (the guide's frame is inside the page).
 * Breakers: tests/promise-breakers.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openApp, walkEverything, APP_ORIGIN } from './browser-harness.mjs';

const html = readFileSync(new URL('../RadioGridXL.html', import.meta.url), 'utf-8');

test('the source has no way to open a website, an app or a window', () => {
  const ways = [
    [/window\.open\s*\(/, 'window.open()'],
    [/\btarget\s*=\s*["']/i, 'a link target'],
    [/\.target\s*=\s*['"`]/, 'a target set from script'],
    [/(?:^|[^.\w])(?:window\.|document\.)?location(?:\.href)?\s*=(?!=)/m, 'the page address assigned'],
    [/location\.(?:assign|replace)\s*\(/, 'location.assign() or replace()'],
    [/href\s*=\s*["'](?:mailto|tel|sms):/i, 'a mailto, tel or sms link'],
    [/['"`](?:mailto|tel|sms):/i, 'a mailto, tel or sms address in script'],
    [/<form\b/i, 'a form'],
  ].filter(([re]) => re.test(html)).map(([, what]) => what);
  assert.deepEqual(ways, []);
});

/** In the page: links that would leave, and anything carrying a target or a form action. */
function waysOut(origin) {
  const out = [];
  for (const a of document.querySelectorAll('a[href], area[href]')) {
    const u = new URL(a.getAttribute('href'), location.href);
    if (u.origin !== origin && u.protocol !== 'blob:') out.push(`link to ${u.href}`);
  }
  for (const el of document.querySelectorAll('[target], form, [formaction]')) out.push(`${el.tagName.toLowerCase()} ${el.outerHTML.slice(0, 80)}`);
  return out;
}

test('on every screen, nothing opens a website, an app or a window, even with every control tapped', { timeout: 240000 }, async () => {
  const { page, context, close } = await openApp();
  const left = [];
  context.on('page', (p) => { if (p !== page) left.push(`a new window: ${p.url()}`); });
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame() && new URL(f.url()).origin !== APP_ORIGIN) left.push(`the page went to ${f.url()}`);
  });
  const found = new Set();
  const look = async (step) => { for (const w of await page.evaluate(waysOut, APP_ORIGIN)) found.add(`${step}: ${w}`); };
  /** Click every button and link in `scope`, in order, ignoring what each does. */
  const tapAll = (scope) => page.evaluate((sel) => {
    let n = 0;
    for (const el of [...document.querySelectorAll(`${sel} button, ${sel} a, ${sel} [role="button"]`)]) {
      if (/apply-btn|reset-btn|settings-close/.test(el.id)) continue; // these close settings: tapped by the walk
      try { el.click(); n++; } catch (e) { /* a control that throws isn't this check's business */ }
    }
    return n;
  }, scope);
  try {
    await walkEverything(page, context, look);

    // The stations screen: every station, the transport, the logo.
    assert.ok(await tapAll('#app') > 0);
    await page.waitForTimeout(500);
    await look('after tapping everything on the stations screen');

    // Settings: every button and link in it.
    await page.evaluate(() => window.openSettings());
    await page.waitForSelector('#settings-panel.open');
    assert.ok(await tapAll('#settings-panel') > 10);
    await page.waitForTimeout(1000);
    await look('after tapping everything in settings');

    assert.deepEqual([...found], [], 'a way off the radio');
    assert.deepEqual(left, [], 'the radio opened something');
  } finally {
    await close();
  }
});
