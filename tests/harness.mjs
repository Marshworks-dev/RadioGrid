/**
 * jsdom test harness for RadioGridXL.
 *
 * Loads the single-file app into a real DOM so we can exercise the actual
 * persistence / validation / PIN logic — the surface where the v7.x bugs lived
 * (PIN lockout, getPin disable semantics, config + URL validation). jsdom has
 * no layout engine (getBoundingClientRect/clientHeight are 0), so the sizing
 * arithmetic in renderButtons() is covered on stubbed sizes in
 * tests/layout.test.mjs, and how text really wraps and clips is verified on a
 * real Android WebView.
 *
 * Why jsdom (the project's only dev dependency): it's the standard Node DOM
 * implementation; hand-rolling enough of the DOM + LocalStorage to run the app
 * is not realistic. The shipped RadioGridXL.html stays zero-dependency.
 */
import { markMoved } from '../hosted-build.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

// User agents so platform detection matches the real target. The kiosk runs on
// Android tablets, so that's the default; `desktop: true` exercises the
// desktop code path (e.g. the desktop-only init branch).
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const baseHtml = readFileSync(join(repo, 'RadioGridXL.html'), 'utf-8');

// Every window loadApp() opens is closed once the file's tests are done. A
// window on real timers keeps an interval it started (the 6-hour update
// check, the no-audio check while a station plays) and would hold the
// process open after the last test.
const openWindows = new Set();
after(() => { for (const w of openWindows) w.close(); openWindows.clear(); });

// Same sentinel-marker swap that build-profile.mjs performs, done in-memory so
// tests can load a branded profile (e.g. the example-org fixture) without a build
// step or disk writes.
const START = '/* === PROFILE CONFIG — build-profile.mjs replaces this block === */';
const END = '/* === END PROFILE CONFIG === */';

// Shipped profiles live in profiles/; test-only ones (a branded profile with a
// PIN, no guide, no feedback card) in tests/fixtures/.
function profilePath(name) {
  const shipped = join(repo, 'profiles', `${name}.json`);
  return existsSync(shipped) ? shipped : join(repo, 'tests', 'fixtures', `${name}.json`);
}

function htmlWithProfile(name) {
  if (!name) return baseHtml; // repo default (generic) profile, inlined as-is
  // A profile object (not a name) tests a shape no profile file has, e.g. no logo.
  const profile = typeof name === 'object' ? name : JSON.parse(readFileSync(profilePath(name), 'utf-8'));
  const s = baseHtml.indexOf(START);
  const e = baseHtml.indexOf(END);
  const block = `${START}\nconst PROFILE = ${JSON.stringify(profile, null, 2)};\n${END}`;
  return baseHtml.slice(0, s) + block + baseHtml.slice(e + END.length);
}

/**
 * Boot the app in a fresh jsdom window.
 *   profile       — optional profile name to splice in ('example-org' etc.), or a
 *                   profile object for a shape no profile file has
 *   seed          — { rgxl_cfg, rgxl_pin } LocalStorage values applied AFTER
 *                   the initial (empty-storage) boot, then re-loaded so cfg/PIN
 *                   reflect the seed exactly as a real cold start would.
 *   prefersLight  — what matchMedia('prefers-color-scheme: light') reports.
 *   url           — page URL; file:// mimics the Android APK / a copied file.
 *   moved         — true for the last build at marsh.city/radio (markMoved), or a
 *                   string: a mark with that content, for marks the app must ignore
 *   beforeParse   — optional fn(window) run before the app's script, for APIs
 *                   the app feature-detects once at parse time (mediaSession).
 * Returns the jsdom `window` (all top-level `function` declarations are on it;
 * `const`/`let` module state such as `cfg` is not — assert via LocalStorage or
 * the DOM, exactly as the CDP on-device tests do).
 */
export function loadApp({ profile, seed = {}, prefersLight = false, desktop = false, url = 'http://localhost/', moved = false, beforeParse } = {}) {
  // Capture anything init() throws at parse time so tests can assert a clean boot.
  const bootErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => bootErrors.push(e));

  const html = htmlWithProfile(profile);
  const markWith = (content) => html.replace('<meta charset="UTF-8">', () => `<meta charset="UTF-8">\n<meta name="radiogrid-moved" content="${content.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">`);
  const dom = new JSDOM(moved === true ? markMoved(html) : typeof moved === 'string' ? markWith(moved) : html, {
    runScripts: 'dangerously',
    url, // default http://localhost/ — a non-opaque origin so window.localStorage works
    pretendToBeVisual: true,  // provides requestAnimationFrame
    userAgent: desktop ? UA_DESKTOP : UA_ANDROID,
    virtualConsole,
    beforeParse(window) {
      // jsdom's `userAgent` constructor option doesn't reach navigator.userAgent,
      // which the app's platform detection reads at top-level. Force it here
      // (before parse) so isAndroid/isDesktop resolve to the intended target.
      Object.defineProperty(window.navigator, 'userAgent', {
        value: desktop ? UA_DESKTOP : UA_ANDROID,
        configurable: true,
      });
      // matchMedia is called at top-level (platform detection) BEFORE init(),
      // so it must exist before parse or the whole script aborts. jsdom omits
      // it. Minimal, deterministic stub.
      window.matchMedia = (q) => ({
        matches: /prefers-color-scheme:\s*light/.test(q) ? prefersLight : false,
        media: q,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
      });
      if (beforeParse) beforeParse(window);
    },
  });

  const { window } = dom;
  openWindows.add(window);
  window.__bootErrors = bootErrors; // errors thrown during init() at parse time
  const seedKeys = Object.keys(seed);
  if (seedKeys.length) {
    for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    // Re-run exactly what init() runs against storage, so a seeded value is
    // honored as on a cold boot.
    window.sanitizeStoredPin();
    window.loadSettings();
  }
  return window;
}
