/**
 * Closed UI stays closed: hidden overlays and the closed settings panel must be
 * out of the screen-reader tree and Tab order, settings actions must refuse to
 * run unless the panel is open, and focus must land somewhere sensible when
 * overlays close. Run with: npm run test:dom
 *
 * jsdom computes `visibility` (with inheritance) from the stylesheet, which is
 * what screen readers and Tab honour, so these assert the computed value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const nextFrame = (w) => new Promise((r) => w.requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FOCUSABLE = 'button, input:not([type="hidden"]), select, textarea, [tabindex="0"]';

/** Focusable controls a screen reader or Tab could still reach inside `root`. */
function reachable(w, root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) =>
    w.getComputedStyle(el).visibility !== 'hidden' && w.getComputedStyle(el).display !== 'none');
}

// ── Hidden means hidden ───────────────────────────────────────────────────
test('after boot, no control in the closed settings panel or any closed overlay is reachable', () => {
  const w = loadApp({ profile: 'example-org' });
  const d = w.document;
  assert.deepEqual(reachable(w, d.getElementById('settings-panel')).map((e) => e.id || e.textContent), [],
    'closed settings panel exposes nothing');
  for (const ov of d.querySelectorAll('.overlay')) {
    assert.deepEqual(reachable(w, ov).map((e) => e.textContent.trim()), [], `closed #${ov.id} exposes nothing`);
  }
});

test('the settings panel is reachable while open and hidden again once it has slid out', async () => {
  const w = loadApp();
  const panel = w.document.getElementById('settings-panel');
  w.openSettings();
  await nextFrame(w);
  assert.equal(w.getComputedStyle(panel).visibility, 'visible');
  assert.ok(reachable(w, panel).length > 0, 'controls reachable while open');
  w.closeSettings();
  await wait(400); // slide-out fallback timer is 350 ms (jsdom fires no transitionend)
  assert.equal(w.getComputedStyle(panel).visibility, 'hidden', 'hidden after the slide-out');
});

test('a shown overlay is visible, and hidden again after it closes', () => {
  const w = loadApp();
  const ov = w.document.getElementById('sleep-overlay');
  w.showOverlay(ov);
  assert.equal(w.getComputedStyle(ov).visibility, 'visible');
  w.hideOverlay(ov);
  assert.equal(w.getComputedStyle(ov).visibility, 'hidden');
});

// ── Settings actions refuse to run on a closed panel (unhappy paths) ──────
test('Apply on a closed panel changes nothing: PIN and org name stay', () => {
  // REGRESSION: apply-btn.click() on a never-opened panel saved PIN "" and reset the org name.
  const w = loadApp({ profile: 'example-org', seed: {
    rgxl_pin: '1234', rgxl_cfg: JSON.stringify({ orgName: 'Sunrise Home' }),
  } });
  w.document.getElementById('apply-btn').click();
  assert.equal(w.getPin(), '1234', 'PIN untouched');
  assert.equal(w.localStorage.getItem('rgxl_pin'), '1234');
  assert.equal(JSON.parse(w.localStorage.getItem('rgxl_cfg')).orgName, 'Sunrise Home', 'org name untouched');
});

test('Reset on a closed panel, or without its confirm dialog, does nothing', () => {
  const streams = [{ id: 'a', label: 'Jazz', url: 'https://ice.example.com/jazz' }];
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams }) } });
  w.document.querySelector('#reset-overlay .reset-confirm-yes').click();
  w.document.getElementById('reset-btn').click();
  assert.equal(w.document.getElementById('reset-overlay').classList.contains('visible'), false,
    'the confirm dialog cannot be opened from a closed panel');
  w.openSettings();
  w.executeReset(); // panel open, but the confirm dialog never shown
  assert.deepEqual(JSON.parse(w.localStorage.getItem('rgxl_cfg')).streams, streams, 'stations untouched');
});

test('Export and Import do nothing on a closed panel', () => {
  const w = loadApp();
  w.exportConfig();
  assert.equal(w.document.getElementById('backup-status').textContent.startsWith('Backup exported'), false);
  const input = w.document.getElementById('import-file');
  Object.defineProperty(input, 'files', { value: [new w.File(['{}'], 'b.json')], configurable: true });
  const before = w.localStorage.getItem('rgxl_cfg');
  w.importConfig({ target: input });
  assert.equal(w.localStorage.getItem('rgxl_cfg'), before);
});

test('the PIN field is filled on open and cleared on close', async () => {
  const w = loadApp({ seed: { rgxl_pin: '1234' } });
  const pin = w.document.getElementById('in-pin');
  w.openSettings();
  assert.equal(pin.value, '1234');
  w.closeSettings();
  assert.equal(pin.value, '', 'no PIN left in the closed panel');
});

// ── Focus lands somewhere sensible ────────────────────────────────────────
test('after Discard, focus returns to what opened settings, not the closed panel', async () => {
  const w = loadApp();
  const d = w.document;
  const opener = d.getElementById('settings-btn');
  opener.focus();
  w.openSettings();
  await nextFrame(w);
  d.getElementById('in-org-name').value = 'Changed';   // an unsaved change
  w.closeSettings();                                    // → "Discard Changes?"
  await nextFrame(w);
  w.confirmDiscard();
  assert.equal(d.activeElement, opener);
});

test('after Reset, focus returns to what opened settings', async () => {
  const w = loadApp();
  const d = w.document;
  const opener = d.getElementById('settings-btn');
  opener.focus();
  w.openSettings();
  await nextFrame(w);
  d.getElementById('reset-btn').focus();
  w.confirmReset();
  await nextFrame(w);
  w.executeReset();
  assert.equal(d.activeElement, opener);
});

test('stopping playback does not pull focus out of an open settings panel', async () => {
  const w = loadApp();
  const d = w.document;
  w.openSettings();
  await nextFrame(w);
  const close = d.getElementById('settings-close');
  close.focus();
  w.stopPlayback(); // hides the (already hidden) connection overlay
  assert.equal(d.activeElement, close);
});

test('recolouring a stream keeps focus on the chosen colour chip', async () => {
  const w = loadApp();
  const d = w.document;
  w.openSettings();
  await nextFrame(w);
  const chip = d.querySelector('.color-chip[data-idx="0"][data-color="teal"]');
  chip.focus();
  chip.click();
  assert.equal(d.activeElement.dataset.color, 'teal', 'focus is on the rebuilt teal chip');
  assert.equal(d.activeElement.dataset.idx, '0');
});

// ── Screen-reader wording ─────────────────────────────────────────────────
test('alert dialogs point at their explanation with aria-describedby', () => {
  const w = loadApp();
  for (const id of ['nonet-overlay', 'discard-overlay', 'reset-overlay']) {
    const ref = w.document.getElementById(id).getAttribute('aria-describedby');
    assert.ok(ref, `#${id} has aria-describedby`);
    assert.ok(w.document.getElementById(ref)?.textContent.trim(), `#${ref} exists and has text`);
  }
});

test('station search speaks one short status line; the results list is not a live region', async () => {
  const w = loadApp();
  const d = w.document;
  assert.equal(d.getElementById('sb-results').hasAttribute('aria-live'), false);
  w.openSettings();
  await nextFrame(w);
  d.querySelector('.stream-browse-btn').focus();
  w.openStreamBrowser();
  w.renderBrowserResults([
    { name: 'A', url_resolved: 'https://a.example.com/s' },
    { name: 'B', url_resolved: 'https://b.example.com/s' },
  ]);
  assert.equal(d.getElementById('sb-status').textContent, '2 stations found.');
  w.renderBrowserResults([]);
  assert.equal(d.getElementById('sb-status').textContent, 'No stations found.');
  w.closeStreamBrowser();
  assert.ok(d.activeElement.classList.contains('stream-browse-btn'), 'focus back on Browse');
});

// A screen reader reads from where focus lands. Landing on Close skipped the
// "Settings" title and Preview for anyone swiping forward (TalkBack, 11-09).
test('opening settings puts focus on its title, which Tab passes over', async () => {
  const w = loadApp();
  const d = w.document;
  w.openSettings();
  await nextFrame(w);
  const title = d.getElementById('settings-title');
  assert.equal(d.activeElement, title);
  assert.equal(title.getAttribute('tabindex'), '-1', 'focusable by script only, never a Tab stop');
  assert.equal(d.getElementById('settings-panel').getAttribute('aria-labelledby'), 'settings-title');
});

test('unhappy path: Shift+Tab from the focused title stays inside settings', async () => {
  const w = loadApp();
  const d = w.document;
  // jsdom has no layout, so the trap's visibility filter (offsetParent)
  // would find nothing and the test would pass without trapping anything.
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { get() { return d.body; } });
  w.openSettings();
  await nextFrame(w);
  d.getElementById('settings-title').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.ok(d.getElementById('settings-panel').contains(d.activeElement), 'focus left the dialog');
  assert.notEqual(d.activeElement, d.getElementById('settings-title'));
});
