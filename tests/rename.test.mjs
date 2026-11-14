// The app was called RadioGridXL until v7.24.0. The name on screen is now
// RadioGrid; the file name, the rgxl_* keys and the URL slugs stay. A radio
// that kept the old default name follows the rename, and nothing else anyone
// saved changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp } from './harness.mjs';

const repo = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), 'utf-8');

/** A config saved by v7.23.x with the default name, as it sits in storage. */
const OLD_SAVED = {
  v: 1,
  orgName: 'RadioGridXL',
  theme: 'light',
  size: 'large',
  volume: 60,
  settingsButton: 'on',
  streams: [{ id: 's1', label: 'Jazz', sub: 'All night', url: 'https://example.com/jazz', emoji: '🎷', color: 'teal' }],
};

/** Boot as a cold start on a device that already holds `cfg` (and a PIN). */
function bootSaved(cfg, { pin, profile, beforeParse } = {}) {
  return loadApp({
    profile,
    beforeParse(win) {
      win.localStorage.setItem('rgxl_cfg', JSON.stringify(cfg));
      if (pin) win.localStorage.setItem('rgxl_pin', pin);
      if (beforeParse) beforeParse(win);
    },
  });
}

const stored = (w) => JSON.parse(w.localStorage.getItem('rgxl_cfg'));

/** Every piece of text a person can see or hear from the page: text nodes,
    the attributes screen readers and browsers read out, and the title. */
function visibleText(w) {
  const doc = w.document;
  const out = [doc.title];
  const walker = doc.createTreeWalker(doc.body, w.NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement.closest('script, style')) out.push(n.textContent);
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of ['aria-label', 'alt', 'title', 'placeholder', 'value', 'aria-description']) {
      if (el.hasAttribute(attr)) out.push(el.getAttribute(attr));
    }
  }
  for (const input of doc.querySelectorAll('input, textarea')) out.push(input.value);
  for (const meta of doc.querySelectorAll('meta[name="apple-mobile-web-app-title"], meta[name="application-name"]')) out.push(meta.content);
  return out.join('\n');
}

test('the default build says RadioGrid in the header, title, logo, lock screen and version line', () => {
  const w = loadApp();
  assert.equal(w.document.title, 'RadioGrid');
  assert.equal(w.document.getElementById('org-name').textContent, 'RadioGrid');
  assert.equal(w.document.getElementById('settings-version').textContent.split(' · ')[0], `RadioGrid v${JSON.parse(read('package.json')).version}`);
  w.close();
});

test('the lock screen names the album RadioGrid, for a fresh radio and one saved as RadioGridXL', () => {
  const fakeMediaSession = (win) => {
    win.navigator.mediaSession = { metadata: null, playbackState: 'none', setActionHandler() {} };
    win.MediaMetadata = class { constructor(m) { Object.assign(this, m); } };
  };
  for (const saved of [null, OLD_SAVED]) {
    const w = saved ? bootSaved(saved, { beforeParse: fakeMediaSession }) : loadApp({ beforeParse: fakeMediaSession });
    w.applyMediaMetadata({ label: 'Jazz', sub: '' });
    assert.equal(w.navigator.mediaSession.metadata.album, 'RadioGrid', saved ? 'saved as RadioGridXL' : 'fresh');
    w.close();
  }
});

test('with the Settings button hidden, the logo is named RadioGrid, also on a radio saved as RadioGridXL', () => {
  for (const orgName of [undefined, 'RadioGridXL']) {
    const w = bootSaved({ ...OLD_SAVED, orgName, settingsButton: 'off' });
    assert.equal(w.document.getElementById('logo-area').getAttribute('aria-label'), 'RadioGrid — tap 5 times for settings', String(orgName));
    w.close();
  }
});

test('no text a person can see or hear in the default build says RadioGridXL', () => {
  const w = loadApp();
  w.openSettings();
  assert.doesNotMatch(visibleText(w), /RadioGridXL/i);
  w.close();
});

test('the only RadioGridXL strings left in the app script are the legacy name and log prefixes', () => {
  // The built file has exactly one <script> (smoke-test.mjs holds that), so
  // its body is everything between the first open tag and the last close.
  const html = read('RadioGridXL.html');
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  assert.ok(script.includes('OLD_DEFAULT_ORG_NAME'), 'found the app script');
  const literals = script.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*RadioGridXL(?:(?!\1)[^\\\n]|\\.)*\1/g) || [];
  const allowed = (s) => s === "'RadioGridXL'" || /^'\[RadioGridXL\] /.test(s);
  assert.deepEqual(literals.filter((s) => !allowed(s)), []);
  assert.equal((script.match(/= 'RadioGridXL'/g) || []).length, 1, 'only OLD_DEFAULT_ORG_NAME holds the old name');
});

test('the manifest, feedback page and icon say RadioGrid', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, 'RadioGrid');
  assert.equal(manifest.short_name, 'RadioGrid');
  assert.doesNotMatch(read('feedback/index.html'), /RadioGridXL/);
  assert.match(read('icon.svg'), /aria-label="RadioGrid"/);
});

test('the guide and its screenshot alt text say RadioGrid', () => {
  // guide.md becomes marsh.city's guide page and the in-app help.
  const guide = read('guide/guide.md');
  assert.match(guide, /^title: How to use RadioGrid$/m);
  assert.doesNotMatch(guide, /RadioGridXL/);
  assert.doesNotMatch(read('guide/scenes.mjs').match(/alt: '[^']*'/g).join('\n'), /RadioGridXL/);
});

test('the iOS app is called RadioGrid and keeps its bundle ID', () => {
  const cap = JSON.parse(read('capacitor.config.json'));
  assert.equal(cap.appName, 'RadioGrid');
  assert.equal(cap.appId, 'dev.marshworks.radiogrid');
  assert.match(read('ios/App/App/Info.plist'), /<key>CFBundleDisplayName<\/key>\s*<string>RadioGrid<\/string>/);
  assert.match(read('ios/App/App/BackupPlugin.swift'), /fileName = "radiogrid-backup\.json"/);
});

test('a new backup downloads as radiogrid-backup.json', () => {
  const w = loadApp();
  let download = null;
  w.URL.createObjectURL = () => 'blob:x';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { download = this.download; };
  w.openSettings();
  w.exportConfig();
  assert.equal(download, 'radiogrid-backup.json');
  w.close();
});

test('a radio saved with the old default name shows RadioGrid, and saves it on the next save', () => {
  const w = bootSaved(OLD_SAVED);
  assert.equal(w.document.getElementById('org-name').textContent, 'RadioGrid');
  assert.equal(stored(w).orgName, 'RadioGridXL', 'loading alone writes nothing');
  w.openSettings();
  assert.equal(w.document.getElementById('in-org-name').value, 'RadioGrid');
  w.applySettings();
  const after = stored(w);
  assert.equal(after.orgName, 'RadioGrid');
  // Everything else comes through as it was saved.
  assert.equal(after.v, 1);
  assert.equal(after.theme, 'light');
  assert.equal(after.size, 'large');
  assert.equal(after.volume, 60);
  assert.deepEqual(after.streams, OLD_SAVED.streams);
  w.close();
});

test('any other saved name is kept exactly — unhappy path', () => {
  for (const orgName of ['RadioGridXL Kitchen', 'radiogridxl', 'RADIOGRIDXL', ' RadioGridXL', 'RadioGridXL\nUpstairs', 'My\nRadioGridXL', 'Grandma\'s radio']) {
    const w = bootSaved({ ...OLD_SAVED, orgName });
    assert.equal(w.validateConfig({ orgName }).orgName, orgName, JSON.stringify(orgName));
    w.saveSettings();
    assert.equal(stored(w).orgName, orgName, JSON.stringify(orgName));
    w.close();
  }
  // An empty or blank name is dropped as before, so the profile default shows.
  for (const orgName of ['', '   ']) {
    assert.equal('orgName' in loadApp().validateConfig({ orgName }), false, JSON.stringify(orgName));
  }
});

test('storage keys and the schema version are unchanged', () => {
  const w = bootSaved(OLD_SAVED, { pin: '1234' });
  w.saveSettings();
  assert.equal(w.getPin(), '1234');
  assert.equal(stored(w).v, 1);
  assert.match(read('RadioGridXL.html'), /const CFG_VERSION = 1;/);
  assert.deepEqual(Object.keys(w.localStorage).filter((k) => !k.startsWith('rgxl_')), []);
  w.close();
});

test('restoring an old backup with the old default name maps it, and restores the rest as before', () => {
  const w = loadApp();
  w.openSettings();
  w.importBackupText(JSON.stringify({ ...OLD_SAVED, pin: '4321' }));
  assert.equal(w.document.getElementById('backup-status').textContent, 'Backup restored.');
  const after = stored(w);
  assert.equal(after.orgName, 'RadioGrid');
  assert.equal(after.theme, 'light');
  assert.deepEqual(after.streams, OLD_SAVED.streams);
  assert.equal(w.getPin(), '4321');
  w.close();
});

test('restoring an old backup with its own name keeps that name — unhappy path', () => {
  const w = loadApp();
  w.openSettings();
  w.importBackupText(JSON.stringify({ ...OLD_SAVED, orgName: 'RadioGridXL Kitchen' }));
  assert.equal(stored(w).orgName, 'RadioGridXL Kitchen');
  // A backup from before the schema version existed (no `v`) restores too.
  const { v, ...unversioned } = OLD_SAVED;
  w.importBackupText(JSON.stringify(unversioned));
  assert.equal(stored(w).orgName, 'RadioGrid');
  w.close();
});

test('a wrong file still gets the renamed refusal — unhappy path', () => {
  const w = loadApp();
  w.openSettings();
  w.importBackupText('[]');
  assert.equal(w.document.getElementById('backup-status').textContent, 'That file is not a RadioGrid backup. Nothing was changed.');
  w.importBackupText(JSON.stringify({ ...OLD_SAVED, v: 99 }));
  assert.equal(w.document.getElementById('backup-status').textContent, 'This backup is from a newer version of RadioGrid. Update the app first. Nothing was changed.');
  w.close();
});

test('a branded profile keeps its own name, in its build and in what it saved — unhappy path', () => {
  const profileName = JSON.parse(read('tests/fixtures/example-org.json')).orgName;
  const fresh = loadApp({ profile: 'example-org' });
  assert.equal(fresh.document.getElementById('org-name').innerHTML.split('<br>').join('\n'), profileName);
  fresh.saveSettings();
  assert.equal(stored(fresh).orgName, profileName);
  fresh.close();

  const saved = bootSaved({ ...OLD_SAVED, orgName: profileName }, { profile: 'example-org' });
  saved.saveSettings();
  assert.equal(stored(saved).orgName, profileName);
  saved.close();
});
