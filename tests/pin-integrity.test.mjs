/**
 * The PIN must not change behind the technician's back: not after an import
 * followed by Apply & Close, and not after Reset to Defaults (whose dialog says
 * "Your PIN will not change"). Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

/** Drive importConfig() through a File, as the hidden file input does. */
function importViaFile(w, text) {
  const file = new w.File([text], 'backup.json', { type: 'application/json' });
  const input = w.document.getElementById('import-file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return new Promise((resolve) => {
    const statusEl = w.document.getElementById('backup-status');
    const obs = new w.MutationObserver(() => { obs.disconnect(); resolve(statusEl.textContent); });
    obs.observe(statusEl, { childList: true, characterData: true, subtree: true });
    w.importConfig({ target: input });
  });
}

test('import, then Apply & Close, keeps the device PIN', async () => {
  // REGRESSION: the import blanked the PIN field, so the next Apply removed the PIN.
  const w = loadApp({ profile: 'example-org' });
  w.openSettings();
  const status = await importViaFile(w, JSON.stringify({ theme: 'dark', streams: [
    { id: 'a', label: 'Jazz', url: 'https://ice.example.com/jazz' },
  ] }));
  assert.match(status, /restored/i);
  assert.equal(w.hasUnsavedChanges(), false, 'no false "Discard changes?" after an import');
  w.applySettings();
  assert.equal(w.getPin(), '2580', 'branded PIN still in force');
});

test('import of a backup carrying a PIN, then Apply, keeps the restored PIN', async () => {
  const w = loadApp({ profile: 'example-org' });
  w.openSettings();
  await importViaFile(w, JSON.stringify({ theme: 'dark', pin: '2468' }));
  w.applySettings();
  assert.equal(w.getPin(), '2468');
});

test('Reset to Defaults keeps the PIN, as its dialog promises', () => {
  // REGRESSION: executeReset() set the PIN back to the profile default ('' on the hosted build).
  const w = loadApp({ seed: { rgxl_pin: '1234' } });
  w.openSettings();
  w.confirmReset();
  w.executeReset();
  assert.equal(w.getPin(), '1234');
  assert.match(w.document.querySelector('#reset-overlay .overlay-body').textContent, /PIN will not change/);
});
