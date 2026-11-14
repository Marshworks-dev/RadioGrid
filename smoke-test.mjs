#!/usr/bin/env node
/**
 * Smoke test for RadioGridXL
 * No external dependencies — runs with plain Node.js (v18+).
 * Usage: node smoke-test.mjs
 */

import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';

const FILE = 'RadioGridXL.html';
let src;
try {
  src = readFileSync(FILE, 'utf-8');
} catch (e) {
  console.error(`FAIL: Cannot read ${FILE}`);
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

// ── Structure ──
console.log('\n── Structure ──');
assert(src.startsWith('<!DOCTYPE html>'), 'Has DOCTYPE');
assert(src.includes('<html lang="en">'), 'Has lang attribute');
assert(src.includes('<meta charset="UTF-8">'), 'Has charset meta');
assert(src.includes('user-scalable=no'), 'Viewport disables zoom (kiosk)');
assert(src.includes('<audio id="audio-player"'), 'Audio element exists');
assert(src.includes('id="app"'), 'App container exists');
assert((src.match(/<script[\s>]/g) || []).length === 1, 'Single inline script (no external scripts)');
assert(!(/<link[^>]+rel=["']stylesheet/i.test(src)), 'No external stylesheets');
assert(!src.includes('src="http'), 'No external script/image src attributes');
assert(!/<script[^>]+src=/i.test(src), 'No external script sources');
// A budget, so growth past it is a decision rather than drift. Gzipped is what
// a visitor downloads (Pages compresses it; the service worker then caches it).
// 66 KB at v7.9.0; 100 KB at v7.22.0, when it was raised to 110; 110 KB at
// v7.23.6, when it was raised to 125. Raising it is fine. About 40% of the
// gzipped file is comments, so stripping them in the build is the other way
// out.
const GZIP_BUDGET_KB = 125;
const gzipKB = gzipSync(src, { level: 9 }).length / 1024;
assert(gzipKB <= GZIP_BUDGET_KB, `App is ${gzipKB.toFixed(0)} KB gzipped, within its ${GZIP_BUDGET_KB} KB budget`);
// CI runs the Node major in .nvmrc. A different one here can pass what CI
// fails (zlib output shifts between majors, which once moved the budget
// above). After a Node upgrade, bump .nvmrc and CI follows.
const pinnedNode = readFileSync('.nvmrc', 'utf-8').trim();
const runningNode = process.versions.node.split('.')[0];
assert(runningNode === pinnedNode, `Running Node ${runningNode}, the major in .nvmrc that CI uses (${pinnedNode})`);

// ── Security: Escaping ──
console.log('\n── Security: Escaping ──');
assert(src.includes('escHtml(s.label)'), 'Stream label is HTML-escaped');
assert(src.includes('escHtml(s.sub)'), 'Stream sublabel is HTML-escaped');
assert(src.includes('escHtml(s.emoji)'), 'Stream emoji is HTML-escaped');
assert(src.includes("escAttr("), 'escAttr is used for attribute values');
assert(src.includes("&#39;") || src.includes("'&#39;'"), 'escAttr handles single quotes');
assert(src.includes("&gt;") || src.includes("'&gt;'"), 'escAttr handles >');

// ── Security: URL validation ──
console.log('\n── Security: URL validation ──');
assert(src.includes('isValidStreamUrl'), 'Stream URL validation function exists');
assert(src.includes('isValidStreamUrl(s.url)'), 'URL validation applied at save time');
assert(/^https\?:\/\//m.test(src) || src.includes("https?:\\/\\/"), 'URL validation checks http(s) scheme');

// ── Security: PIN ──
console.log('\n── Security: PIN ──');
assert(src.includes('pinLocked'), 'PIN lockout mechanism exists');
assert(src.includes('pinFailCount'), 'PIN failure tracking exists');
assert(src.includes('Too many attempts'), 'Lockout message shown after failures');

// ── Security: Config validation ──
console.log('\n── Security: Config validation ──');
assert(src.includes(".includes(s.theme)") || src.includes("includes(s.theme)"), 'Theme value validated against allowlist');
assert(src.includes(".includes(s.size)") || src.includes("includes(s.size)"), 'Size value validated against allowlist');
assert(src.includes('typeof st.id') || src.includes("typeof st.label"), 'Stream entries type-checked on load');
assert(src.includes('.slice(0, 8)') || src.includes('.slice(0,8)'), 'Stream count capped at 8');

// ── Offline / Self-contained ──
console.log('\n── Offline / Self-contained ──');
const externalUrlPattern = /(?:src|href)=["'](https?:\/\/[^"']+)["']/gi;
const externalUrls = [];
let match;
while ((match = externalUrlPattern.exec(src)) !== null) {
  externalUrls.push(match[1]);
}
assert(externalUrls.length === 0, `No external resource URLs in src/href (found: ${externalUrls.length})`);

// CSS can load from outside too: url(...) in a rule or @font-face, and @import.
const cssExternal = [...src.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)|@import\s+["']?(https?:\/\/[^"';\s]+)/gi)].map(m => m[1] || m[2]);
assert(cssExternal.length === 0, `No external URLs in CSS url() or @import (found: ${cssExternal.length})`);

// Script can pull code in too: import() of a URL, a worker, or a script or
// stylesheet element built at run time. The app never needs any of these.
const scriptLoads = [
  [/import\(\s*['"`]https?:/, 'import() of an outside URL'],
  [/new\s+(?:Shared)?Worker\(\s*['"`]https?:/, 'a worker from an outside URL'],
  [/importScripts\s*\(/, 'importScripts()'],
  [/createElement\(\s*['"`](?:script|link|iframe)['"`]\s*\)\s*;?[\s\S]{0,200}?\.(?:src|href)\s*=\s*['"`]https?:/, 'a script, link or frame element pointed at an outside URL'],
  [/\.src\s*=\s*['"`]https?:/, 'an outside URL assigned to .src'],
  [/createElement\(\s*['"`]script['"`]\s*\)/, 'a script element built at run time'],
].filter(([re]) => re.test(src)).map(([, what]) => what);
assert(scriptLoads.length === 0, `No code or styles loaded from outside at run time (found: ${scriptLoads.join(', ') || 'none'})`);

// sw.js is part of the hosted shell: it must load nothing from outside either.
let swSrc = '';
try { swSrc = readFileSync('sw.js', 'utf-8'); } catch (e) { /* the PWA section asserts it exists */ }
const swOutside = [...swSrc.matchAll(/https?:\/\/[^\s'"`)]+|importScripts\s*\(|import\(/g)].map(m => m[0]);
assert(swOutside.length === 0, `sw.js names no outside URL and imports nothing (found: ${swOutside.join(', ') || 'none'})`);

const cdnPatterns = ['cdn.', 'cdnjs.', 'unpkg.com', 'jsdelivr.net', 'googleapis.com'];
// The starter shelves are stream addresses (data the app plays, not code it
// loads), and some stream hosts have "cdn" in their names; leave them out.
const shelvesStart = src.indexOf('/* === SHELVES');
const shelvesEnd = src.indexOf('/* === END SHELVES === */');
const codeOnly = shelvesStart >= 0 && shelvesEnd > shelvesStart ? src.slice(0, shelvesStart) + src.slice(shelvesEnd) : src;
const hasCdn = cdnPatterns.some(p => codeOnly.includes(p));
assert(!hasCdn, 'No CDN references');

// fetch() is allowed only for the stream browser (Radio Browser API discovery).
// Core playback and config must remain offline-capable.
const fetchCount = (src.match(/fetch\(/g) || []).length;
assert(fetchCount <= 2 && !src.includes('XMLHttpRequest'), `Network calls limited to stream browser only (fetch: ${fetchCount}, XHR: 0)`);

// ── Functional elements ──
console.log('\n── Functional elements ──');
assert(src.includes("id='buttons'") || src.includes('id="buttons"'), 'Buttons container exists');
assert(src.includes('playStream('), 'playStream function defined');
assert(src.includes('stopPlayback('), 'stopPlayback function defined');
assert(src.includes('loadSettings('), 'loadSettings function defined');
assert(src.includes('saveSettings('), 'saveSettings function defined');
assert(src.includes('requestWakeLock('), 'Wake lock support');
assert(src.includes('navigator.vibrate'), 'Haptic feedback support');
assert(src.includes("localStorage"), 'Uses localStorage for persistence');
assert(src.includes('rgxl_cfg'), 'Config storage key present');
assert(src.includes('rgxl_pin'), 'PIN storage key present');

// ── Accessibility ──
console.log('\n── Accessibility ──');
assert(src.includes('<header'), 'Semantic <header> element');
assert(src.includes('<main'), 'Semantic <main> element');
assert(src.includes('<nav'), 'Semantic <nav> element');
assert(src.includes('<aside'), 'Semantic <aside> element for settings');
assert(src.includes('role="dialog"'), 'Overlays use role="dialog"');
assert(src.includes('aria-modal="true"'), 'Dialogs marked as modal');
assert(src.includes('aria-labelledby'), 'Dialogs have aria-labelledby');
assert(src.includes('aria-pressed'), 'Stream buttons have aria-pressed state');
assert(src.includes('aria-label'), 'Interactive elements have aria-label');
assert(src.includes('role="status"'), 'Status elements use role="status"');
assert(src.includes('aria-live="polite"'), 'Polite live regions exist');
assert(src.includes('aria-live="assertive"'), 'Assertive live region for errors');
assert(src.includes('role="alert"'), 'Error messages use role="alert"');
assert(src.includes('role="radiogroup"'), 'Chip groups use radiogroup role');
assert(src.includes('role="radio"'), 'Chips use radio role');
assert(src.includes('aria-checked'), 'Radio chips have aria-checked');
assert(src.includes('aria-hidden="true"'), 'Decorative elements hidden from screen readers');
assert(src.includes(':focus-visible'), 'Focus-visible styles defined');
assert(src.includes('.sr-only'), 'Screen-reader-only utility class');
assert(src.includes("e.key === 'Escape'"), 'Escape key closes overlays');
assert(src.includes('_returnFocus') && src.includes('function restoreFocus'), 'Focus management for overlay open/close');
assert(src.includes('role="timer"'), 'Sleep timer has timer role');

// ── Device utilities ──
console.log('\n── Device utilities ──');
assert(src.includes('openWifiSettings'), 'WiFi settings function defined');
assert(!src.includes('intent:#Intent'), 'No intent: URL fallbacks (browsers refuse them; the APK goes through AndroidBridge)');
assert(src.includes('id="device-section"'), 'Device section exists in settings');

// ── Default streams ──
console.log('\n── Default streams ──');
assert(src.includes('PROFILE') && src.includes('streams'), 'Profile with default streams defined');
const streamUrlMatches = src.match(/url:\s*'([^']+)'/g) || [];
assert(streamUrlMatches.length >= 2, `At least 2 default streams (found: ${streamUrlMatches.length})`);

// ── PWA service-worker cache version ──
// Cache-first SW with no revalidation means a stale CACHE_VERSION leaves
// installed PWAs serving an old shell forever. Enforce it tracks the app
// version so a release that forgets to bump sw.js fails here, not in the field.
console.log('\n── PWA cache version ──');
const versionMatch = src.match(/id="settings-version"[^>]*>RadioGrid v([0-9]+\.[0-9]+\.[0-9]+)</);
assert(!!versionMatch, 'App version string present in settings footer');
if (versionMatch) {
  const appVersion = versionMatch[1];
  let sw = '';
  try { sw = readFileSync('sw.js', 'utf-8'); } catch (e) { /* asserted below */ }
  assert(sw.length > 0, 'sw.js readable');
  assert(sw.includes(`'rgxl-shell-${appVersion}'`),
    `sw.js CACHE_VERSION matches app version (v${appVersion})`);
}

// ── Results ──
console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.error('\nSome checks failed — review above.');
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}
