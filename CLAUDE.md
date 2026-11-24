# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RadioGrid is a radio for people who can't run a normal app: someone sets it up once, and the listener gets up to eight big station buttons and Stop. The app ships as one file, `RadioGridXL.html` — vanilla HTML, CSS, and JavaScript with zero external dependencies — built from the source in `src/`. Shipped as a hosted PWA (radio.marshworks.dev; the old marsh.city/radio shows a moved screen); store apps (Android TWA, iOS Capacitor) are next. Plans, runbooks and branded profiles are private and live outside this public repo: `~/JasonsWorkspace/ops/radiogrid/` (`ROADMAP.md`, `profiles/`, `docs/`) and `~/JasonsWorkspace/ops/RUNBOOKS/radiogrid-*.md`. Never copy them, or the PIN, name or stations of a branded profile, into this repo.

## Development

- **Edit `src/`, never `RadioGridXL.html`.** `RadioGridXL.html` is built output, committed so every tool and the APK can keep reading it by path. Edit `src/`, run `npm run build`, commit both. `tests/build-sync.test.mjs` fails `npm test` when the two differ: a hand edit to the built file, or a `src/` edit without a rebuild
- **No bundler**: `build.mjs` only concatenates files, and the built file still opens directly in a browser
- **The shipped `RadioGridXL.html` has zero runtime dependencies** — it stays
  fully self-contained. Tooling below is dev-only and never ships.
- **Tests** (`npm test` runs both tiers):
  - `node smoke-test.mjs` — static structure / security-invariant / self-containment checks (no npm deps)
  - **Promises**: `PROMISES.md` lists what the app promises its users; each line names its check. `tests/promises.test.mjs` runs every check against a throwaway copy with each breaker in `tests/promise-breakers.mjs` applied, and fails if any breaker gets through. The Chromium checks (`promise-no-egress`, `promise-reduced-motion`, the rendered half of `contrast`) share one walk of every screen, `walkEverything()` in `tests/browser-harness.mjs`: a new screen or dialog goes there. They need `npx playwright install chromium` and the sandbox off
  - `npm run test:dom` — behavioral tests (`node:test` + jsdom) for the persistence / validation / PIN logic, run against the real app in a DOM. Dev dependencies: jsdom (tests) and Playwright (guide screenshots, and the real-Chromium promise checks). jsdom has no layout engine, so `tests/layout.test.mjs` checks `renderButtons`' sizing arithmetic on stubbed element sizes only; how text actually wraps and clips is verified on a real screen.
- **Scheduled checks** (GitHub Actions, read-only, failures email): `live.yml` runs `smoke-live.mjs` against radio.marshworks.dev daily; `shelves.yml` runs `check-shelves.mjs` on Mondays. Node is pinned in `.nvmrc` for CI and local runs alike; the smoke test fails on a mismatch, so after a Node upgrade bump `.nvmrc`
- **Version**: v7.24.1 (shown in settings footer, `#settings-version` in `src/shell.html`)

## Architecture

The app itself is one self-contained HTML file (`RadioGridXL.html`) structured as embedded CSS, a semantic HTML body, and a single inline vanilla-JS `<script>` (no frameworks). This single file is what the Android APK ships (`file://`).

The source in `src/`: `shell.html` (the page and markup, with `<!-- @styles -->` and `<!-- @script -->` marker lines), `styles/*.css` and `app/*.js`, one file per section, joined in filename order. It's plain concatenation, not ES modules. The script stays one classic `<script>` with shared globals, because the inline `onclick` handlers, the tests (`w.playStream()`) and the `file://` APK all depend on them. A new file takes a number prefix for its place in the order.

When **hosted** over http(s), a set of PWA sidecar files make it installable: `manifest.json`, `sw.js` (app-shell service worker), and icons (`icon.svg`, `icon-192.png`, `icon-512.png`). These are hosting-only — they require an http(s) origin and are inert on `file://`, so the shipped APK stays a single self-contained file. `server.js` serves them with correct content types (`sw.js` no-cache). The smoke test enforces the single-`<script>` / no-external-resource self-containment of `RadioGridXL.html` itself, so the service worker is registered **inline** and the manifest link is **relative**.

### Key Subsystems

- **Playback**: `playStream()`, `stopPlayback()`, `skipBack()`, `skipFwd()` — uses HTML5 `<audio>` element. A lost connection (an error, a live station's server hanging up, or 20 s with no playback progress, the stall check) reads "Reconnecting…" and retries quietly with a fade-in (`connectionLost()`); 4 losses without a full minute of play in between, then the station greys out and the app says it's not available (on screen only, with no chime, voice or buzz, while the sleep timer runs); the no-network overlay is for being offline). **Paused or stopped audio never restarts on its own** — not on Wi-Fi returning, a retry timer, or an error arriving while paused (a radio paused at bedtime must stay silent). `tests/playback.test.mjs` guards this on a spec-shaped fake media element (`tests/playback-fakes.mjs`); when a real browser disagrees with the fake, teach the fake (see its Chromium pause-after-failure note)
- **Configuration**: persisted to LocalStorage as JSON under key `rgxl_cfg`; supports up to 8 streams, each with id/label/description/URL/emoji/color (and optional `gain`). `loadSettings()` and the import path share one `validateConfig()` allowlist
- **Theme system**: 8 per-stream colors (blue, green, purple, teal, red, amber, slate, rose) × themes dark/light/auto + mono-dark/mono-light/mono-auto + contrast-dark/contrast-light/contrast-auto + night, driven by CSS custom properties. MonoRadio, High Contrast and Night ignore station colours (`html[class*="theme-mono"]` / `theme-contrast` / `html.theme-night` rules); High Contrast holds text to 7:1 and marks to 4.5:1 in the same test, and Night is held to no blue channel above red or green. `tests/contrast.test.mjs` reads `PALETTE` and the theme tokens from the HTML and holds every colour × theme × button state, and the small overlay and settings text it lists, to WCAG AA (text 4.5:1, the playing/paused rings and marks 3:1); its rendered half, `tests/contrast-rendered.mjs`, measures every visible text node on the painted page in Chromium across every theme, size and screen shape. Accent-coloured small text uses `--accent-text` and errors use `--danger`: the light themes set darker values for both. The default header logo (a tile R in one blue: `.logo-tile`, the `--logo` token) recolours per theme and is held to 3:1 on the header in the same test. The tab favicon is the same R, inline as a data: URI; `icon.svg` carries it inside the maskable safe zone. `node make-icons.mjs` (Playwright, sandbox off) draws every PNG icon from `icon.svg`: the PWA's two, and the iOS app icon. `tests/logo.test.mjs` reads the PNGs' pixels and fails on a stale one, so rerun it if the mark changes
- **PIN protection**: settings access optionally requires a PIN (stored in LocalStorage key `rgxl_pin`); opened by the header's Settings button (`cfg.settingsButton`, on for a new radio), or by 5 taps on the logo only while that button is off (both go through `requestSettings()`). Turning the button off in settings first opens `#hide-overlay`, and the switch goes off only after five quick taps on the logo there (`openHidePractice()`), so hiding it can't lock anyone out. A radio with a saved `rgxl_cfg` never gains the button by default: `loadSettings()` and the import path read a missing or bad value as off (`tests/access-switches.test.mjs`). If PIN is empty, settings open directly without the PIN overlay.
- **Pinch-zoom** (`cfg.zoom`, off by default): `applyAccessOptions()` rewrites the viewport meta live; it runs from `applyTheme()`, which every load / apply / revert / import / reset path calls. Neither switch is in `PRESET_FIELDS` (`tests/access-switches.test.mjs`)
- **Idle timeout** (`IDLE TIMEOUT` block): settings left 3 min untouched show "Still setting up?"; 30 s more and they close as Close → Discard does. The PIN pad closes after 1 min. Closing never touches the radio's stream, moves focus or speaks (`tests/idle-timeout.test.mjs`); taps inside the guide's frame don't count as input
- **PWA / service worker**: feature-detected install (manifest + inline SW registration guarded by `serviceWorker in navigator && http(s)`); no-ops on `file://` and the bare WebView. App shell cached for offline; cross-origin streams always hit the network. Open apps pick up a new version without a relaunch (update check on return + every 6 h, silent reload only when nothing is playing and no settings, PIN pad or other overlay is open; an update reload never auto-resumes). `tests/sw.test.mjs` runs `sw.js` in `node:vm` with fake caches/network and covers the page side
- **MediaSession**: feature-detected (`'mediaSession' in navigator`) lock-screen/notification metadata + transport handlers mapped to existing playback functions, plus audio-focus/interruption reconciliation. No-ops in the WebView APK
- **Backup / restore**: `buildBackupPayload()` → JSON export (PIN opt-in only); import runs the untrusted file through `validateConfig()` (no mass assignment) before applying. In the iOS app a blob download and the file input do nothing, so `nativeBackup()` hands off to `ios/App/App/BackupPlugin.swift` (share sheet to save, Files picker to open, registered in `MainViewController`); both import paths end in `importBackupText()`. The Android APK still hides the section
- **Auto-resume** (opt-in `cfg.resume`): the playing station's id stored in top-level `rgxl_last` (cleared on stop, pause, an update reload or a launch with Resume off; kept when autoplay is blocked); `maybeAutoResume()` starts it on launch if it still exists, with a "tap to resume" fallback when autoplay is blocked
- **Loudness leveling**: per-stream `gain` trim (set in the stream editor) applied via `targetVolume()` by scaling `audio.volume`. CORS-immune. A global Web Audio `DynamicsCompressorNode` was tried and **removed** — `MediaElementAudioSourceNode` silences cross-origin streams with no CORS headers (most internet radio), with no thrown error to fall back on (confirmed on-device 2026-05-28)
- **Accessibility presets**: data-driven `PRESETS` (Standard / Low Vision / Simplest) bundling display/interaction settings; `cfg.preset` is derived-not-trusted (self-corrects to `custom`)
- **How-to guide**: `guide/guide.md` is the public guide (published to `marsh.city/projects/radiogridxl/guide/` by the sync script). Every screenshot comes from a scene in `guide/scenes.mjs` (plain-data steps). `tests/guide.test.mjs` replays each scene in jsdom, so **renaming or removing a control the guide uses fails `npm test`**: update the scene *and* the guide prose together. After any version bump or UI change, run `npm run guide:capture` (Playwright + `cwebp`, needs the sandbox off) and look the shots over; the test fails until the guide's `appVersion` matches `package.json`. The same run retakes the marsh.city project page's screenshots (`PAGE_SHOTS` in `guide/scenes.mjs` → `guide/page/*.webp`); shots are webp, at most 1600px wide, to keep the site's pages light. The sync refuses to deploy while the project page has no Updates entry for a minor or major version going out (patches need none: each entry is a public claim), or shows a screenshot no `PAGE_SHOTS` entry makes. In-app, settings shows "How to use this app" only when hosted over http(s) and `PROFILE.helpUrl` is set (the default profile; a branded one may leave it out). It opens the marsh.city embed page in an empty-sandbox iframe overlay, created on tap and dropped on close
- **Feedback card**: `PROFILE.feedback` (default on, off unless a profile sets it; hosted http(s) only, since the APK WebView drops https/mailto taps) shows a QR code to `feedback/index.html` (the address and email beside it are plain text, never links: `promise-stays-radio`), a static page published beside the app (`radio.marshworks.dev/feedback/`, and the old `marsh.city/radio/feedback/`). The QR is an inline SVG between sentinels, drawn into `src/shell.html` by `node make-feedback-qr.mjs` (dev-only `qrcode-generator`), which then rebuilds; `tests/feedback.test.mjs` decodes it with `jsqr` and fails if it drifts from the generator. `sw.js` passes `feedback/` straight to the network, so the page is never cached or answered with the app shell. The app sends nothing
- **Sleep timer**: configurable durations (15/30/60/120/240 min), shown in advanced transport mode. Its countdown is not a live region (a swipe reads the minutes left); setting or cancelling it is confirmed once to screen readers, and its ending speaks no live region and moves no focus (`tests/screen-reader.test.mjs`)
- **Stream browser**: opens on starter shelves (`SHELVES` in `src/app/16-stream-browser.js`, a plain-JSON block between sentinel comments so `check-shelves.mjs` can read it from the built file); a search or a country → region pick goes to the Radio Browser directory (mirror failover, 8 s timeouts). Results fold repeats into one entry, drop stations failing the directory's check and mark ones already on the radio "Added". Directory data is untrusted: rows are built with DOM APIs, never inline handlers. Before a release, `npm run check:shelves` plays every shelf station (network, so not in `npm test`); swap out any that fail
- **Wake Lock**: uses Screen Wake Lock API to prevent display sleep during playback
- **Platform detection**: adapts UI for Android/iOS/Desktop (e.g., volume slider desktop-only, haptic feedback mobile-only)

### Transport Modes

- **Simple**: full-width Stop button only
- **Advanced**: skip back/forward, stop, sleep timer controls

### Security

- XSS prevention via `escHtml()` (DOM-based) and `escAttr()` (regex, full entity escaping) for all user-provided stream data including emoji
- Stream URLs validated to `http(s)://` only — rejects `javascript:`, `data:`, etc.
- PIN-protected settings panel with lockout after 5 failed attempts (escalating delay, max 30s)
- LocalStorage config validated against allowlists on load — corrupt/tampered values fall back to defaults

## Profiles

Branding (org name, PIN, default streams) is defined in a `PROFILE` config block at the top of the `<script>` section (`src/app/01-platform-profile-state.js`), bounded by sentinel comments. `build-profile.mjs` swaps it in the built file. The repo default is generic RadioGrid branding.

- **Profile JSON files**: only `profiles/default.json` ships. Branded profiles live in `~/JasonsWorkspace/ops/radiogrid/profiles/`; tests use the `tests/fixtures/example-org.json` fixture (a PIN, no guide, no feedback card, no maker) for branded behaviour
- **Build script**: `node build-profile.mjs [name | path.json]` reads a profile, swaps the `PROFILE` block, outputs to `dist/RadioGridXL.html`
- **Docker**: serves the root `RadioGridXL.html` as-is (always generic default)

A profile is a JSON file with `orgName`, `pin` (empty string to disable), and `streams[]`. Optional `madeBy` puts "Made by <maker>" under the version in settings (default: MarshWorks; a branded profile may name none, so its build credits no one). When the maker is MarshWorks, the brand kit's "made by" block (the words above the logo) shows in place of the line, except in MonoRadio and High Contrast, which keep the line (`showCredit()`). The block is the kit's plain version, never a link; it lives in `brand/` as it came and is written into `src/` between sentinels by `node sync-brand.mjs ../marshworks-brand`, never by hand (`tests/credit.test.mjs` fails on drift). `build-profile.mjs` refuses a profile that would ship broken (the app trusts `PROFILE`): a PIN that isn't a 4-digit string or `""`, 0 or more than 8 streams, duplicate ids, non-http(s) URLs, unknown keys or colours, or `</script`/`<!--` in any value (`tests/build-profile.test.mjs`).

## Deployment

Single `.html` file copied to the device and opened in a kiosk browser app. Audio stream URLs must be accessible from the device's network. Targets modern browsers (ES6+, CSS Grid, Flexbox, LocalStorage). Also served via Docker on port 3900 for dashboard access.

**Hosted at `radio.marshworks.dev`**, a Netlify site that is **not** connected to this repo: pushing publishes nothing. `npm run deploy:netlify` (`deploy-radio-to-netlify.mjs`) is the one way to publish. It refuses uncommitted build inputs, reads the Netlify token from the macOS Keychain (item `netlify-site-marshworks.dev`; never a file, CI or this repo, because the token reaches the whole Netlify account and this repo is public), runs `npm test`, refuses a build whose addresses aren't radio.marshworks.dev or that is the moved build, refuses if any file holds the token, then uploads one zip deploy and waits until it's live. Run it from Jason's terminal (`! npm run deploy:netlify`): it needs the Keychain and the sandbox off for the Chromium tests.

**The old address, `marsh.city/radio`**, is a copy in the separate marsh.city GitHub Pages repo (`public/radio/`), and it only ever gets the moved build (`hostedFiles(repo, { moved: true })`, which adds the `radiogrid-moved` meta tag; `src/app/24-moved.js` then shows where the radio went, plays nothing, and keeps settings and Export Backup reachable). The same sync carries the guide and project page, which stay on marsh.city, so it still runs each release after `deploy:netlify`: `npm run sync:radio` (dry run + diff) then `npm run deploy:radio` (commit + push → Pages). See `~/JasonsWorkspace/ops/RUNBOOKS/radiogrid-deploy-radio-to-marshcity.md`.

## Breaking Change Guard — User Config Compatibility

Deployed devices store user configuration in LocalStorage (`rgxl_cfg` and `rgxl_pin`). App updates must not silently break existing users' saved settings. The following changes are **breaking** and require explicit migration handling before proceeding:

- **Renaming a config key** (e.g. `advanced` → `controls`) — old saved value becomes invisible, setting resets to default
- **Renaming or changing the LocalStorage key names** (`rgxl_cfg`, `rgxl_pin`)
- **Changing the stream object shape** (e.g. renaming `sub` → `description`, changing `id` format)
- **Removing a valid value from an allowlist** (e.g. dropping a theme option that users may have selected)
- **Changing the PIN length or format** — existing saved PINs could fail validation

**Safe changes** (no migration needed): adding new config keys (they default gracefully), adding new allowlist values, adding new optional stream fields, changing PROFILE defaults (only affects users who never customized).

**If a breaking change is needed:** stop and discuss with the user first. `rgxl_cfg` and backups carry a schema version `v` (`CFG_VERSION`); bump it and branch on it in `validateConfig()` to transform old configs. Already in place for that day: a version that finds a newer `v` in storage loads what it understands but never saves over it, and import refuses a newer backup (the APK lags the PWA, and backups are how config moves between them).

## Maintenance

- **Keep `README.md` in sync** — when features, deployment steps, or version number change, update the README to match.
