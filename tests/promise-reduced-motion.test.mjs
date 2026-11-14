/**
 * PROMISES.md: "With Reduce Motion on, nothing moves."
 *
 * A real Chromium run with prefers-reduced-motion: reduce emulated, walking
 * every screen (walkEverything in browser-harness.mjs). After each step:
 *   - no animation may be running (CSS or Web Animations from script);
 *   - no element or pseudo-element may carry a transition or animation longer
 *     than the 0.01ms the reduce block sets (effectively none: the rule
 *     shortens rather than removes, so end events still fire);
 *   - nothing may scroll smoothly;
 *   - nothing visible may change place, size, opacity, transform or scroll
 *     offset over the next moment, which catches script-driven motion
 *     (requestAnimationFrame, timers) that no animation API reports.
 *   - no script may start a Web Animation (element.animate) longer than
 *     MAX_MS, however short or whenever it ran: each call is recorded as it
 *     happens, so one that finishes before the look is still seen.
 * Motion shorter than the settle before each look (60ms, then two drawn
 * frames) can slip by the geometry check, unless the recorder sees it.
 * Breakers: tests/promise-breakers.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, openSettingsByButton, walkEverything } from './browser-harness.mjs';

const MAX_MS = 0.01;

/** Runs in the page before the app: records every element.animate() call
    that runs longer than MAX_MS in all, its repeats counted (a 0.01ms
    flicker repeated 80,000 times runs 800ms). A red-team pass found that a
    short script fade (say 150ms on a closing overlay) could end before the
    first look, more so on a slow runner, and escape every timing-based
    check. */
const RECORD_SCRIPT_ANIMATIONS = `(() => {
  window.__scriptAnimations = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const once = typeof options === 'number' ? options : (options && Number(options.duration)) || 0;
    const times = (options && typeof options === 'object' && options.iterations !== undefined) ? Number(options.iterations) : 1;
    const ms = once * times;
    if (ms > ${MAX_MS}) window.__scriptAnimations.push((this.id || this.tagName.toLowerCase()) + ' ' + ms + 'ms');
    return animate.call(this, keyframes, options);
  };
})();`;

/** Script animations recorded since the last call. */
async function scriptAnimations(page) {
  return page.evaluate(() => (window.__scriptAnimations || []).splice(0));
}

/** Everything that would move: running animations, and any element or
    pseudo-element with a transition or animation longer than MAX_MS. */
async function motion(page) {
  return page.evaluate((max) => {
    const ms = (v) => Math.max(...v.split(',').map((t) => (t.trim().endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000)));
    const running = document.getAnimations()
      .filter((a) => a.playState === 'running' && ((a.effect && a.effect.getComputedTiming().activeDuration) || 0) > max)
      .map((a) => `${a.constructor.name} on ${a.effect && a.effect.target && (a.effect.target.id || a.effect.target.className)}`);
    const long = [];
    for (const el of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        const t = ms(cs.transitionDuration);
        const a = cs.animationName !== 'none' ? ms(cs.animationDuration) : 0;
        if (t > max || a > max) long.push(`${el.id || el.tagName.toLowerCase() + '.' + el.className}${pseudo || ''} transition ${cs.transitionDuration} animation ${cs.animationDuration}`);
      }
    }
    return { running, long };
  }, MAX_MS);
}

/** Where everything visible is and how it looks: box, opacity, transform,
    and scroll offsets. Two of these a moment apart differ only if something
    moved on its own: a script stepping a transform each frame, a timer
    nudging a position, a scroll easing into place. */
async function geometry(page) {
  return page.evaluate(() => {
    const out = {};
    let i = 0;
    for (const el of document.querySelectorAll('body *')) {
      i++;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const cs = getComputedStyle(el);
      out[`${i}:${el.id || el.tagName.toLowerCase() + '.' + el.className}`] =
        [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), cs.opacity, cs.transform, el.scrollTop, el.scrollLeft].join(' ');
    }
    out.window = `${scrollX} ${scrollY}`;
    return out;
  });
}

/** Smooth scrolling is motion too, and no animation or transition shows it. */
async function smoothScroll(page) {
  return page.evaluate(() => [document.documentElement, ...document.querySelectorAll('body *')]
    .filter((el) => getComputedStyle(el).scrollBehavior === 'smooth')
    .map((el) => el.id || el.tagName.toLowerCase()));
}

const SETTLE_MS = 400;

/** Wait until the browser has drawn two frames. The reduce block shortens
    transitions to 0.01ms, but even those end only on the next frame, and a
    loaded CI runner can take longer than a fixed wait to draw one: an
    overlay closed by the step still read opacity 1 in the first snapshot
    and 0 in the second, which looked like motion (three CI runs on
    2026-11-07, a different overlay each time). Two frames, so a change
    queued in the first one has landed too. */
async function framesDrawn(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Wait out the transitions the reduce block already shortened to MAX_MS.
    Two frames still weren't always enough: the PIN pad closing as settings
    opened read opacity 1, then 0 (CI, 2026-11-14). Each one's own finished
    promise says when it has landed. Only those that end within MAX_MS,
    delay and repeats counted: anything longer is motion, and a delayed jump
    must still land between the two snapshots. Bounded, so a stuck one
    can't hang the walk. */
async function shortTransitionsDone(page) {
  await page.evaluate((max) => Promise.race([
    Promise.all(document.getAnimations()
      .filter((a) => a.effect && a.effect.getComputedTiming().endTime <= max)
      .map((a) => a.finished.catch(() => {}))),
    new Promise((done) => setTimeout(done, 1000)),
  ]), MAX_MS);
}

test('with Reduce Motion on, nothing moves on any screen', async () => {
  const { page, context, close } = await openApp({ reducedMotion: 'reduce', initScript: RECORD_SCRIPT_ANIMATIONS });
  const seen = [];
  try {
    await walkEverything(page, context, async (step) => {
      await page.waitForTimeout(60);
      await framesDrawn(page);
      const m = await motion(page);
      const smooth = await smoothScroll(page);
      await shortTransitionsDone(page);
      const before = await geometry(page);
      await page.waitForTimeout(SETTLE_MS);
      const after = await geometry(page);
      const moved = Object.keys(after).filter((k) => k in before && before[k] !== after[k])
        .map((k) => `${k}: ${before[k]} → ${after[k]}`);
      const scripted = await scriptAnimations(page);
      if (m.running.length || m.long.length || smooth.length || moved.length || scripted.length) seen.push({ step, ...m, smooth, moved, scripted });
    });
    assert.deepEqual(seen, [], 'something moved with Reduce Motion on');
  } finally {
    await close();
  }
});

test('with Reduce Motion off the check does see motion, so a clean run means something', async () => {
  const { page, close } = await openApp({ reducedMotion: 'no-preference' });
  try {
    await openSettingsByButton(page);
    const m = await motion(page);
    assert.ok(m.long.length > 0, 'expected transitions to exist when motion is allowed');
    // And the geometry snapshot catches a script-driven move.
    const before = await geometry(page);
    await page.evaluate(() => { const el = document.getElementById('settings-close'); el.style.transition = 'none'; el.style.transform = 'translateX(3px)'; });
    const after = await geometry(page);
    assert.ok(Object.keys(after).some((k) => before[k] !== after[k]), 'a moved element shows in the snapshot');
  } finally {
    await close();
  }
});
