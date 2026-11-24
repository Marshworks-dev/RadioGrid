# RadioGrid

A radio for people who can't run a normal app: someone sets it up once, and the listener gets up to eight big station buttons and Stop. Runs as an installable web app at [radio.marshworks.dev](https://radio.marshworks.dev/), or as one file opened in any modern browser. Zero external dependencies — vanilla HTML, CSS, and JavaScript in one self-contained file.

## Features

- **Up to 8 configurable streams** with custom labels, descriptions, emoji icons, and color themes
- **8 stream colors** (blue, green, purple, teal, red, amber, slate, rose), per stream
- **Themes** — dark / light / auto (follows the OS, including its increase-contrast setting, which turns any Auto theme High Contrast), a quiet greyscale MonoRadio (dark / light / auto), and High Contrast (dark / light / auto): black, white and yellow, text at 7:1 (WCAG AAA), a playing station filled solid yellow; and Night, for a radio by the bed: black and dim amber with no blue, text just over AA
- **Stream browser** — opens on starter shelves of hand-picked stations (Calm & easy, Oldies, Classical, Jazz, News & talk, Sleep), or search the Radio Browser directory (radio-browser.info) by name, country, state or region, and genre; add several stations in one visit, one tap each. Repeats of one station show once, stations failing the directory's check are left out, and ones already on the radio say Added (searches need network; the shelves and the rest of the app don't)
- **Spoken + audible feedback** — optional text-to-speech announcements (Web Speech API) and play/pause chimes
- **PIN-protected settings** — all configuration can sit behind a PIN, asked for whenever settings are opened
- **Configurable organization name** — header text editable in settings, supports two lines
- **Installable PWA** — when hosted over http(s), Chrome/Android offers "Add to Home Screen"; the app shell is cached by a service worker so it loads offline (only streams need the network). Degrades to a normal page on `file://` and in the WebView APK.
- **Lock-screen / background audio** — MediaSession controls (play/pause/stop, plus skip for streams with a length; live radio gets none) and metadata appear on the lock screen and notification shade in browsers that support it; audio survives screen lock, and a call/interruption pauses then resumes. Feature-detected — no-ops where unsupported.
- **Accessibility presets** — one-tap built-in presets (Standard, Low Vision, Simplest) that bundle theme, font size, transport mode, and feedback settings; individual controls remain adjustable afterward. Low Vision uses High Contrast Dark at Ultra text size.
- **Works by voice** — every button that shows a word is named by that word (skip and sleep show Back 15, Skip 30 and Sleep), so iOS/macOS Voice Control, Voice Access or Dragon can press it by voice. A station is named by the station alone ("Tap Jazz 88"), with playing shown as the button being on and the description read after it. The guide leads with numbers (Voice Control's Item Numbers overlay), which work for every button. The stream editor warns when two stations share a name or one is named like a button. A Chromium test holds every button's name to its visible text.
- **Loudness leveling** — an optional per-stream volume trim so a quiet and a loud station sit closer in volume. (A global Web Audio compressor was tried and removed — it silences cross-origin streams that send no CORS headers, which is most internet radio. The per-stream trim is CORS-immune.)
- **Auto-resume last station** (opt-in) — relaunch restarts the station only if it was playing when the app closed; a paused or stopped radio stays off. Off by default.
- **Allow pinch to zoom** (opt-in) — frees the page's viewport for people who zoom in to read; off by default so an accidental pinch can't leave the radio zoomed in.
- **Show a Settings button** (on for a new radio) — a visible Settings button in the header opens settings in one tap (through the PIN pad when there is a PIN). Turn it off to hide settings from the listener; five quick taps on the logo open them then, and only then. A radio saved before the button existed keeps it hidden.
- **How-to guide** — a step-by-step guide with screenshots at [marsh.city/projects/radiogridxl/guide](https://marsh.city/projects/radiogridxl/guide/), also opened from settings ("How to use this app") in the hosted build. Its steps run as tests, so it can't silently drift from the UI.
- **Feedback QR** — settings shows a QR code the person setting up can scan with their own phone. It opens a static page, [radio.marshworks.dev/feedback](https://radio.marshworks.dev/feedback/), with an Email us button; the address and radio@marsh.city are shown as plain text too. Nothing on the radio is a link, so a tap can't open a website or the mail app. The app sends nothing (hosted default build only).
- **Credit** — settings show the MarshWorks "made by" block under the version: the words "Made by" above the logo, never a link. MonoRadio and High Contrast show the plain line "Made by MarshWorks" instead (profile field `madeBy`; a branded build can name another maker, or none). The block is copied in from the brand kit by `node sync-brand.mjs ../marshworks-brand` and kept in `brand/`.
- **Config backup / restore** — export all settings and streams to a JSON file and import them on this or another device (PIN included only if you opt in). Hosted (http/https) only: the Android APK and the iOS shell can't save or open files yet, so the section is hidden there.
- **Sleep timer** — 15, 30, 60, 120, or 240 minute auto-shutoff
- **Moved from marsh.city/radio** — the radio's old address now shows where it went (radio.marshworks.dev) instead of its stations, and plays nothing. Settings there still open, with the steps to carry a radio across: Export Backup at the old address, Import Backup at the new one. A browser keeps each address's saved stations apart, so nothing moves by itself.
- **Settings close themselves** — after 3 minutes untouched, a "Still setting up?" prompt; no answer in 30 seconds and settings close to the stations, dropping unsaved edits. The PIN pad closes after a minute. Playback is never touched
- **Wake Lock** — prevents display sleep during playback
- **Platform-adaptive UI** — volume slider on desktop, haptic feedback on Android (iOS Safari has no web vibration, so there the setting is greyed out with the reason)
- **Responsive grid layout** — adapts from stacked list (1–3 streams) to 2-column grid (4+), with a full-width primary stream for odd counts
- **Grouped settings** — one panel in four groups (Stations, Look, Sound and controls, Setup): each station a row that opens in place, switches for on/off settings, theme swatches, and Apply pinned in reach on any screen size. Changes animate so you can see what moved, and stay still with Reduce Motion on.
- **Live settings preview** — stream edits and theme changes are visible in real time; cancel reverts to previous state. On a phone, where the panel covers the grid, the Preview button slides settings aside to show the full-size grid until "Back to settings"
- **WiFi setup shortcut** — opens Android OS WiFi settings directly from the settings panel (Android only)
- **Live Caption shortcut** — opens Android Accessibility settings, where Live Caption lives (Android 10+)
- **Force landscape** — rotate the UI clockwise or counter-clockwise for tablets an MDM has locked to portrait

## Stream content

RadioGrid doesn't host, choose or control any stream content. Every station is run by its own broadcaster.


## Deployment

### On a device (standalone)

1. Copy `RadioGridXL.html` to the device
2. Open it in any modern browser or kiosk browser app
3. Configure streams and appearance via the PIN-protected settings panel

No package manager or server required: the built file is all a device needs. Audio stream URLs must be accessible from the device's network.

> **Self-containment note:** the single-file `RadioGridXL.html` stays fully self-contained, so it also works from `file://`. The PWA pieces (`manifest.json`, `sw.js`, `icon.svg`, `icon-192.png`, `icon-512.png`) are **hosting-only** sidecars — they require an http(s) origin and are inert on `file://`.

### Install as a PWA (hosted)

When RadioGrid is served over http(s) (e.g. `radio.marshworks.dev` or the Docker server below), it is installable:

1. Open the URL in Chrome on the Android tablet
2. Use the browser menu → **Add to Home Screen** (Chrome may also prompt automatically)
3. Launch from the home-screen icon — it opens standalone (no browser chrome)

The service worker caches the app shell on first load, so the kiosk keeps working if the host is briefly unreachable. Updating the hosted files (and bumping `sw.js`'s cache name) reaches open apps on its own: the app checks for a new version when it comes back on screen and every 6 hours, then reloads into it silently once nothing is playing and settings, the PIN pad and any other overlay are closed. An update reload never auto-resumes playback.

### Self-hosting with Docker

```bash
docker compose up -d --build
```

Available at `http://<host>:3900`.

- `RadioGridXL.html` and the PWA assets (`manifest.json`, `sw.js`, `icon.svg`, `icon-192.png`, `icon-512.png`) are **volume-mounted** — a `npm run build` (or an asset edit) is live instantly, no container rebuild needed
- The server serves those assets with correct content types (and `sw.js` with no-cache headers so updates propagate); all other paths return the HTML
- `restart: unless-stopped` keeps it running across reboots
- `server.js` and the PWA assets are baked into the image (the assets are also mounted, so the mounts win); the HTML is mount-only, never baked in. The container runs as the unprivileged `node` user
- If you change `server.js` or `Dockerfile`, rebuild with `docker compose up -d --build`

## Profiles

A profile sets the radio's starting point: the name in the header, an optional PIN, the logo and the default stations. The repo ships one, `profiles/default.json`: generic RadioGrid branding, no PIN, sample streams (Radio Paradise, YourClassical Relax). An organisation's own profile stays with that organisation, outside the repo.

```bash
# Build with the default profile → dist/RadioGridXL.html
node build-profile.mjs

# Build with a profile kept elsewhere
node build-profile.mjs path/to/my-org.json
```

A profile defines `orgName`, `pin` (a 4-digit string, or `""` for none) and `streams[]` (1 to 8), plus optional `logoSvg`, `logoViewBox`, `helpUrl`, `feedback`, `madeBy` and `orientation`. `build-profile.mjs` refuses one that would ship broken.

`RadioGridXL.html` contains a `PROFILE` config block bounded by sentinel comments (its source is `src/app/01-platform-profile-state.js`). The build script reads a profile JSON, swaps that block, and writes to `dist/`. The root HTML file always has the generic default and is what Docker serves.

## Releasing a version

Edit the source in `src/`, then `npm run build` to rebuild `RadioGridXL.html` (never edit the built file: `npm test` fails if it differs from `src/`). Then bump these together (the smoke test enforces the `RadioGridXL.html` ↔ `sw.js` pair):

| File | What to change |
|------|---------------|
| `src/shell.html` | Update the version string in `#settings-version` near the bottom, then `npm run build` |
| `sw.js` | Update `CACHE_VERSION` to `rgxl-shell-<version>` — **required for hosted PWA updates to reach installed devices** (cache-first SW; a stale value serves the old shell forever) |
| `package.json` | Update `"version"` |
| `CLAUDE.md` | Update the Version line in the Development section |

After a bump, `npm test` fails until the how-to guide is recaptured: run `npm run guide:capture` and look over `guide/shots/` and `guide/page/` (the project page's screenshots). It needs `cwebp` (`brew install webp`).

---
---

## Development

```bash
# Edit src/, then rebuild the single file (plain concatenation, no bundler)
npm run build

# Open directly in a browser
open RadioGridXL.html

# Tests (Node.js 22.22.2+ or 24.15.0+ — jsdom 30's engines floor). The shipped HTML stays zero-dependency; jsdom is a
# dev-only dependency used by the behavioral tests.
npm install          # once, to fetch jsdom
npm test             # smoke (static, no deps) + jsdom behavioral tests
node smoke-test.mjs  # smoke tests alone — still runs with no npm deps
npm run guide:capture  # retake the guide's and project page's screenshots (headless Chromium, cwebp)
npm run check:shelves  # play the start of every starter-shelf station (network; run before a release)
```

## License

Copyright © 2026 MarshWorks LLC.

RadioGrid is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License, version 3, as published by the Free Software Foundation. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See `LICENSE` for the full text.

The RadioGrid, RadioGridXL and MarshWorks names and logos, including the made-by block in `brand/`, are not covered by the license. A fork is welcome; give it its own name and mark.

Development tools listed in `package.json` keep their own licenses and are not part of the app. Internet radio stations played by the app belong to their broadcasters.

## Contributing

Issues are welcome: bugs, stations that stopped working, anything confusing. Code pull requests aren't accepted for now.

## Version

v7.23.8
