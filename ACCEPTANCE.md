# Settings are visible by default

Status: approved

Intent: A new radio shows a Settings button in the header, so anyone setting one up can find settings without knowing a secret gesture (and App Review sees no hidden feature). Hiding settings behind five taps on the logo becomes a choice the setter-up makes. A radio that is already set up looks and works exactly as it did.

## Done when
- [test] A radio with nothing saved (`rgxl_cfg` absent) shows the header Settings button, and one tap opens settings (through the PIN pad when there's a PIN). Same on the website and in the iOS app.
- [test] A radio with a saved config keeps what it saved: `settingsButton: 'on'` shows the button, `'off'` hides it. A saved config with no `settingsButton` key (saved before v7.22.0) hides it. No schema version bump; no saved key is renamed or removed.
- [test] Unhappy path: a saved config that is corrupt, or holds an unknown `settingsButton` value, hides the button. A radio that has ever been saved never grows a button from bad data.
- [test] With the button hidden, five taps on the logo open settings as today. With the button showing, five taps on the logo do nothing.
- [test] Importing a backup with no `settingsButton` key leaves the button hidden; a backup with the key is honoured.
- [test] Reset to defaults ends with the button showing, like a new radio.
- [test] The switch stays "Show a Settings button". Its hint says why someone would hide it: "Turn off if the listener might open settings by mistake and change things. To open them then, tap the logo 5 times quickly." The PIN hint mentions the five taps only while the button is hidden.
- [test] The Settings button is not part of any preset, as today (`tests/access-switches.test.mjs`).
- [test] The guide opens settings with the button, covers hiding it and the five taps under locking the radio down, and `tests/guide.test.mjs` passes with retaken screenshots.
- [smoke] iPhone and iPad simulator, fresh install: the button shows in every theme at 3:1 or better, VoiceOver reads it as "Settings", and it opens settings in one tap.
- [smoke] marsh.city/radio on a phone that already has a saved radio: after the update, no button appears and five taps still open settings.

## Done when: hiding the button asks you to prove the way back in

Intent: Nobody hides the Settings button without having opened settings the other way once, so hiding it can't lock them out.

- [test] Turning "Show a Settings button" off opens a dialog. Until the practice is passed, the switch stays on and the header button stays showing.
- [test] The dialog says: "Hide the Settings button? To open settings again, tap the logo 5 times quickly. Try it now." It shows the logo. Five taps on it within two seconds show "Got it." and a Done button; Done closes the dialog with the switch off. Apply & Close then hides the button, as today.
- [test] Unhappy path: four taps, or five slow ones, pass nothing. Cancel, Escape, or settings closing by the idle timeout leave the switch on and the button showing.
- [test] The dialog says what to do instead: "Hard to do? Keep the button and set a PIN." under the logo.
- [test] Turning the switch on asks nothing. A radio that is already hidden (saved, imported, or from before the button existed) never sees the dialog.
- [test] It works by keyboard (Enter or Space five times on the logo), keeps focus inside, and returns focus to the switch. A screen reader hears the title and the instruction, and "Got it." once.
- [test] It holds the promises: nothing moves with Reduce Motion on, text meets contrast in every theme, and it is on the walk every promise check uses.
- [test] The guide's "Hide the Settings button" section describes the practice step, with a shot.
- [smoke] iPhone simulator, in the app: hide the button through the dialog, then open settings with five taps on the header logo.

## Done when: settings show the MarshWorks "made by" block

Intent: The radio's credit matches every other MarshWorks product: the words "Made by" above the full logo, copied in from the brand kit, and never a link.

- [test] The default build shows the kit's plain "made by" block under the version line in settings. A screen reader reads it once, as "Made by MarshWorks". It holds no link and nothing to tap.
- [test] The block is the kit's file, unchanged: a test fails if the copy in the app differs from the copy of the kit kept in the repo.
- [test] In the MonoRadio and High Contrast themes the credit is the plain text line "Made by MarshWorks" and no logo shows.
- [test] A profile that names another maker shows "Made by <maker>" as plain text, with markup shown as text. A branded build with no maker shows no credit.
- [test] No build says "MarshWorks LLC" in the credit. The copyright line and LICENSE keep the legal name.
- [test] It holds the promises: nothing leaves the device, nothing moves with Reduce Motion on, the radio opens no website, and text meets contrast in every theme.
- [test] The guide's settings shots are retaken and its version matches.
- [smoke] iPhone, in the app and on the website: the block shows in settings in the dark and light themes, and VoiceOver reads it once.

Decided at approval (2026-11-12): MonoRadio and High Contrast show the plain text line, not the logo. It ships as a patch, v7.23.1.

## Done when: the mark is the R alone, in one blue

Status of this section: shipped 2026-11-13 (v7.23.4). The home-screen icon was looked at on a phone. The iOS app icon was checked as a file, not in the simulator. The Android launcher icon went with the Android project.

Intent: The RadioGridXL mark is the tile R with nothing around it, every tile the same blue, everywhere it shows. The waves went muddy at small sizes (the 48 pixel tile on marshworks.dev), and the R reads on its own without the colour ramp. Decided 2026-11-13.

- [test] The default build's header shows ten tiles and no other shape. The hide-the-button dialog's copy of the logo and the lock-screen artwork follow it, and the artwork still carries its own colours.
- [test] The header mark's frame is tightened to the R (`logoViewBox` `25 25 50 50`), so the R is drawn about 32px wide where the old mark with waves was 34px. The inline profile and `profiles/default.json` stay equal.
- [test] Every tile is one blue: `#58c6f8` in the dark themes (10.0:1 on the header) and `#1367a8` in the light themes (5.0:1). One token, `--logo`, replaces the six `--logo-r*` ramp tokens, and the tiles lose their `logo-rN` classes. MonoRadio, High Contrast and Night keep the single colours they have today.
- [test] `icon.svg` is the R alone in `#58c6f8` on the dark square, larger than before, and every tile corner stays inside the maskable safe zone (radius 40 of 100).
- [test] `icon-192.png`, `icon-512.png` and the iOS app icon (1024px, no transparency) are drawn from `icon.svg` by one script, `make-icons.mjs`. A test checks their sizes and that the iOS icon is opaque. The iOS icon stops being the Capacitor placeholder.
- Dropped: the Android launcher icon. This repo has no Android project.
- [test] No wave or ramp is left behind: no `logo-wave` or `logo-r` class, rule or token in `src/`, and the contrast test measures the one tile colour, still at 3:1 on the header in every theme (4.5:1 in High Contrast).
- [test] Unhappy path: a profile with no logo still boots with an empty header mark and no lock-screen artwork.
- [test] The tab icon keeps its shape and whole-pixel grid and goes the same one blue: `#58c6f8` on a dark tab, `#1367a8` on a light tab.
- [test] It holds the promises: nothing leaves the device, nothing moves with Reduce Motion on, contrast holds in every theme.
- [test] The guide's screenshots and the project page's shots are retaken and the guide's version matches.
- [smoke] marsh.city/radio after the update: header, install icon and lock-screen artwork show the R alone.
- [manual] Jason: the installed icon on a phone's home screen, and the iOS app icon in the simulator, look right beside other apps.

Ships as a patch, v7.23.4.

## Out of scope
- Ripples, rings or any other decoration around the R (rejected 2026-11-13).
- Other R shapes, and the R standing in for the first letter of the word (both dropped 2026-11-13): the tile R stays beside the whole word.
- Any change to the logo's colour in MonoRadio, High Contrast or Night.
- A branded profile's logo and launcher icon.
- The splash screens, the wordmark, the RadioGrid rename.
- marshworks.dev's own copy of the icon (the brand repo's job).
- A reminder or demo after settings close. The radio stays quiet once it's in the listener's hands.
- Any way to recover a forgotten gesture or PIN.
- The first-run setup wizard (its own ACCEPTANCE, after watching a real setup).
- Branded builds and the old 7.8.1 WebView APK: nothing here builds them. The default lives in shared source, so a new branded build would show the button, behind its PIN (accepted 2026-11-11).
- Moving or restyling the Settings button.
- The RadioGrid rename.
- Any change to the PIN, its lockout or the idle timeout.
- The feedback address and email, which stay on marsh.city until the web-home decision.
- A loading screen.
- One-colour versions of the logo for MonoRadio and High Contrast.
