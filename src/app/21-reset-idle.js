/* ================================================================
   RESET TO DEFAULTS
   Two-tap confirm: first tap shows warning, second tap executes.
   Resets all settings and streams to factory defaults. PIN is
   preserved (it's stored separately), as the confirm dialog promises.
   ================================================================ */

function confirmReset() {
  if (!settingsOpen) return;
  showOverlay(document.getElementById('reset-overlay'));
}

function cancelReset() {
  hideOverlay(document.getElementById('reset-overlay'));
}

function executeReset() {
  var resetOverlay = document.getElementById('reset-overlay');
  // Only from the confirm dialog, opened from inside settings.
  if (!settingsOpen || !resetOverlay.classList.contains('visible')) return;
  hideOverlay(resetOverlay);

  // Stop any playback
  stopPlayback();

  // Reset all config to defaults
  cfg.orgName = PROFILE.orgName;
  cfg.theme = 'auto';
  cfg.size = 'large';
  cfg.fillview = 'on';
  cfg.volume = 100;
  cfg.advanced = 'off';
  cfg.haptics = 'on';
  cfg.tts = 'off';
  cfg.chime = 'on';
  cfg.resume = 'off';
  cfg.zoom = 'off';
  cfg.settingsButton = 'on';
  cfg.orientation = PROFILE.orientation || 'auto';
  cfg.streams = JSON.parse(JSON.stringify(PROFILE.streams));
  cfg.preset = matchingPresetName();
  const wasNewer = storedConfigIsNewer;
  storedConfigIsNewer = false; // starting over replaces even a newer version's settings
  // Nothing to resume either: a reset device shouldn't start a station by itself.
  try { localStorage.removeItem('rgxl_last'); } catch (e) { /* storage unavailable: resume is off anyway */ }

  // Refresh the UI, save, and close settings
  applyOrgName();
  applyTheme();
  updateMode();
  renderButtons();
  updateSimpleStop();
  updateAdvTransport();
  if (!fadeTimer) audio.volume = targetVolume();
  if (!saveSettings()) {
    // As in applySettings(): stay open and say so; the snapshot stays, so
    // closing still offers to discard back to what's saved.
    storedConfigIsNewer = wasNewer;
    setApplyStatus(SAVE_FAILED_MESSAGE);
    return;
  }

  // Clear snapshot so close won't revert
  cfgSnapshot = null;
  closeSettings();
}


/* ================================================================
   IDLE TIMEOUT
   A setter-up who walks away mustn't leave the listener facing settings
   or the PIN pad. After SETTINGS_IDLE_MS with no tap, key or scroll,
   "Still setting up?" asks; with no answer in SETTINGS_WARN_MS, settings
   close as Close → Discard does (unsaved edits dropped: saving would keep
   a half-typed address nobody checked). The PIN pad just closes. Neither
   touches the radio's stream, and neither moves focus or says anything on
   closing: someone may be asleep with the radio on. (Closing settings stops
   a station-browser preview and reverts an unapplied volume, as Discard
   does.) Taps inside the guide's frame can't be seen from here, so reading
   the guide for 3 minutes brings up the prompt; one tap carries on.
   ================================================================ */
const SETTINGS_IDLE_MS = 3 * 60 * 1000;
const SETTINGS_WARN_MS = 30 * 1000;
const PIN_IDLE_MS = 60 * 1000;
const idleOverlay = document.getElementById('idle-overlay');
let settingsIdleTimer = null;
let settingsWarnTimer = null;
let pinIdleTimer = null;

function startSettingsIdle() {
  clearTimeout(settingsIdleTimer);
  clearTimeout(settingsWarnTimer);
  settingsWarnTimer = null;
  settingsIdleTimer = setTimeout(showIdlePrompt, SETTINGS_IDLE_MS);
}

function stopSettingsIdle() {
  clearTimeout(settingsIdleTimer);
  clearTimeout(settingsWarnTimer);
  settingsIdleTimer = settingsWarnTimer = null;
  hideOverlay(idleOverlay);
}

function showIdlePrompt() {
  settingsIdleTimer = null;
  if (!settingsOpen) return;
  showOverlay(idleOverlay);
  settingsWarnTimer = setTimeout(settingsTimedOut, SETTINGS_WARN_MS);
}

/** A tap anywhere on the prompt (its button included), or Escape. */
function keepEditing() {
  hideOverlay(idleOverlay);
  if (settingsOpen) startSettingsIdle();
}

/** Close everything settings opened, then settings, handing focus to
    nothing (a focus move is read aloud, like a tap). */
function settingsTimedOut() {
  settingsWarnTimer = null;
  if (!settingsOpen) return;
  // Let go of focus first, while its element can still give it up: blur()
  // on a button whose dialog already closed does nothing.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const quiet = (el) => { el._returnFocus = null; };
  quiet(idleOverlay);
  hideOverlay(idleOverlay);
  const help = document.getElementById('help-overlay');
  if (help.classList.contains('open')) closeHelp(false);
  const emoji = document.getElementById('emoji-picker-overlay');
  if (emoji.classList.contains('open')) { emojiPickerReturnFocus = null; closeEmojiPicker(); }
  const browser = document.getElementById('stream-browser-overlay');
  if (browser.classList.contains('open')) { quiet(browser); closeStreamBrowser(); }
  Array.prototype.slice.call(document.querySelectorAll('.overlay.visible')).reverse()
    .forEach(function(el) { quiet(el); hideOverlay(el); });
  quiet(document.getElementById('settings-panel'));
  doCloseSettings();
}

function restartPinIdle() {
  clearTimeout(pinIdleTimer);
  pinIdleTimer = setTimeout(function() {
    pinIdleTimer = null;
    if (!pinOverlay.classList.contains('visible')) return;
    pinOverlay._returnFocus = null;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    pinCancel(); // a running lockout keeps counting (see startPinLockout)
  }, PIN_IDLE_MS);
}

/** Any tap, key or scroll restarts the clocks. While the prompt shows, only
    its own tap or Escape answers it: a tap behind is impossible (it covers
    the screen), and a stray key shouldn't dismiss a warning unseen. */
function noteInput(e) {
  if (pinOverlay.classList.contains('visible')) restartPinIdle();
  if (!settingsOpen) return;
  if (idleOverlay.classList.contains('visible')) {
    if (e.type === 'keydown' && e.key === 'Escape') {
      e.stopImmediatePropagation(); // Escape here means "keep editing", not "close settings"
      keepEditing();
    }
    return;
  }
  startSettingsIdle();
}
['pointerdown', 'keydown', 'wheel', 'touchstart', 'input', 'scroll'].forEach(function(type) {
  document.addEventListener(type, noteInput, { capture: true, passive: type !== 'keydown' });
});


