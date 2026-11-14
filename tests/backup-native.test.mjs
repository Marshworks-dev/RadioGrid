// In the iOS app a blob download saves nothing and the file input opens no
// picker, so Backup goes through the native bridge (ios/App/App/BackupPlugin.swift).
// These tests stand in a fake Capacitor.Plugins.Backup for it and hold the
// page's side: what it sends, what it says, and that every import still
// runs through the same validation as the website's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

/** Boot the app with a scripted native bridge. jsdom gives capacitor:// an
 * opaque origin with no localStorage, so storage tests run on http; the
 * bridge wins over the web path wherever it's present. */
function loadIosApp({ saveResult = { saved: true, toFiles: true }, openResult = { cancelled: true }, url = 'http://localhost/' } = {}) {
  const calls = { save: [], open: 0 };
  const w = loadApp({
    url,
    beforeParse(win) {
      win.Capacitor = { Plugins: { Backup: {
        save(opts) {
          calls.save.push(opts);
          return saveResult instanceof Error ? Promise.reject(saveResult) : Promise.resolve(saveResult);
        },
        open() {
          calls.open++;
          return openResult instanceof Error ? Promise.reject(openResult) : Promise.resolve(openResult);
        },
      } } };
    },
  });
  return { w, calls };
}

const status = (w) => w.document.getElementById('backup-status').textContent;
const savedStreams = (w) => JSON.parse(w.localStorage.getItem('rgxl_cfg')).streams;
const settle = () => new Promise((r) => setTimeout(r, 0));

const JAZZ_BACKUP = JSON.stringify({ theme: 'dark', streams: [
  { id: 'a', label: 'Jazz', url: 'https://ice.example.com/jazz' },
] });

test('with the native bridge, the Backup section shows in the iOS app', () => {
  const { w } = loadIosApp({ url: 'capacitor://localhost/' });
  assert.equal(w.document.getElementById('backup-section').hidden, false);
});

test('Export hands the native side the backup payload, without the PIN by default', async () => {
  const { w, calls } = loadIosApp();
  let downloaded = false;
  w.HTMLAnchorElement.prototype.click = () => { downloaded = true; };
  w.openSettings();
  w.exportConfig();
  await settle();
  assert.equal(downloaded, false, 'no web download in the app');
  assert.equal(calls.save.length, 1);
  const sent = JSON.parse(calls.save[0].text);
  assert.deepEqual(sent, JSON.parse(JSON.stringify(w.buildBackupPayload(false))));
  assert.equal('pin' in sent, false);
  assert.equal(status(w), 'Backup saved.');
});

test('Export with the PIN box ticked includes the PIN and says so', async () => {
  const { w, calls } = loadIosApp();
  w.setPin('2468');
  w.openSettings();
  w.document.getElementById('in-backup-pin').checked = true;
  w.exportConfig();
  await settle();
  assert.equal(JSON.parse(calls.save[0].text).pin, '2468');
  assert.match(status(w), /^Backup saved \(includes PIN/);
});

test('Export finished by Copy or AirDrop says sent, not saved', async () => {
  // The share sheet reports success for any action; only Files is a save.
  const { w } = loadIosApp({ saveResult: { saved: true, toFiles: false } });
  w.openSettings();
  w.exportConfig();
  await settle();
  assert.equal(status(w), 'Backup sent.');
  w.document.getElementById('in-backup-pin').checked = true;
  w.exportConfig();
  await settle();
  assert.match(status(w), /^Backup sent \(includes PIN/);
});

test('a new export or import clears the last result while the sheet is up', async () => {
  // REGRESSION (review): an earlier "Backup saved." stayed on screen under
  // the share sheet, and for good if the sheet never answered.
  const { w } = loadIosApp();
  const hint = status(w);
  w.openSettings();
  w.exportConfig();
  await settle();
  assert.equal(status(w), 'Backup saved.');
  w.Capacitor.Plugins.Backup.save = () => new Promise(() => {});
  w.exportConfig();
  assert.equal(status(w), hint, 'export in progress shows the hint');
  w.Capacitor.Plugins.Backup.save = () => Promise.resolve({ saved: true, toFiles: true });
  w.exportConfig();
  await settle();
  w.Capacitor.Plugins.Backup.open = () => new Promise(() => {});
  w.chooseBackupFile();
  assert.equal(status(w), hint, 'picker open shows the hint');
});

test('Import accepts a backup saved with a byte-order mark', async () => {
  // The web file reader strips it; the native picker hands it over.
  const { w } = loadIosApp({ openResult: { text: '\uFEFF' + JAZZ_BACKUP } });
  w.openSettings();
  w.chooseBackupFile();
  await settle();
  assert.equal(status(w), 'Backup restored.');
  assert.deepEqual(savedStreams(w).map((s) => s.label), ['Jazz']);
});

test('Export cancelled in the share sheet says it was not saved — unhappy path', async () => {
  const { w } = loadIosApp({ saveResult: { saved: false } });
  w.openSettings();
  w.exportConfig();
  await settle();
  assert.equal(status(w), 'Backup not saved.');
});

test('Export that fails natively says it could not export — unhappy path', async () => {
  const { w } = loadIosApp({ saveResult: new Error('Share sheet failed') });
  w.openSettings();
  w.exportConfig();
  await settle();
  assert.equal(status(w), 'Could not export backup on this device.');
});

test('Import reads the picked file through the same validation and applies it', async () => {
  const { w, calls } = loadIosApp({ openResult: { text: JAZZ_BACKUP } });
  let webPickerOpened = false;
  w.document.getElementById('import-file').click = () => { webPickerOpened = true; };
  w.openSettings();
  w.chooseBackupFile();
  await settle();
  assert.equal(calls.open, 1);
  assert.equal(webPickerOpened, false, 'the web file input is not used in the app');
  assert.equal(status(w), 'Backup restored.');
  assert.deepEqual(savedStreams(w).map((s) => s.label), ['Jazz']);
});

test('Import cancelled in the picker changes nothing and says nothing — unhappy path', async () => {
  const { w } = loadIosApp({ openResult: { cancelled: true } });
  w.openSettings();
  const before = w.localStorage.getItem('rgxl_cfg');
  const statusBefore = status(w);
  w.chooseBackupFile();
  await settle();
  assert.equal(w.localStorage.getItem('rgxl_cfg'), before);
  assert.equal(status(w), statusBefore);
});

test('Import of a file too large, not JSON, or unreadable changes nothing — unhappy path', async () => {
  const cases = [
    [{ tooLarge: true }, 'That file is not a RadioGridXL backup. Nothing was changed.'],
    [{ text: 'not json {' }, 'That file is not valid JSON. Nothing was changed.'],
    [{ text: JSON.stringify({ v: 999, theme: 'dark' }) }, /newer version/],
    [{ text: JSON.stringify({ nothing: 'useful' }) }, 'No valid settings found in that file. Nothing was changed.'],
    [new Error('Could not read that file'), 'Could not read that file. Nothing was changed.'],
  ];
  for (const [openResult, expected] of cases) {
    const { w } = loadIosApp({ openResult });
    w.openSettings();
    const before = w.localStorage.getItem('rgxl_cfg');
    w.chooseBackupFile();
    await settle();
    if (expected instanceof RegExp) assert.match(status(w), expected);
    else assert.equal(status(w), expected);
    assert.equal(w.localStorage.getItem('rgxl_cfg'), before, JSON.stringify(openResult));
  }
});

test('Import that arrives after settings closed is dropped — unhappy path', async () => {
  // The picker can sit open past the settings idle timeout; a restore then
  // would change the radio with nobody looking at it.
  let answer;
  const pending = new Promise((r) => { answer = r; });
  const { w } = loadIosApp({ openResult: { text: JAZZ_BACKUP } });
  w.Capacitor.Plugins.Backup.open = () => pending;
  w.openSettings();
  const before = w.localStorage.getItem('rgxl_cfg');
  w.chooseBackupFile();
  w.closeSettings();
  answer({ text: JAZZ_BACKUP });
  await settle();
  assert.equal(w.localStorage.getItem('rgxl_cfg'), before);
});
