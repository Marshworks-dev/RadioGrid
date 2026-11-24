/**
 * Retake every guide screenshot from the real app.
 *
 *   npm run guide:capture
 *
 * Builds the default profile (exactly what marsh.city/radio ships), replays
 * each scene in guide/scenes.mjs in headless Chromium at phone size, outlines
 * the control the guide talks about, and writes guide/shots/<id>.webp. Then
 * the project-page shots (PAGE_SHOTS) the same way, without an outline, into
 * guide/page/<id>.webp. Shots are webp at quality 80, no wider than 1600px:
 * about a third of the same JPEG, for a site page that loads a dozen of them.
 * Encoding is cwebp's (libwebp; `brew install webp`), since Playwright only
 * writes PNG and JPEG. Last it stamps the app version into guide.md's
 * frontmatter, which is what the "captured at the current version" test
 * checks for both.
 *
 * All network is blocked: the app is served from memory and nothing else
 * loads, so shots are the same on every run (no live stations, no fetches).
 * Page shots answer a station's stream with a minute of silence, so tapping
 * one really plays.
 *
 * Why Playwright (dev-only, never ships): it drives a real browser engine, so
 * layout, fonts and emoji render as visitors see them — jsdom can't screenshot.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCENES, PAGE_SHOTS } from './scenes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const shotsDir = join(here, 'shots');
const pageDir = join(here, 'page');
const guidePath = join(here, 'guide.md');
const APP_URL = 'http://localhost/radio/';
const OUTLINE = '#ff2d8a'; // hot pink: stands out on every app theme and button color

execFileSync('node', ['build-profile.mjs', 'default'], { cwd: repo, stdio: 'inherit' });
const html = readFileSync(join(repo, 'dist', 'RadioGridXL.html'), 'utf-8');
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8')).version;
mkdirSync(shotsDir, { recursive: true });
mkdirSync(pageDir, { recursive: true });

try {
  execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('✗ cwebp not found. It encodes the screenshots: brew install webp');
  process.exit(1);
}
const scratch = mkdtempSync(join(tmpdir(), 'rgxl-capture-'));

/** Screenshot `page` as webp at `out`, at most 1600px wide. */
async function shoot(page, out) {
  const png = join(scratch, 'shot.png');
  await page.screenshot({ path: png, type: 'png' });
  const width = await page.evaluate(() => innerWidth * devicePixelRatio);
  const resize = width > 1600 ? ['-resize', '1600', '0'] : [];
  execFileSync('cwebp', ['-quiet', '-q', '80', ...resize, png, '-o', out]);
}

/** Drop shots in `dir` that no scene makes any more (a renamed scene, or the
    old .jpg of one), so the sync never carries a stale picture. */
function pruneShots(dir, ids) {
  for (const f of readdirSync(dir)) {
    if (/\.(jpg|webp)$/.test(f) && !ids.includes(f.replace(/\.webp$/, ''))) rmSync(join(dir, f));
  }
}

const pause = (page, ms) => page.waitForTimeout(ms);

async function runStep(page, scene, step) {
  if (step.tapLogo) {
    for (let i = 0; i < step.tapLogo; i++) await page.click('#logo-area');
  } else if (step.pin) {
    for (const digit of step.pin) await page.click(`#pin-pad [aria-label="${digit}"]`);
  } else if (step.click) {
    await page.click(step.click);
  } else if (step.fill) {
    await page.fill(step.fill, step.value);
  } else if (step.live) {
    // The minute of silence reports a length, so the app would take it for a
    // recording (Pause, Back 15, Skip 30). Live radio reports none.
    await page.evaluate(() => Object.defineProperty(document.getElementById('audio-player'), 'duration', { get: () => Infinity }));
  } else {
    throw new Error(`[${scene.id}] unknown step ${JSON.stringify(step)}`);
  }
  await pause(page, 450); // let the settings slide-in and overlays finish animating
}

/** Scroll the target to the middle of its scroller and draw a ring around it. */
async function outline(page, selector) {
  await page.locator(selector).first().evaluate((el, color) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const pad = 3;
    const edge = 2; // keep the ring on screen for controls flush with the viewport edge
    const left = Math.max(edge, r.left - pad);
    const top = Math.max(edge, r.top - pad);
    const right = Math.min(innerWidth - edge, r.right + pad);
    const bottom = Math.min(innerHeight - edge, r.bottom + pad);
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'fixed',
      boxSizing: 'border-box',
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
      border: `4px solid ${color}`,
      borderRadius: '12px',
      boxShadow: '0 0 0 3px rgba(255,255,255,0.85), 0 0 18px rgba(0,0,0,0.45)',
      pointerEvents: 'none',
      zIndex: '99999',
    });
    document.body.appendChild(ring);
  }, OUTLINE);
}

/** A minute of silence as an 8 kHz, 8-bit mono WAV: what a page shot's
    station "streams". */
function silentWav(seconds = 60) {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds, 128); // 128 is the zero line for 8-bit audio
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate, 28); header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
const SILENCE = silentWav();
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const browser = await chromium.launch();
try {
  for (const scene of SCENES) {
    // A fresh context per scene = empty LocalStorage, like a first visit.
    const context = await browser.newContext({
      viewport: { width: 390, height: 760 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: 'dark',
      serviceWorkers: 'block',
      userAgent: PHONE_UA,
    });
    await context.route('**/*', (route) =>
      route.request().url() === APP_URL
        ? route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' })
        : route.abort());
    const page = await context.newPage();
    if (scene.seed) {
      await page.addInitScript((seed) => {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
      }, scene.seed);
    }
    await page.goto(APP_URL);
    await pause(page, 300);
    for (const step of scene.steps) await runStep(page, scene, step);
    await outline(page, scene.highlight);
    await shoot(page, join(shotsDir, `${scene.id}.webp`));
    console.log(`  ✓ ${scene.id}`);
    await context.close();
  }

  for (const shot of PAGE_SHOTS) {
    const context = await browser.newContext({
      viewport: shot.phone ? { width: 390, height: 844 } : (shot.viewport || { width: 800, height: 600 }),
      deviceScaleFactor: 2,
      isMobile: !!shot.phone,
      hasTouch: !!shot.phone,
      colorScheme: 'dark',
      serviceWorkers: 'block',
      userAgent: shot.phone ? PHONE_UA : DESKTOP_UA,
    });
    await context.route('**/*', (route) => {
      const request = route.request();
      if (request.url() === APP_URL) return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
      if (request.resourceType() === 'media') return route.fulfill({ body: SILENCE, contentType: 'audio/wav' });
      return route.abort();
    });
    const page = await context.newPage();
    await page.addInitScript((seed) => {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }, shot.seed || {});
    await page.goto(APP_URL);
    await pause(page, 300);
    for (const step of shot.steps) await runStep(page, shot, step);
    await pause(page, 1200); // a playing station fades in; transitions settle
    await shoot(page, join(pageDir, `${shot.id}.webp`));
    console.log(`  ✓ page/${shot.id}`);
    await context.close();
  }
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
pruneShots(shotsDir, SCENES.map((s) => s.id));
pruneShots(pageDir, PAGE_SHOTS.map((s) => s.id));

const guide = readFileSync(guidePath, 'utf-8');
writeFileSync(guidePath, guide.replace(/^appVersion:.*$/m, `appVersion: ${version}`));
console.log(`\nCaptured ${SCENES.length} guide and ${PAGE_SHOTS.length} project-page screenshots for v${version}. Look them over before syncing.`);
