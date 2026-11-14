/* ================================================================
   DEVICE UTILITIES
   Platform-specific actions available from the settings panel.
   ================================================================ */

/** Open an Android Settings screen through the APK's bridge. The buttons only
    show when the bridge exists (init()): a browser refuses intent: links to
    Settings (Chrome only launches BROWSABLE activities) or can't open them at
    all (Safari), and so does the APK's own intent hardening. A Java exception
    (Settings blocked by device management) arrives here as an Error. */
function openDeviceSettings(method) {
  const status = document.getElementById('device-status');
  status.textContent = '';
  try {
    window.AndroidBridge[method]();
  } catch (e) {
    console.warn('[device] AndroidBridge.' + method + ' failed:', e && e.message);
    status.textContent = "Couldn't open Settings. This device may block it.";
  }
}

/** Open Android OS Wi-Fi settings. */
function openWifiSettings() { openDeviceSettings('openWifiSettings'); }

/** Open Android OS main settings. */
function openOsSettings() { openDeviceSettings('openOsSettings'); }

/** Open the Accessibility screen, where Live Caption is found on Android 10+. */
function openLiveCaptionSettings() { openDeviceSettings('openAccessibilitySettings'); }


/* ================================================================
   SETTINGS PANEL
   Slide-out panel for technician configuration. Accessible only
   after entering the correct PIN (tap logo 5 times to trigger).
   ================================================================ */

function openSettings() {
  var panel = document.getElementById('settings-panel');
  panel._returnFocus = document.activeElement;
  settingsOpen = true;
  inertBehind(panel);

  // Snapshot current config so we can revert on cancel
  cfgSnapshot = JSON.parse(JSON.stringify(cfg));
  setApplyStatus(''); // a save warning belongs to the visit that hit it

  // Reset to a known hidden state (clears stale classes from interrupted animations)
  panel.classList.remove('open', 'animated');
  // Force the browser to compute the hidden position before starting the transition
  getComputedStyle(panel).transform;
  panel.classList.add('animated');
  // Use rAF so the browser registers the transition before the target state is set
  requestAnimationFrame(function() { panel.classList.add('open'); });

  // Always open at the top: reopening where the last visit scrolled to put
  // Reset to Defaults under the first tap.
  document.getElementById('settings-body').scrollTop = 0;

  // Sync volume slider with current value
  showVolume();

  // Sync org name textarea
  document.getElementById('in-org-name').value = cfg.orgName;

  // The PIN field always starts from the saved PIN. Apply reads it back, so a
  // stale or blank field here would silently change (or remove) the PIN.
  document.getElementById('in-pin').value = getPin();
  setPinShown(false);

  fitSettingsPanel();
  showBuildCode();
  showCredit();
  renderStreamEditor();
  renderPresetChips();
  quietSync = true; // opening isn't a change: nothing to point at
  syncChips();
  quietSync = false;

  // Focus trap + move focus to the title, so a screen reader starts at
  // "Settings" and swipes on through Preview and Close (landing on Close
  // skipped both). Tab from the title goes on to Preview.
  panel._focusTrap = function(e) { trapFocus(e, panel); };
  panel.addEventListener('keydown', panel._focusTrap);
  requestAnimationFrame(() => document.getElementById('settings-title').focus());
  startSettingsIdle();
}

/** Check whether current cfg differs from the snapshot taken at open time. */
function hasUnsavedChanges() {
  if (!cfgSnapshot) return false;
  // Read any pending stream editor input into cfg before comparing
  readStreamEditor();
  var orgVal = document.getElementById('in-org-name').value || PROFILE.orgName;
  if (orgVal !== cfgSnapshot.orgName) return true;
  // No 'preset': it's derived from the fields compared here, so it can only
  // differ when they do (or when it's stale, which isn't a change).
  for (var k of ['theme', 'size', 'fillview', 'advanced', 'haptics', 'tts', 'chime', 'resume', 'zoom', 'settingsButton', 'orientation']) {
    if (cfg[k] !== cfgSnapshot[k]) return true;
  }
  if (cfg.volume !== cfgSnapshot.volume) return true;
  if (JSON.stringify(cfg.streams) !== JSON.stringify(cfgSnapshot.streams)) return true;
  var curPin = document.getElementById('in-pin').value.replace(/\D/g, '');
  var oldPin = getPin();
  if (curPin !== oldPin && (curPin === '' || curPin.length === 4)) return true;
  return false;
}

function closeSettings() {
  // If there are unsaved changes, show confirmation overlay
  if (hasUnsavedChanges()) {
    showOverlay(document.getElementById('discard-overlay'));
    return;
  }
  doCloseSettings();
}

function cancelDiscard() {
  hideOverlay(document.getElementById('discard-overlay'));
}

function confirmDiscard() {
  hideOverlay(document.getElementById('discard-overlay'));
  doCloseSettings();
}

/** Actually close the settings panel, reverting any unapplied changes. */
function doCloseSettings() {
  stopSettingsIdle();
  endPreview(false);
  // Revert to snapshot if settings were not applied
  if (cfgSnapshot) {
    cfg.orgName = cfgSnapshot.orgName;
    cfg.theme = cfgSnapshot.theme;
    cfg.size = cfgSnapshot.size;
    cfg.fillview = cfgSnapshot.fillview;
    cfg.volume = cfgSnapshot.volume;
    cfg.advanced = cfgSnapshot.advanced;
    cfg.haptics = cfgSnapshot.haptics;
    cfg.tts = cfgSnapshot.tts;
    cfg.chime = cfgSnapshot.chime;
    cfg.resume = cfgSnapshot.resume;
    cfg.zoom = cfgSnapshot.zoom;
    cfg.settingsButton = cfgSnapshot.settingsButton;
    cfg.preset = cfgSnapshot.preset;
    cfg.orientation = cfgSnapshot.orientation;
    cfg.streams = cfgSnapshot.streams;
    cfgSnapshot = null;

    // Re-apply reverted settings to the UI. The theme snaps back with no
    // fade: Safari tints its toolbar from the page, and mid-fade it kept the
    // previewed theme's colour.
    applyOrgName();
    applyTheme();
    snapTheme();
    updateMode();
    renderButtons();
    updateSimpleStop();
    updateAdvTransport();
    if (!fadeTimer) audio.volume = targetVolume();
  }

  var panel = document.getElementById('settings-panel');
  if (panel._focusTrap) {
    panel.removeEventListener('keydown', panel._focusTrap);
    panel._focusTrap = null;
  }
  panel.classList.remove('open');
  settingsOpen = false;
  fitSettingsPanel(); // back to the whole screen, for next time
  releaseInert(panel);
  // Lays the grid out again: stations with no address show only while
  // settings is open, and a new orientation waits for it to close.
  applyTheme();
  // Don't leave the PIN sitting in the closed panel's text field.
  document.getElementById('in-pin').value = '';
  // Remove animated class after slide-out completes (timeout fallback if
  // transitionend doesn't fire). Then Safari's bars, which took the panel's
  // colour as it opened, re-read the page's.
  function slidOut() {
    panel.classList.remove('animated');
    retintSafariBars();
  }
  var tid = setTimeout(slidOut, 350);
  panel.addEventListener('transitionend', function handler() {
    panel.removeEventListener('transitionend', handler);
    clearTimeout(tid);
    slidOut();
  });
  // The Settings button may have been switched on or off in this visit, so
  // focus goes back to whichever way in is there now.
  var opener = panel._returnFocus;
  var settingsBtn = document.getElementById('settings-btn'), logo = document.getElementById('logo-area');
  if (opener === settingsBtn || opener === logo) opener = settingsButtonShown() ? settingsBtn : logo;
  restoreFocus(opener);
  panel._returnFocus = null;
}

/** Put the caret at the end of a field on focus. iOS put it at the start
    of the organization name, so typing went in front of the old name. Done
    a frame later, after the browser places it for the tap. */
function caretToEnd(el) {
  requestAnimationFrame(function() {
    if (document.activeElement !== el) return;
    var end = el.value.length;
    el.setSelectionRange(end, end);
  });
}

/** Live-preview the organization name as it's typed. */
function previewOrgName() {
  cfg.orgName = document.getElementById('in-org-name').value || PROFILE.orgName;
  applyOrgName();
}

/* Settings changes already redraw the grid behind the panel, which covers it
   on a phone. Preview slides the panel aside to show the grid, unapplied
   changes and all; nothing is saved or reverted. The panel keeps its fields
   and scroll position, and settings counts as open throughout. */
function startPreview() {
  if (!settingsOpen || previewing) return;
  previewing = true;
  // The grid behind is the preview: readable again, while taps on it are
  // still caught below.
  releaseInert(document.getElementById('settings-panel'));
  document.getElementById('settings-panel').classList.add('previewing');
  var back = document.getElementById('preview-back');
  back.hidden = false;
  requestAnimationFrame(() => back.focus());
}

/** Back to settings from a preview; moveFocus is false when settings is closing. */
function endPreview(moveFocus = true) {
  if (!previewing) return;
  previewing = false;
  hidePreviewHint();
  inertBehind(document.getElementById('settings-panel'));
  document.getElementById('settings-panel').classList.remove('previewing');
  document.getElementById('preview-back').hidden = true;
  if (moveFocus) requestAnimationFrame(() => document.getElementById('settings-preview').focus());
}

// While previewing, the grid can be looked at and read but not used: a tap
// (or a screen reader's double-tap, or Enter) on a station, the stop bar,
// the transport or the logo is stopped here, in the capture phase, before
// any of their own handlers run.
document.getElementById('app').addEventListener('click', function (e) {
  if (!previewing) return;
  if (e.target.closest('#header, #buttons, #simple-stop, #adv-transport')) {
    e.preventDefault();
    e.stopPropagation();
    showPreviewHint();
  }
}, true);

const PREVIEW_HINT = 'Preview only. Tap Back to settings to make changes.';
let previewHintTimer = null;

/** Says why a tap did nothing and nudges Back to settings, for 3 s; another
    tap restarts the 3 s. Focus stays put; screen readers hear it once a tap. */
function showPreviewHint() {
  var hint = document.getElementById('preview-hint');
  var back = document.getElementById('preview-back');
  // Emptied first, so a repeat tap is announced again (same text, new change).
  hint.textContent = '';
  back.classList.remove('nudge');
  requestAnimationFrame(() => {
    if (!previewing) return;
    hint.textContent = PREVIEW_HINT;
    hint.classList.add('visible');
    back.classList.add('nudge'); // re-added a frame later, so the pulse restarts
  });
  clearTimeout(previewHintTimer);
  previewHintTimer = setTimeout(hidePreviewHint, 3000);
}

function hidePreviewHint() {
  clearTimeout(previewHintTimer);
  previewHintTimer = null;
  var hint = document.getElementById('preview-hint');
  hint.classList.remove('visible');
  hint.textContent = '';
  document.getElementById('preview-back').classList.remove('nudge');
}

/** Haptics only work on Android. Elsewhere the setting stays in view, greyed
    out with the reason, so nobody hunts for a switch that can't work. */
function showHapticsAvailability() {
  if (platform.isAndroid) return;
  document.getElementById('haptics-section').classList.add('s-unavailable');
  document.querySelector('.s-switch[data-switch="haptics"]').disabled = true;
  document.getElementById('haptics-hint').textContent = platform.isIOS
    ? "Not available on iPhone or iPad. Apple doesn't let web apps vibrate."
    : 'Not available on this device. Only Android phones and tablets can vibrate.';
}

/* ── Keep settings inside what's visible ──────────────────────────────
   iOS Safari doesn't shrink the page for the on-screen keyboard: a panel
   pinned top to bottom runs on under it, with Apply hidden and, sideways,
   the header scrolled away. While settings is open the panel follows the
   visual viewport instead, and anything 420px tall or less (a phone on its
   side, forced sideways, or the keyboard up) gets the one-row header. */
const SHORT_PANEL_PX = 420;

function fitSettingsPanel() {
  var panel = document.getElementById('settings-panel');
  var vv = window.visualViewport;
  var forced = /force-landscape/.test(document.documentElement.className);
  var squeezed = settingsOpen && vv && !forced && (vv.height < window.innerHeight - 1 || vv.offsetTop > 0);
  // The panel still reaches the bottom of the page (so nothing shows between
  // it and the keyboard); padding ends its contents at the keyboard's top.
  panel.style.top = squeezed ? vv.offsetTop + 'px' : '';
  panel.style.paddingBottom = squeezed ? Math.max(0, window.innerHeight - vv.offsetTop - vv.height) + 'px' : '';
  panel.scrollTop = 0; // the panel never scrolls, only its body
  // offsetHeight is the panel's own height, which forced sideways is the
  // screen's visual height, not its rotated box. With the keyboard up, the
  // part above the keyboard is what counts.
  var visibleHeight = squeezed ? vv.height : panel.offsetHeight;
  panel.classList.toggle('short-panel', settingsOpen && visibleHeight > 0 && visibleHeight <= SHORT_PANEL_PX);
  // The field being typed in stays in view above the keyboard: scrolled
  // within the list only (scrollIntoView also moved the panel, header and all).
  var f = document.activeElement, body = document.getElementById('settings-body');
  if (squeezed && f && body.contains(f)) {
    var fr = f.getBoundingClientRect(), br = body.getBoundingClientRect();
    if (fr.bottom > br.bottom) body.scrollTop += fr.bottom - br.bottom + 8;
    else if (fr.top < br.top) body.scrollTop -= br.top - fr.top + 8;
  }
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', fitSettingsPanel);
  visualViewport.addEventListener('scroll', fitSettingsPanel);
}
window.addEventListener('resize', fitSettingsPanel);

/** Add a build code to the version line ("v7.17.0 · 1a2b3c4d"): a hash of
    the app's own script and styles, so two copies of the same version can be
    told apart. Worked out in the page because the offline cache (which also
    carries a hash) doesn't exist on a plain-http address, such as a phone
    testing against a computer on the same Wi-Fi. FNV-1a: tiny, and enough to
    tell builds apart; not a security hash. */
function showBuildCode() {
  var el = document.getElementById('settings-version');
  if (!el) return;
  if (!showBuildCode.code) {
    var text = '';
    document.querySelectorAll('script:not([src]), style').forEach(function(n) { text += n.textContent; });
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    showBuildCode.code = ('0000000' + h.toString(16)).slice(-8);
  }
  el.textContent = el.textContent.split(' · ')[0] + ' · ' + showBuildCode.code;
}

/** "Made by …" under the version, when the profile names a maker (the
    default build does; a branded build may not). When the maker is the
    one the brand kit's block names, the block shows instead of the line:
    the words above the logo. MonoRadio and High Contrast keep the line,
    since the logo is in colour and its bands miss High Contrast's bar.
    textContent only. */
function showCredit() {
  var el = document.getElementById('settings-credit');
  var block = document.getElementById('settings-made-by');
  if (!el || !block) return;
  var maker = typeof PROFILE.madeBy === 'string' ? PROFILE.madeBy.trim() : '';
  var line = maker ? 'Made by ' + maker : '';
  var named = block.firstElementChild ? block.firstElementChild.getAttribute('aria-label') : '';
  var logo = !!line && named === line && !/theme-(mono|contrast)/.test(document.documentElement.className);
  el.textContent = line;
  el.hidden = !line || logo;
  block.hidden = !logo;
}

/* True while settings syncs to cfg without anyone having changed anything. */
let quietSync = false;
function canFlash() { return settingsOpen && !quietSync; }

/** Where each preset-owned setting lives on the panel, to point at it. */
function settingBlock(field) {
  var sw = document.querySelector('.s-switch[data-switch="' + field + '"]');
  if (sw) return sw.closest('.s-section');
  return document.getElementById({ theme: 'theme-section', size: 'size-section', advanced: 'controls-section', fillview: 'view-section' }[field]);
}

/** Sync every settings control (chips, switches, theme) to cfg. */
function syncChips() {
  ['size', 'fillview', 'advanced', 'orientation'].forEach(g => {
    document.querySelectorAll('.chip[data-group="' + g + '"]').forEach(c => {
      var isSelected = c.dataset.val === cfg[g];
      c.classList.toggle('selected', isSelected);
      c.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
  });
  document.querySelectorAll('.s-switch').forEach(function(sw) {
    // A greyed-out switch shows off: "on" there would be a promise it can't keep.
    sw.setAttribute('aria-checked', !sw.disabled && cfg[sw.dataset.switch] === 'on' ? 'true' : 'false');
  });
  syncThemePicker();
  syncControlsHint();
  syncPresetSelection();
}

/* ── Theme: family + mode ─────────────────────────────────────────────
   The picker shows a theme as a family (Classic, MonoRadio, High Contrast,
   Night) and a mode (Dark, Light, Auto). cfg.theme keeps its old values;
   these two functions are the only translation between the two. */
const THEME_FAMILY_PREFIX = { default: '', mono: 'mono-', contrast: 'contrast-' };

function themeParts(theme) {
  if (theme === 'night') return { family: 'night', mode: null };
  var m = /^(mono-|contrast-)?(dark|light|auto)$/.exec(theme || '');
  if (!m) return { family: 'default', mode: 'dark' };
  return { family: m[1] ? m[1].slice(0, -1) : 'default', mode: m[2] };
}

function themeFromParts(family, mode) {
  if (family === 'night') return 'night';
  return (THEME_FAMILY_PREFIX[family] || '') + (mode || 'auto');
}

/* Night has no mode; switching back from it restores the last one picked. */
let lastThemeMode = 'auto';

function selectThemeFamily(family) {
  var parts = themeParts(cfg.theme);
  if (parts.mode) lastThemeMode = parts.mode;
  setTheme(themeFromParts(family, parts.mode || lastThemeMode));
}

function selectThemeMode(mode) {
  var parts = themeParts(cfg.theme);
  if (parts.family === 'night') return;
  lastThemeMode = mode;
  setTheme(themeFromParts(parts.family, mode));
}

function setTheme(theme) {
  cfg.theme = theme;
  fadeTheme();
  applyTheme();
  syncChips();
}

/** Cross-fade the colours for a moment while the theme changes. */
function fadeTheme() {
  if (!canFlash()) return;
  var root = document.documentElement;
  root.classList.add('theme-fading');
  clearTimeout(fadeTheme._t);
  fadeTheme._t = setTimeout(function() { root.classList.remove('theme-fading'); }, 300);
}

function syncThemePicker() {
  var parts = themeParts(cfg.theme);
  var modes = document.querySelector('.theme-modes');
  var wasNight = modes.dataset.night === 'true';
  modes.dataset.night = String(parts.family === 'night');
  document.querySelectorAll('.theme-swatch').forEach(function(b) {
    b.setAttribute('aria-checked', b.dataset.family === parts.family ? 'true' : 'false');
  });
  document.querySelectorAll('.theme-modes .chip').forEach(function(b) {
    var sel = b.dataset.mode === parts.mode;
    b.disabled = parts.family === 'night';
    b.classList.toggle('selected', sel);
    b.setAttribute('aria-checked', sel ? 'true' : 'false');
  });
  setHint(document.getElementById('theme-hint'), parts.family === 'night'
    ? 'Night is always dim and warm, for a bedside.'
    : 'Auto follows the device: light or dark, and High Contrast when it asks for more contrast.');
  // Night turns Dark/Light/Auto off: point at them so that isn't a mystery.
  if (wasNight !== (parts.family === 'night') && canFlash()) flashChanged(modes);
}

/** Rewrite a hint, pointing at it when its words change. */
function setHint(el, text) {
  if (el.textContent === text) return;
  var had = el.textContent !== '';
  el.textContent = text;
  if (had && canFlash()) flashChanged(el);
}

function syncControlsHint() {
  setHint(document.getElementById('controls-hint'), cfg.advanced === 'on'
    ? 'Pause, Stop and a sleep timer. Skip shows only for recordings, never live radio.'
    : 'One Stop button. Tap a station to start it again.');
}

/** Flip an on/off setting from its switch. */
function toggleSwitch(sw) {
  if (sw.disabled) return;
  var group = sw.dataset.switch;
  // Hiding the way into settings asks for the other way in first. Not on a
  // radio saved with it hidden: whoever is here came in by the logo.
  if (group === 'settingsButton' && cfg.settingsButton === 'on' && cfgSnapshot && cfgSnapshot.settingsButton === 'on') {
    openHidePractice(sw);
    return;
  }
  cfg[group] = cfg[group] === 'on' ? 'off' : 'on';
  syncChips();
  applyAccessOptions();
}

/* Practising the way back in, before the Settings button is hidden. The
   taps count as they do on the header's logo (22-pin.js): five, with no
   gap of two seconds between them. */
let hideTapCount = 0;
let hideTapTimer = null;

function openHidePractice(sw) {
  var overlay = document.getElementById('hide-overlay');
  var logo = document.getElementById('logo-svg'), copy = document.getElementById('hide-practice-logo');
  copy.innerHTML = logo.innerHTML;
  copy.setAttribute('viewBox', logo.getAttribute('viewBox'));
  document.getElementById('hide-practice-name').textContent = cfg.orgName.replace(/\n/g, ' ');
  document.getElementById('hide-status').textContent = '';
  document.getElementById('hide-done').hidden = true;
  hideTapCount = 0;
  clearTimeout(hideTapTimer);
  showOverlay(overlay);
  overlay._returnFocus = sw; // Safari doesn't focus a tapped button, so name the switch
}

function hidePracticeTap() {
  hideTapCount++;
  clearTimeout(hideTapTimer);
  hideTapTimer = setTimeout(() => { hideTapCount = 0; }, 2000);
  if (hideTapCount < 5) return;
  hideTapCount = 0;
  clearTimeout(hideTapTimer);
  var done = document.getElementById('hide-done');
  if (!done.hidden) return; // already passed: say it once
  document.getElementById('hide-status').textContent = 'Got it.';
  done.hidden = false;
  done.focus();
}

function cancelHide() {
  clearTimeout(hideTapTimer);
  hideOverlay(document.getElementById('hide-overlay'));
}

/** Done, after the practice passed: now the switch goes off. */
function finishHide() {
  if (document.getElementById('hide-done').hidden) return;
  hideOverlay(document.getElementById('hide-overlay'));
  cfg.settingsButton = 'off';
  syncChips();
  applyAccessOptions();
}

/** Handle a chip selection — update config, aria state, and apply visual changes. */
function selectChip(el, group, val) {
  cfg[group] = val;

  document.querySelectorAll('.chip[data-group="' + group + '"]').forEach(c => {
    c.classList.remove('selected');
    c.setAttribute('aria-checked', 'false');
  });
  el.classList.add('selected');
  el.setAttribute('aria-checked', 'true');

  if (group === 'size' || group === 'fillview' || group === 'orientation') applyTheme();
  if (group === 'advanced') { updateMode(); syncControlsHint(); }

  // Touching any preset-owned control may diverge from the active preset's
  // bundle; recompute so the preset chip highlight stays truthful ('custom'
  // when nothing matches). Presets are a starting point, not a lock.
  if (PRESET_FIELDS.includes(group)) syncPresetSelection();
}


