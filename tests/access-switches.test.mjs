/**
 * The two Setup switches from the 11-09 ACCEPTANCE: "Allow pinch to zoom"
 * (rewrites the viewport live) and "Show a Settings button" (one tap into
 * settings, never past the PIN). Zoom is off unless someone turns it on. The
 * Settings button shows on a new radio (the 11-11 ACCEPTANCE); a radio that
 * has been saved keeps what it saved, and five taps on the logo open
 * settings only while the button is hidden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

const viewport = (w) => w.document.getElementById('viewport-meta').getAttribute('content');
const settingsBtn = (w) => w.document.getElementById('settings-btn');
const zoomSwitch = (w) => w.document.querySelector('.s-switch[data-switch="zoom"]');
const buttonSwitch = (w) => w.document.querySelector('.s-switch[data-switch="settingsButton"]');
const settingsOpen = (w) => w.document.getElementById('settings-panel').classList.contains('open');
const pinPadShown = (w) => w.document.getElementById('pin-overlay').classList.contains('visible');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = (w) => new Promise((r) => w.requestAnimationFrame(() => r()));
const hideDialog = (w) => w.document.getElementById('hide-overlay');
const hideDialogShown = (w) => hideDialog(w).classList.contains('visible');
const practise = (w, taps) => { for (let i = 0; i < taps; i += 1) w.document.getElementById('hide-practice').click(); };
/** Turn the Settings button off the way a person has to: the switch, five
    quick taps on the practice logo, Done. */
function hideButton(w) {
  buttonSwitch(w).click();
  practise(w, 5);
  w.document.getElementById('hide-done').click();
}

/** A real launch with these saved: storage is written before the page's
    script runs. (loadApp's `seed` writes after boot and re-runs only
    loadSettings, so nothing the boot applies to the page would show.) */
function launchWith(saved, pin = '') {
  return loadApp({ beforeParse(window) {
    window.localStorage.setItem('rgxl_cfg', typeof saved === 'string' ? saved : JSON.stringify(saved));
    window.localStorage.setItem('rgxl_pin', pin);
  } });
}

test('a new radio: the viewport is fixed and the Settings button shows', () => {
  const w = loadApp();
  assert.match(viewport(w), /user-scalable=no/);
  assert.match(viewport(w), /maximum-scale=1/);
  assert.equal(settingsBtn(w).hidden, false);
  w.openSettings();
  assert.equal(zoomSwitch(w).getAttribute('aria-checked'), 'false');
  assert.equal(buttonSwitch(w).getAttribute('aria-checked'), 'true');
});

test('a new radio in the iOS app shows the Settings button too, and one tap opens settings', async () => {
  // On http with the native bridge stubbed, as backup-native.test.mjs does:
  // jsdom gives capacitor:// no localStorage, so there the button would show
  // only because loadSettings() threw.
  const w = loadApp({ beforeParse(win) { win.Capacitor = { Plugins: { Backup: { save() {}, open() {} } } }; } });
  assert.equal(w.localStorage.getItem('rgxl_cfg'), null, 'storage works and holds nothing yet');
  assert.equal(w.document.getElementById('backup-section').hidden, false, 'the app sees the bridge');
  assert.equal(settingsBtn(w).hidden, false);
  settingsBtn(w).click();
  await nextFrame(w);
  assert.equal(settingsOpen(w), true);
});

test('turning zoom on frees the viewport at once, and off fixes it again', () => {
  const w = loadApp();
  w.openSettings();
  zoomSwitch(w).click();
  assert.equal(zoomSwitch(w).getAttribute('aria-checked'), 'true');
  assert.doesNotMatch(viewport(w), /user-scalable|maximum-scale/);
  assert.match(viewport(w), /width=device-width/);
  assert.match(viewport(w), /viewport-fit=cover/, 'the notch handling stays');
  zoomSwitch(w).click();
  assert.match(viewport(w), /user-scalable=no/);
});

test('both survive Apply and a relaunch', () => {
  const w = loadApp();
  w.openSettings();
  zoomSwitch(w).click();
  hideButton(w);
  w.applySettings();
  const relaunched = launchWith(w.localStorage.getItem('rgxl_cfg'));
  assert.doesNotMatch(viewport(relaunched), /user-scalable/);
  assert.equal(settingsBtn(relaunched).hidden, true, 'hidden stays hidden');
  relaunched.openSettings();
  buttonSwitch(relaunched).click();
  relaunched.applySettings();
  assert.equal(settingsBtn(launchWith(relaunched.localStorage.getItem('rgxl_cfg'))).hidden, false, 'and shown stays shown');
});

test('Discard puts both back as they were', () => {
  const w = loadApp();
  w.openSettings();
  zoomSwitch(w).click();
  hideButton(w);
  assert.equal(settingsBtn(w).hidden, true, 'hidden live while settings is open');
  assert.equal(w.hasUnsavedChanges(), true);
  w.closeSettings();
  w.confirmDiscard();
  assert.match(viewport(w), /user-scalable=no/);
  assert.equal(settingsBtn(w).hidden, false);
});

const logo = (w) => w.document.getElementById('logo-area');
const tapLogo = (w, times) => { for (let i = 0; i < times; i += 1) logo(w).click(); };

test('the Settings button opens settings in one tap when there is no PIN; five logo taps do nothing beside it', async () => {
  for (const w of [loadApp(), launchWith({ settingsButton: 'on' })]) {
    tapLogo(w, 5);
    logo(w).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextFrame(w);
    assert.equal(settingsOpen(w), false, 'no second, secret way in while the button shows');
    assert.equal(logo(w).hasAttribute('role'), false, 'the logo is not offered as a button');
    assert.equal(logo(w).hasAttribute('tabindex'), false, 'nor in the Tab order');
    assert.equal(logo(w).hasAttribute('aria-label'), false, 'it reads as the name, with no "tap 5 times"');
    settingsBtn(w).click();
    await nextFrame(w);
    assert.equal(settingsOpen(w), true);
  }
});

test('with the button hidden, five taps on the logo open settings, and through the PIN pad when there is a PIN', async () => {
  const w = launchWith({ settingsButton: 'off' });
  assert.equal(logo(w).getAttribute('role'), 'button');
  assert.equal(logo(w).getAttribute('tabindex'), '0');
  assert.match(logo(w).getAttribute('aria-label'), /tap 5 times for settings$/);
  tapLogo(w, 4);
  await nextFrame(w);
  assert.equal(settingsOpen(w), false, 'four is not five');
  tapLogo(w, 1);
  await nextFrame(w);
  assert.equal(settingsOpen(w), true);

  const locked = launchWith({ settingsButton: 'off' }, '2468');
  tapLogo(locked, 5);
  assert.equal(pinPadShown(locked), true);
  assert.equal(settingsOpen(locked), false);
});

test('hiding the button in settings turns the logo taps on at once, and focus goes back to the way in that is left', async () => {
  const w = loadApp();
  settingsBtn(w).focus();
  settingsBtn(w).click();
  await nextFrame(w);
  hideButton(w);
  w.applySettings();
  await nextFrame(w);
  assert.equal(settingsBtn(w).hidden, true);
  assert.equal(w.document.activeElement, logo(w), 'not left on a hidden button');
  tapLogo(w, 5);
  await nextFrame(w);
  assert.equal(settingsOpen(w), true);
  buttonSwitch(w).click();
  w.applySettings();
  await nextFrame(w);
  assert.equal(w.document.activeElement, settingsBtn(w), 'and back to the button when it returns');
});

test('the PIN hint mentions the five taps only while the button is hidden', () => {
  const pinHint = (w) => w.document.getElementById('pin-hint').textContent;
  assert.equal(pinHint(loadApp()), '4 digits, or blank for none.');
  assert.equal(pinHint(launchWith({ settingsButton: 'off' })), '4 digits, or blank for none. Tap the logo 5 times to open settings.');
});

test('unhappy path: with a PIN the button opens the PIN pad, never settings, and the lockout holds', async () => {
  const w = launchWith({ settingsButton: 'on' }, '2468');
  settingsBtn(w).click();
  assert.equal(pinPadShown(w), true);
  assert.equal(settingsOpen(w), false);
  // Five wrong PINs lock the pad.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    for (const digit of [1, 1, 1, 1]) w.pinKey(digit);
    await wait(260);
  }
  w.hideOverlay(w.document.getElementById('pin-overlay'));
  settingsBtn(w).click();
  assert.equal(pinPadShown(w), true);
  for (const digit of [2, 4, 6, 8]) w.pinKey(digit);
  await wait(260);
  assert.equal(settingsOpen(w), false, 'the right PIN is refused while locked out, button or not');
});

test('the button is named by what it shows, is at least 44 px, and Tab then Enter or Space press it', () => {
  const w = launchWith({ settingsButton: 'on' });
  const btn = settingsBtn(w);
  assert.equal(btn.tagName, 'BUTTON', 'a real button: in the Tab order, Enter and Space press it');
  assert.equal(btn.hasAttribute('tabindex'), false);
  assert.equal(btn.hasAttribute('aria-label'), false, 'its name is its words');
  assert.equal(btn.textContent.trim(), 'Settings');
  assert.equal(btn.querySelector('svg').getAttribute('aria-hidden'), 'true');
  const style = w.getComputedStyle(btn);
  assert.equal(style.minHeight, '44px');
  assert.equal(style.minWidth, '44px');
});

test('each switch says who it is for, in one line under it', () => {
  const w = loadApp();
  const hint = (id) => w.document.getElementById(id).textContent;
  assert.match(hint('zoom-hint'), /^For people who zoom in to read\./);
  assert.equal(hint('settingsbtn-hint'), 'Turn off if the listener might open settings by mistake and change things. To open them then, tap the logo 5 times quickly.', 'why to hide it, and the way back in');
  assert.equal(zoomSwitch(w).getAttribute('aria-describedby'), 'zoom-hint');
  assert.equal(buttonSwitch(w).getAttribute('aria-describedby'), 'settingsbtn-hint');
});

test('unhappy path: a radio saved before the button existed, or with corrupt values or a corrupt config, loads with both off', () => {
  for (const saved of [{ theme: 'dark' }, { zoom: true, settingsButton: 'yes' }, { zoom: '<img src=x>', settingsButton: null }, {}, '{"theme":"dark"', 'null', '']) {
    const w = launchWith(saved);
    assert.match(viewport(w), /user-scalable=no/, JSON.stringify(saved));
    assert.equal(settingsBtn(w).hidden, true, JSON.stringify(saved));
  }
});

test('neither switch is part of a preset: turning them on keeps the preset chosen', () => {
  const w = loadApp();
  w.openSettings();
  const before = w.cfg?.preset ?? w.eval('cfg.preset');
  zoomSwitch(w).click();
  hideButton(w);
  assert.equal(w.eval('cfg.preset'), before);
  assert.equal(w.eval('PRESET_FIELDS').includes('zoom'), false);
  assert.equal(w.eval('PRESET_FIELDS').includes('settingsButton'), false);
});

test('both ride along in a backup and come back on import', () => {
  const w = loadApp();
  w.openSettings();
  zoomSwitch(w).click();
  const backup = w.buildBackupPayload(false);
  assert.equal(backup.zoom, 'on');
  assert.equal(backup.settingsButton, 'on');
  const hidden = launchWith({ settingsButton: 'off' });
  const sanitized = hidden.validateConfig(JSON.parse(JSON.stringify(backup)));
  assert.equal(sanitized.zoom, 'on');
  assert.equal(hidden.applyImportedConfig(sanitized), true);
  assert.equal(settingsBtn(hidden).hidden, false, 'a backup that shows the button brings it back');
});

test('importing a backup made before the button existed leaves it hidden, even on a new radio', () => {
  const w = loadApp();
  const old = w.buildBackupPayload(false);
  delete old.settingsButton;
  assert.equal(w.applyImportedConfig(w.validateConfig(old)), true);
  assert.equal(settingsBtn(w).hidden, true);
  assert.equal(JSON.parse(w.localStorage.getItem('rgxl_cfg')).settingsButton, 'off');
});

test('unhappy path: an import storage refuses leaves the button as it was', () => {
  const w = loadApp();
  const old = w.buildBackupPayload(false);
  delete old.settingsButton;
  w.Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(w.applyImportedConfig(w.validateConfig(old)), false);
  assert.equal(w.eval('cfg.settingsButton'), 'on');
});

test('Reset to defaults ends with the button showing, like a new radio', () => {
  const w = launchWith({ settingsButton: 'off' });
  w.openSettings();
  w.confirmReset();
  w.executeReset();
  assert.equal(settingsBtn(w).hidden, false);
  assert.equal(JSON.parse(w.localStorage.getItem('rgxl_cfg')).settingsButton, 'on');
});

/** The touch blockers are added on DOMContentLoaded, after loadApp returns. */
const loaded = (w) => new Promise((r) => w.document.readyState === 'loading' ? w.document.addEventListener('DOMContentLoaded', () => r()) : r());

/** A touchmove (or Safari gesture) with this many fingers; returns whether
    the app cancelled it. jsdom has no TouchEvent, so `touches` is stubbed. */
function cancelled(w, type, fingers = 2) {
  const e = new w.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: Array.from({ length: fingers }) });
  w.document.getElementById('buttons').dispatchEvent(e);
  return e.defaultPrevented;
}

test('with zoom on, a pinch and Safari\'s gesture events go through (iOS ignores the viewport, so the handlers are what block it)', async () => {
  const w = launchWith({ zoom: 'on' });
  await loaded(w);
  assert.equal(cancelled(w, 'touchmove', 2), false, 'two-finger move');
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) assert.equal(cancelled(w, type), false, type);
});

test('with zoom on and the page zoomed in, a one-finger drag pans', async () => {
  const w = launchWith({ zoom: 'on' });
  await loaded(w);
  assert.equal(cancelled(w, 'touchmove', 1), true, 'not zoomed: the grid still never scrolls');
  Object.defineProperty(w, 'visualViewport', { configurable: true, value: { scale: 2 } });
  assert.equal(cancelled(w, 'touchmove', 1), false, 'zoomed: drag moves around');
});

test('with zoom off, pinches and Safari gestures are still blocked — unhappy path', async () => {
  const w = loadApp();
  await loaded(w);
  assert.equal(cancelled(w, 'touchmove', 2), true);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) assert.equal(cancelled(w, type), true, type);
  Object.defineProperty(w, 'visualViewport', { configurable: true, value: { scale: 2 } });
  assert.equal(cancelled(w, 'touchmove', 1), true, 'a zoom state from elsewhere opens nothing');
});

test('turning zoom on in settings lets a pinch through without a reload', async () => {
  const w = loadApp();
  await loaded(w);
  w.openSettings();
  zoomSwitch(w).click();
  assert.equal(cancelled(w, 'gesturestart'), false);
});

// ── Hiding the button asks for the way back in first ──────────────────────
test('turning the Settings button off opens the practice dialog, and nothing is hidden yet', () => {
  const w = loadApp();
  w.openSettings();
  buttonSwitch(w).click();
  assert.equal(hideDialogShown(w), true);
  assert.equal(buttonSwitch(w).getAttribute('aria-checked'), 'true', 'the switch stays on');
  assert.equal(settingsBtn(w).hidden, false, 'the header button stays');
  assert.equal(w.eval('cfg.settingsButton'), 'on');
  const text = (id) => w.document.getElementById(id).textContent;
  assert.equal(text('hide-overlay-title'), 'Hide the Settings button?');
  assert.equal(text('hide-overlay-body'), 'To open settings again, tap the logo 5 times quickly. Try it now.');
  assert.equal(text('hide-instead'), 'Hard to do? Keep the button and set a PIN.');
  assert.equal(text('hide-practice-name'), 'RadioGrid', 'the logo to tap carries the radio\'s name, like the header');
  assert.ok(w.document.getElementById('hide-practice-logo').children.length > 0, 'and its mark');
  assert.equal(w.document.getElementById('hide-done').hidden, true, 'no Done until the taps are done');
});

test('five quick taps say "Got it." once and offer Done; Done turns the switch off, and Apply saves it', () => {
  const w = loadApp();
  w.openSettings();
  buttonSwitch(w).click();
  practise(w, 5);
  const status = w.document.getElementById('hide-status');
  assert.equal(status.textContent, 'Got it.');
  assert.equal(status.getAttribute('role'), 'status', 'a screen reader hears it');
  assert.equal(w.document.getElementById('hide-done').hidden, false);
  assert.equal(w.document.activeElement.id, 'hide-done');
  assert.equal(w.eval('cfg.settingsButton'), 'on', 'still on until Done');
  let writes = 0;
  new w.MutationObserver(() => { writes += 1; }).observe(status, { childList: true, characterData: true, subtree: true });
  practise(w, 5);
  assert.equal(writes, 0, 'more taps are not announced again');
  w.document.getElementById('hide-done').click();
  assert.equal(hideDialogShown(w), false);
  assert.equal(buttonSwitch(w).getAttribute('aria-checked'), 'false');
  assert.equal(settingsBtn(w).hidden, true);
  w.applySettings();
  assert.equal(JSON.parse(w.localStorage.getItem('rgxl_cfg')).settingsButton, 'off');
});

test('unhappy path: four taps, or five slow ones, hide nothing; nor does Done before the taps', async () => {
  const w = loadApp();
  w.openSettings();
  buttonSwitch(w).click();
  practise(w, 4);
  assert.equal(w.document.getElementById('hide-status').textContent, '');
  assert.equal(w.document.getElementById('hide-done').hidden, true);
  w.finishHide();
  assert.equal(w.eval('cfg.settingsButton'), 'on', 'Done does nothing before the practice is passed');
  assert.equal(hideDialogShown(w), true);
  await wait(2100);
  practise(w, 1);
  assert.equal(w.document.getElementById('hide-done').hidden, true, 'a fifth tap after a two-second gap starts over');
});

test('unhappy path: Cancel, Escape or the idle timeout leave the button showing, and the next try starts clean', () => {
  for (const leave of [(w) => w.document.getElementById('hide-cancel').click(), (w) => w.closeTopmostOverlay(), (w) => w.settingsTimedOut()]) {
    const w = loadApp();
    w.openSettings();
    buttonSwitch(w).click();
    practise(w, 3);
    leave(w);
    assert.equal(hideDialogShown(w), false, String(leave));
    assert.equal(w.eval('cfg.settingsButton'), 'on', String(leave));
    assert.equal(settingsBtn(w).hidden, false, String(leave));
    assert.equal(w.localStorage.getItem('rgxl_cfg'), null, 'nothing saved: ' + String(leave));
    if (!settingsOpen(w)) w.openSettings();
    assert.equal(buttonSwitch(w).getAttribute('aria-checked'), 'true', String(leave));
    buttonSwitch(w).click();
    practise(w, 2);
    assert.equal(w.document.getElementById('hide-done').hidden, true, 'three taps from last time do not count: ' + String(leave));
  }
});

test('turning the button on asks nothing, and a radio saved with it hidden never sees the dialog', () => {
  const w = launchWith({ settingsButton: 'off' });
  w.openSettings();
  buttonSwitch(w).click();
  assert.equal(hideDialogShown(w), false);
  assert.equal(settingsBtn(w).hidden, false, 'on at once');
  buttonSwitch(w).click();
  assert.equal(hideDialogShown(w), false, 'whoever is here came in by the logo');
  assert.equal(settingsBtn(w).hidden, true);
});

test('the practice works by keyboard and hands focus back to the switch', async () => {
  const w = loadApp();
  w.openSettings();
  buttonSwitch(w).focus();
  buttonSwitch(w).click();
  await nextFrame(w);
  const target = w.document.getElementById('hide-practice');
  assert.equal(target.tagName, 'BUTTON', 'a real button: Enter and Space press it');
  assert.equal(target.hasAttribute('tabindex'), false);
  assert.equal(w.document.activeElement, target, 'focus starts on the logo to tap');
  assert.equal(hideDialog(w).getAttribute('aria-labelledby'), 'hide-overlay-title');
  assert.equal(hideDialog(w).getAttribute('aria-describedby'), 'hide-overlay-body');
  w.document.getElementById('hide-cancel').click();
  assert.equal(w.document.activeElement, buttonSwitch(w), 'back on the switch after Cancel');
  hideButton(w);
  assert.equal(w.document.activeElement, buttonSwitch(w), 'and after Done');
});
