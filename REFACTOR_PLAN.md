# Refactor plan: split the source, build the single file

Status: done 2026-11-10. Item 3 of the
2026-11-09 review.

## Why

`RadioGridXL.html` is 8.5k lines: about 2.7k of CSS, 470 of markup and 5.3k
of script, up from 3.9k lines in May. The setup wizard and the store work
would add more. Finding things, reviewing a diff and giving an agent the
right slice all get harder as one file grows. What the split buys: one job
per file, smaller diffs, and module-sized context.

## The one rule: the shipped file doesn't change

`RadioGridXL.html` stays in the repo as the **built, committed output**. Ten
consumers read it by path: the test harness, smoke test, promise breakers,
build-profile (→ APK and dist), hosted-build/sync (→ marsh.city), server.js
and Docker, the guide capture, check-shelves and make-feedback-qr. All of
them keep working untouched. The app still runs by opening that one file.

Tradeoff: the source of truth moves to `src/`, so editing
`RadioGridXL.html` by hand is now a mistake. A test catches it (below).
We avoid the alternative, a generated file that isn't committed, because
that would rewire all ten consumers at once.

## Shape

```
src/
  styles/      tokens-themes.css, shell-header.css, buttons.css,
               transport.css, overlays.css, settings.css, editor.css, misc.css
  shell.html   the page and markup, with <!-- @styles --> and <!-- @script --> marker lines
  app/         01-platform-palette.js … NN-boot-sw.js, one per section
               banner group (PERSISTENCE, THEME, RENDERING, PLAYBACK,
               MEDIA SESSION, AUDIO EVENTS, OVERLAYS, TTS/HAPTICS, SLEEP/
               WAKE/VOLUME, SETTINGS, PRESETS UI, STREAM EDITOR, STREAM
               BROWSER, GUIDE/FEEDBACK, EMOJI, APPLY, BACKUP, RESET/IDLE,
               PIN, UPDATES, BOOT/SW)
build.mjs      concatenates in filename order → RadioGridXL.html
               --check: exits 1 if the committed file differs from a fresh build
```

**Plain concatenation, not ES modules.** The script stays one classic
inline `<script>` with shared globals, which is what makes this
behaviour-neutral. Inline `onclick` handlers (92 of them), tests calling
`w.playStream()` and `w.eval('PRESET_FIELDS')`, and the `file://` APK all
depend on globals. Real modules can come later, if ever, as their own
change.

Sentinel blocks stay whole inside one file each: PROFILE in
`app/01-platform-profile-state.js`, SHELVES in `app/16-stream-browser.js`,
the feedback QR in `shell.html`.

## Proof it's behaviour-neutral

Step 1's acceptance is **byte-identical output**: `node build.mjs` must
reproduce today's `RadioGridXL.html` exactly (`cmp` clean), before any
file is touched by hand. That's a stronger guarantee than tests, and it
holds for every step that only moves code.

## Steps (one commit each, full `npm test` green before the next)

1. ✅ (2026-11-10) `build.mjs` plus a mechanical splitter (a one-off script, not kept)
   that cuts at the section banners. Output is byte-identical. Commit
   `src/`, `build.mjs` and an unchanged `RadioGridXL.html`.
2. ✅ (2026-11-10) Guard: `tests/build-sync.test.mjs` runs `build.mjs --check`, so a
   hand edit to `RadioGridXL.html`, or a `src/` edit without a rebuild,
   fails `npm test` and CI. Add `npm run build`.
3. ✅ (2026-11-10) Point `make-feedback-qr.mjs` at `src/shell.html` and rebuild. It's the
   only tool that writes into the app file. check-shelves and
   build-profile keep reading the built file.
4. ✅ (2026-11-10) Docs: CLAUDE.md (Development: "edit `src/`, run `npm run build`, commit
   both"; Architecture), README, and the runbooks that mention editing the
   HTML.
5. ✅ (2026-11-10) Tidy only where a cut left a section misfiled: move code between files
   with no edits. The output is no longer byte-identical but stays
   functionally identical, so the full suite plus a promise run is the
   check.

## Out of scope (separate changes, later)

- Moving the 92 inline handlers to listeners. Once that's done, the
  hosted CSP can drop `script-src 'unsafe-inline'` for a sha256 hash of the
  one script, which `hosted-build.mjs` can compute.
- ES modules, a bundler, minification, TypeScript.
- Any behaviour, style or wording change.
- The iOS spike branch: rebase it after step 4, since it copies the built
  file.

## Risks

- **Another session edits `RadioGridXL.html` mid-split.** Do the split
  while no other RadioGridXL session is open. After that, the build-sync
  test catches stale hand edits.
- **Merge pain for open branches.** Branches touching the HTML (the iOS
  spike) rebase onto `src/`. Check `git branch -a` first; only the spike
  is live.
- **Agents editing the built file out of habit.** CLAUDE.md says it
  first, and the guard test fails loudly with "edit src/, then npm run
  build".
