# RadioGrid's web home moves to radio.marshworks.dev

Status: shipped

Intent: The hosted radio gets its own address, radio.marshworks.dev, and every link and new install points there. A browser treats a new address as a new, empty radio, so nothing saved at marsh.city/radio carries over by itself. The few people using the old address were told it was still in testing, so the break is immediate: marsh.city/radio gets one last build that stops playing and says where the radio went, while still letting the person who set it up export their stations and carry them across.

## Done when: the new address works

- [test] The hosted build made for radio.marshworks.dev serves from the site root: the manifest's `start_url` and `scope`, the service worker's scope and the icon paths all resolve there, and the CSP meta tag and the content hash in the cache name are present as they are today.
- [test] The feedback page is published at `radio.marshworks.dev/feedback/`. The QR code and the address printed beside it in settings point there, and `tests/feedback.test.mjs` decodes the QR to that address. The feedback email address is unchanged.
- [test] The how-to guide opens inside the app from the new address. It is still the page on marsh.city, and the hosted CSP allows that frame and nothing wider.
- [test] Publishing is one deliberate local command, `npm run deploy:netlify`. It runs `npm test` first, refuses uncommitted build inputs, reads the Netlify token from the macOS Keychain (never from a file, an argument or the repo), and uploads only the built site. Pushing `main` publishes nothing, and no workflow in this repo holds a Netlify token.
- [test] Unhappy path: the publish step refuses to run when the build's own address (canonical address, feedback address, QR) is not radio.marshworks.dev, so a marsh.city build can't land on the new address or the other way round. It also refuses, with a plain message and no upload, when the Keychain item is missing.
- [test] `smoke-live.mjs` and the daily `live.yml` check radio.marshworks.dev.
- [smoke] After the deploy: radio.marshworks.dev loads over https with a valid certificate, `curl -sI http://radio.marshworks.dev` answers with a redirect to https, the response is compressed, the page installs to a phone's home screen, plays a station, and works offline on the second open.
- [manual] Jason: create the Netlify site, add its custom domain `radio.marshworks.dev`, and add the Squarespace CNAME `radio` → that site's `*.netlify.app` name. The apex, www and email records stay untouched.

## Done when: the old address says it has moved

- [test] The build made for marsh.city/radio, and only that build, shows "This radio has moved to radio.marshworks.dev. Please ask the person who set it up to change it." in place of the stations. The moved screen never shows at radio.marshworks.dev, in the iOS app, from `file://` (the Android APK) or in a branded profile's build.
- [test] Settings still opens from the moved screen, behind the PIN when one is set, and opens with a "This radio has moved" card above everything else: the new address as plain text and the steps (Export Backup here; open radio.marshworks.dev on this device; Import Backup there; add it to the home screen; remove this one). Export Backup is reachable from the card.
- [test] A backup exported at the old address imports at the new one with every station, setting and (when included) the PIN intact.
- [test] An installed radio at the old address picks up the moved build through the normal silent update: never while a station is playing or settings are open. A station already playing is never cut off; the moved screen appears the next time the radio is opened, and audio never resumes by itself.
- [test] It holds the promises: the moved screen makes no network request, opens no website or window (the address is text), nothing moves with Reduce Motion on, the screen and card meet contrast in every theme (7:1 in High Contrast), and a screen reader reads the moved line first without anything being spoken or chimed on its own. The new screens are in `walkEverything()`.
- [test] `rgxl_cfg`, `rgxl_pin`, `CFG_VERSION` and every saved key are untouched at both addresses.
- [smoke] marsh.city/radio on a phone with a radio saved before the update: the moved screen appears, and the settings card's steps move the radio to the new address with its stations.
- [manual] Jason: the moved screen reads calm, not alarming, at phone size in the dark and light themes.

## Done when: links point at the new address

- [test] The README, the guide's prose and the marsh.city project page send new people to radio.marshworks.dev. The project page gets an Updates entry for this version saying the address changed.
- [test] Every existing marsh.city URL keeps answering at the same address: `/radio/` (with the moved screen), `/radio/feedback/`, `/projects/radiogridxl/`, its `guide/`, and `/embed/guides/radiogridxl/`.

Ships as a minor, v7.25.0. The marsh.city copy only ever gets the moved build. `deploy:radio` still runs each release, because it also carries the guide and project page, which stay on marsh.city.

Decided 2026-11-17: a clean break. Nothing is carried across automatically; the person who set a radio up moves it with Export Backup and Import Backup.
Decided 2026-11-23: no three-month notice window. The web users were told it was in testing, so the old address shows the moved screen straight away. Hosting is a separate Netlify site, published from a local command, because Netlify tokens reach the whole account and this repo is public.

## Out of scope
- Removing the old copy from marsh.city. It stays up showing the moved screen until Jason takes it down.
- A one-tap move that carries the stations across in a link. It would have the radio open another address, which the promises rule out.
- Moving the guide, the project page or the feedback email address off marsh.city.
- Serving the CSP (with `frame-ancestors`) as a real response header through Netlify's `_headers`. Worth doing later; the meta tag stays for now.
- The frozen 7.8.1 Android APK: it runs the bundled file from `file://` and never loads either address. The future Android TWA, its `assetlinks.json`, and anything in the iOS app.
- Renaming internal identifiers: `RadioGridXL.html`, the `rgxl_*` keys, the `radiogridxl` URL slugs.
- `PROMISES.md`. Only Jason changes that file, and this work needs no change to it.
- Counting who still uses the old address. The app collects nothing, so nobody can know.
