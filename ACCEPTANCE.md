# The app calls itself RadioGrid

Status: shipped

Intent: The name people see changes from RadioGridXL to RadioGrid everywhere it shows: the header, the tab and home-screen name, settings, messages, the guide and the iOS app. Nothing anyone saved changes or breaks, and every link already out there keeps working. The repo became RadioGrid on 2026-11-14; this release puts the same name on the screen.

## Done when
- [test] The default build says "RadioGrid" in the header, the page title, the logo's accessible name, the lock-screen album line and the settings version line (`RadioGrid v7.24.0`). `manifest.json`'s `name` is "RadioGrid", and its `short_name` already is. A test fails if "RadioGridXL" appears in any text a user can see or hear in the default build.
- [test] Backup and restore messages say "RadioGrid", and a new backup downloads as `radiogrid-backup.json`. A backup made by any earlier version, under its old file name and with its saved name inside, restores exactly as it did before.
- [test] A radio whose saved name is exactly the old default, "RadioGridXL", shows "RadioGrid" after the update, and the change is saved the next time settings are saved. A radio with any other saved name keeps it unchanged, including "RadioGridXL Kitchen", "radiogridxl" and an empty or multi-line name. The same mapping runs when a backup is restored. `rgxl_cfg`, `rgxl_pin`, `CFG_VERSION` and every saved key stay the same.
- [test] Unhappy path: a branded profile's name (the example-org fixture) is never renamed, either in its build or in what it has saved.
- [test] The iOS app's home-screen name is "RadioGrid" (`appName` and `CFBundleDisplayName`, which today read "Radiogrid"). The bundle ID `dev.marshworks.radiogrid` stays.
- [test] The guide and its screenshot alt text say RadioGrid, the shots are retaken, and `tests/guide.test.mjs` passes at the new version.
- [test] It holds the promises: nothing leaves the device, nothing moves with Reduce Motion on, the radio opens no website, and contrast holds in every theme. The header fits, since the name is two letters shorter.

## Done when: marsh.city says RadioGrid

Intent: The site describes the app by its current name, and nothing that already links to it breaks.

- [test] The project page, its guide page, the Now page, the about page, the résumé and the homepage showcase say RadioGrid for the app as it is today. The project page gets an Updates entry for v7.24.0 saying the name changed.
- [test] Every existing URL keeps working at the same address: `/radio/`, `/radio/feedback/`, `/projects/radiogridxl/`, its `guide/`, and `/embed/guides/radiogridxl/`, which already-installed radios open from settings.
- [test] Older writing keeps the name it had when written: the "Building RadioGridXL" post, and earlier Updates entries.
- [smoke] marsh.city/radio on a phone with a radio saved before the update: the header reads RadioGrid, the stations and settings are unchanged, and the in-app guide opens.
- [manual] Jason: the header reads well beside the R mark at phone size.

Ships as a minor, v7.24.0, through the usual `deploy:radio`.

Decided at approval (2026-11-14): a saved name that is exactly "RadioGridXL" maps to "RadioGrid", and no other saved name changes. marsh.city URLs keep their `radiogridxl` slugs, because GitHub Pages can't redirect and installed radios link to them. Jason updates the name in PROMISES.md himself.

## Out of scope
- Internal identifiers: the `RadioGridXL.html` file name, the `rgxl_*` storage keys, the `radiogridxl` URL slugs, the source file names, and console log prefixes.
- `PROMISES.md`'s mention of the name. Only Jason changes that file.
- The store listing name ("RadioGrid: Big Button Radio") and the trademark search before it.
- Any change to the logo, the R mark, or the header layout.
- Renaming an installed home-screen icon in place. Each phone decides when it rereads the name; a reinstall always shows it.
- Moving the web home off marsh.city.
- The frozen RadioGridXL repo and the Lighthouse APK.
