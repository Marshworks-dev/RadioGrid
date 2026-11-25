# Android app: RadioGrid as a Trusted Web Activity

Status: draft

Intent: RadioGrid gets an Android app, `dev.marshworks.radiogrid`, that is a thin wrapper around radio.marshworks.dev running in real Chrome (a Trusted Web Activity built with Bubblewrap). The pilot tablets need an app they can be locked to; the Play listing needs an APK. Chrome already gives the PWA background audio, lock-screen controls and http streams, so the wrapper adds nothing but a home-screen app with no URL bar. The web version stays the product: every web deploy is an app update, with no new app build.

## Done when: the app is the PWA, full screen

- [test] `twa/` holds the Bubblewrap project (`twa-manifest.json` plus the generated Gradle project), with package `dev.marshworks.radiogrid`, app name "RadioGrid", start URL `https://radio.marshworks.dev/`, and the icon, theme and background colours read from the hosted `manifest.json`. A test checks those fields against the manifest so they can't drift.
- [test] The hosted build serves `/.well-known/assetlinks.json` (content type `application/json`) naming `dev.marshworks.radiogrid` and the signing fingerprint(s). `deploy:netlify` refuses to deploy if the file is missing or the package name is wrong.
- [smoke] After the deploy, `https://radio.marshworks.dev/.well-known/assetlinks.json` returns 200 with the fingerprint, and Google's Digital Asset Links API confirms the link.
- [test] On droidrig the installed APK opens radio.marshworks.dev with no URL bar (Chrome shows a bar only when verification fails), plays a station, keeps playing with the screen off, and shows the media notification.
- [test] Unhappy path: in airplane mode after one online launch, the app opens and shows the stations (the PWA's service worker, as on the web). On a first launch with no network, it shows Chrome's offline page, not a crash.
- [test] TalkBack on droidrig reaches the station grid and reads a station's name, the same as the web version in Chrome.

## Done when: the signing key is safe and documented

- [manual] The upload keystore lives outside the repo, in Bitwarden (file plus password), with a second copy on the Ext-2TB. Nothing in `twa/` or git holds a keystore or password (`.gitignore` blocks `*.keystore` and `*.jks`).
- [test] A build script (`npm run build:android`) reads the keystore password from Keychain, builds a signed release APK and AAB, and prints the SHA-256 fingerprint that has to be in `assetlinks.json`.

## Done when: a tablet can be set up from the runbook

- [manual] `ops/RUNBOOKS/radiogrid-provision-client-tablet.md` (workspace repo) covers the steps: install the APK over adb, set the app as device owner, lock the tablet to RadioGrid, and how to get out of that lock.
- [manual] Jason: one real tablet set up from the runbook alone, opening to RadioGrid after a reboot.

## Out of scope
- Play submission: the Play org account ($25), listing, privacy policy, Data Safety form and content rating. Next on the list, separate work. When Play App Signing is on, its key's fingerprint gets added to `assetlinks.json` then.
- Moving radios from marsh.city/radio. A new tablet starts empty, which is fine for the pilot.
- Native features (haptics, a foreground service). Chrome covers audio; revisit only if the tablet check finds a gap.
- The iOS app (blocked on the Apple account) and the frozen WebView APK in RadioGridXL (`com.radiogridxl.app`, untouched).
- Any change to the PWA itself, or to `PROMISES.md`. The app adds no network calls of its own; it is Chrome showing the same site.

Ships with the next minor version; the web version doesn't change.
