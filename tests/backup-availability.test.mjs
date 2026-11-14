// Backup needs a browser that can save a download and open a file picker,
// or the iOS app's native bridge (tests/backup-native.test.mjs). The Android
// WebView APK (file://) has neither, and it used to say the backup was ready
// while saving nothing, so the section is hidden there, and on capacitor://
// when the bridge is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

test('hosted over http(s), the Backup section shows', () => {
  for (const url of ['http://localhost/', 'https://marsh.city/radio/']) {
    const w = loadApp({ url });
    assert.equal(w.document.getElementById('backup-section').hidden, false, url);
    w.close();
  }
});

test('file:// (the APK) and capacitor:// (iOS) hide Backup — unhappy path', () => {
  for (const url of ['file:///android_asset/RadioGridXL.html', 'capacitor://localhost/']) {
    const w = loadApp({ url });
    assert.equal(w.document.getElementById('backup-section').hidden, true, url);
    w.close();
  }
});

test('on file://, Export does nothing and claims nothing — unhappy path', () => {
  const w = loadApp({ url: 'file:///android_asset/RadioGridXL.html' });
  const status = w.document.getElementById('backup-status');
  const before = status.textContent;
  let clicked = false;
  w.HTMLAnchorElement.prototype.click = () => { clicked = true; };
  w.openSettings();
  w.exportConfig();
  assert.equal(clicked, false, 'no download was started');
  assert.equal(status.textContent, before, 'no "ready to save" message');
  w.close();
});
