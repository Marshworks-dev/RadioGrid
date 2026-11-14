/**
 * Advanced controls on a phone: with a recording playing, Back, Pause, Stop,
 * Skip and Sleep all show, and none may sit on another (Jason, 2026-11-07:
 * at 390 px and under, Skip ran under the Sleep button pinned to the right
 * edge). Where one row can't hold them, the bar grows a second row, and
 * nothing drops its name. Live radio, which shows no skip, keeps one row.
 * Real Chromium layout (jsdom has none), so it needs the sandbox off like
 * the promise checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './browser-harness.mjs';

const WIDTHS = [320, 360, 375, 390, 414, 430, 768];
const CFG = JSON.stringify({
  advanced: 'on',
  // A full radio, so the grid fills the screen and a bar that grows without
  // the grid re-sizing would cover the bottom tiles.
  streams: Array.from({ length: 8 }, (_, i) => ({ id: 's' + (i + 1), label: 'Story ' + (i + 1), sub: '', url: `https://stream.example/story${i + 1}.mp3`, emoji: '📖', color: 'blue' })),
});
const seed = `try { localStorage.setItem('rgxl_cfg', ${JSON.stringify(CFG)}); } catch (e) {}`;

/** Put the bar in its playing state, as a recording (length known) or live
    radio, without real audio: the harness serves media as an empty body. */
async function showPlaying(page, { recording }) {
  await page.evaluate((rec) => {
    /* global audio, playing:writable, paused:writable, updateAdvTransport -- the app's own script globals */
    const el = document.querySelector('audio') || audio;
    Object.defineProperty(el, 'duration', { configurable: true, get: () => (rec ? 600 : Infinity) });
    playing = 's1';
    paused = false;
    updateAdvTransport();
  }, recording);
}

const CONTROLS = ['#adv-skip-back', '#adv-pause', '.adv-stop', '#adv-skip-fwd', '.adv-sleep-btn'];

function overlaps(a, b) {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

async function measure(page) {
  return page.evaluate((sels) => {
    const bar = document.getElementById('adv-transport').getBoundingClientRect();
    const boxes = sels.map((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const words = [...el.querySelectorAll('.adv-text, .adv-word')].map((w) => getComputedStyle(w).display !== 'none');
      return { sel, left: r.left, right: r.right, top: r.top, bottom: r.bottom, shown: r.width > 0 && r.height > 0, wordsShown: words.every(Boolean) };
    });
    const tiles = [...document.querySelectorAll('#buttons .stream-btn')].map((t) => t.getBoundingClientRect().bottom);
    return { bar: { top: bar.top, bottom: bar.bottom, height: bar.height }, boxes, vw: document.documentElement.clientWidth, tilesBottom: Math.max(...tiles) };
  }, CONTROLS);
}

for (const width of WIDTHS) {
  test(`at ${width}px, a recording's controls all show and none sits on another`, async () => {
    const { page, close } = await openApp({ viewport: { width, height: 800 }, initScript: seed });
    try {
      await showPlaying(page, { recording: true });
      const { bar, boxes, vw, tilesBottom } = await measure(page);
      assert.ok(tilesBottom <= bar.top + 0.5, `the station tiles end above the bar (${tilesBottom} vs ${bar.top})`);
      for (const b of boxes) {
        assert.ok(b.shown, `${b.sel} shows`);
        assert.ok(b.left >= 0 && b.right <= vw + 0.5, `${b.sel} stays on screen (${b.left}–${b.right} of ${vw})`);
        assert.ok(b.top >= bar.top - 0.5 && b.bottom <= bar.bottom + 0.5, `${b.sel} stays inside the bar`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          assert.ok(!overlaps(boxes[i], boxes[j]), `${boxes[i].sel} overlaps ${boxes[j].sel}`);
        }
      }
      // Names stay on every phone wide enough to have had them before.
      if (width >= 360) for (const b of boxes) assert.ok(b.wordsShown, `${b.sel} keeps its name`);
    } finally {
      await close();
    }
  });
}

test('live radio keeps the one-row bar on a narrow phone; only a recording grows it — unhappy path for the taller bar', async () => {
  const { page, close } = await openApp({ viewport: { width: 375, height: 800 }, initScript: seed });
  try {
    await showPlaying(page, { recording: false });
    const live = (await measure(page)).bar.height;
    await showPlaying(page, { recording: true });
    const rec = (await measure(page)).bar.height;
    await showPlaying(page, { recording: false });
    const liveAgain = (await measure(page)).bar.height;
    assert.ok(live < 90, `live bar is one row (${live}px)`);
    assert.equal(liveAgain, live, 'back to one row when live radio plays again');
    assert.ok(rec > live + 40, `a recording on a phone gets the second row (${live}px → ${rec}px)`);
  } finally {
    await close();
  }
});

/* The simple Stop bar, paused, reads "▶ Resume <station>" (Jason, 2026-11-11,
   iPhone app: the name ran edge to edge). The bar keeps its height, so a long
   name wraps, then shrinks; it never touches the edges or spills out. */
const NAMES = ['YourClassical Relax', 'Radio Paradise Mellow Mix', 'Hawaii Public Radio HPR2 Classical and Jazz'];
const SIMPLE_CFG = (label) => JSON.stringify({
  streams: [{ id: 's1', label, sub: '', url: 'https://stream.example/s1.mp3', emoji: '📻', color: 'blue' }],
});

async function showPaused(page, size) {
  return page.evaluate((size) => {
    /* global playing:writable, paused:writable, updateSimpleStop */
    if (size) document.documentElement.dataset.size = size;
    playing = 's1';
    paused = true;
    updateSimpleStop();
    const bar = document.getElementById('simple-stop').getBoundingClientRect();
    const label = document.getElementById('simple-stop-label');
    const r = label.getBoundingClientRect();
    return { left: r.left - bar.left, right: bar.right - r.right, top: r.top - bar.top, bottom: bar.bottom - r.bottom,
      clipped: label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1,
      font: parseFloat(getComputedStyle(label).fontSize), text: label.textContent };
  }, size);
}

for (const width of [320, 375, 430]) {
  test(`at ${width}px, a paused station's name stays off the Stop bar's edges in every text size`, async () => {
    for (const name of NAMES) {
      const { page, close } = await openApp({ viewport: { width, height: 800 }, initScript: `try { localStorage.setItem('rgxl_cfg', ${JSON.stringify(SIMPLE_CFG(name))}); } catch (e) {}` });
      try {
        for (const size of ['normal', 'large', 'xlarge', 'ultra']) {
          const m = await showPaused(page, size);
          const at = `${name} at ${size}`;
          assert.match(m.text, /Resume/);
          assert.ok(m.left >= 12 && m.right >= 12, `${at}: side margins ${Math.round(m.left)} / ${Math.round(m.right)}px`);
          assert.ok(m.top >= 0 && m.bottom >= 0, `${at}: stays inside the bar (${Math.round(m.top)} / ${Math.round(m.bottom)})`);
          assert.ok(!m.clipped, `${at}: nothing clipped`);
        }
      } finally {
        await close();
      }
    }
  });
}

test('the longest name a backup can hold still fits, and Stop is full size again after it — unhappy path', async () => {
  const name = 'A very long station name '.repeat(5).slice(0, 120);
  const { page, close } = await openApp({ viewport: { width: 320, height: 800 }, initScript: `try { localStorage.setItem('rgxl_cfg', ${JSON.stringify(SIMPLE_CFG(name))}); } catch (e) {}` });
  try {
    const before = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('simple-stop-label')).fontSize));
    const m = await showPaused(page, null);
    assert.ok(m.top >= 0 && m.bottom >= 0 && m.left >= 12 && m.right >= 12 && !m.clipped, `120 characters fit (${JSON.stringify(m)})`);
    assert.ok(m.font >= 12, `still readable (${m.font}px)`);
    const stopFont = await page.evaluate(() => {
      paused = false;
      updateSimpleStop();
      return parseFloat(getComputedStyle(document.getElementById('simple-stop-label')).fontSize);
    });
    assert.equal(stopFont, before, 'Stop goes back to its own size');
  } finally {
    await close();
  }
});
