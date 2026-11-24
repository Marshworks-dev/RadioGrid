/* ================================================================
   INITIALIZATION
   Runs once on page load. Loads saved settings, applies the theme,
   renders stream buttons, and sets up platform-specific overrides.
   ================================================================ */

function init() {
  // Inject profile logo into the SVG element
  if (PROFILE.logoSvg) {
    var svg = document.getElementById('logo-svg');
    svg.innerHTML = PROFILE.logoSvg;
    if (PROFILE.logoViewBox) svg.setAttribute('viewBox', PROFILE.logoViewBox);
  }

  document.getElementById('help-section').hidden = !helpAvailable();
  document.getElementById('backup-section').hidden = !backupAvailable();
  showFeedbackCard();
  showHapticsAvailability();
  if (movedTo()) showMovedCard(movedTo());

  // The Device buttons need the APK's bridge (see openDeviceSettings). A
  // phone or tablet browser gets a pointer to its Settings app instead, and
  // a desktop browser gets neither.
  const hasBridge = !!window.AndroidBridge;
  document.getElementById('device-section').hidden = !hasBridge && platform.isDesktop;
  document.getElementById('device-buttons').hidden = !hasBridge;
  document.getElementById('device-hint-web').hidden = hasBridge;
  document.getElementById('voice-hint').textContent = voiceSettingsHint(hasBridge);

  sanitizeStoredPin();
  loadSettings();
  applyTheme();
  applyOrgName();
  renderButtons();
  updateMode();

  // Apply max volume cap
  audio.volume = cfg.volume / 100;
  showVolume();

  // Desktop-specific adjustments. (There is no longer a volume overlay — the
  // volume control lives in Settings — so don't reference the removed
  // #vol-overlay-body element here; doing so threw and aborted init on desktop.)
  if (platform.isDesktop) {
    document.getElementById('nonet-overlay-body').textContent =
      'Please check your network connection, or try again in a moment.';
  }

// Re-apply theme when system dark/light preference changes (for "auto" mode).
  // No fade (snapTheme), and Safari is told to re-read its bar colours
  // (retintSafariBars): it kept the old theme's until something else did.
  function followSystemTheme() {
    if (!cfg.theme.endsWith('auto')) return;
    applyTheme();
    snapTheme();
    retintSafariBars();
  }
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', followSystemTheme);
  window.matchMedia('(prefers-contrast: more)').addEventListener('change', followSystemTheme);
  // Safari's first read can come before the bottom bar is drawn.
  retintSafariBars();

  // Sync initial aria-checked state for settings chips
  syncChips();

  // Register lock-screen / notification media controls. No-op on the bare
  // WebView (no mediaSession) and any platform missing the API.
  registerMediaSessionHandlers();

  // Auto-resume the station that was playing when the app closed (opt-in via
  // cfg.resume). Reads the separate 'rgxl_last' key; only resumes if that id
  // still exists in the current streams. Stale/removed ids do nothing — stay
  // stopped, no error.
  // Fully guarded so a storage failure or absent key never aborts init().
  maybeAutoResume();

  // Re-layout buttons on resize (orientation change, Safari toolbar show/hide)
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() { renderButtons(); fitSimpleStopLabel(); }, 100);
  });
}

/**
 * Auto-resume, on launch and if opted in, the station that was playing when
 * the app closed (see rememberLastStation).
 * No-op unless cfg.resume === 'on'. Reads the top-level 'rgxl_last' key and
 * only starts playback when that id still resolves to a current stream. A
 * missing, stale, or removed id is silently ignored (boots stopped). Returns
 * the targeted id (for testability) or null. Never throws.
 */
function maybeAutoResume() {
  try {
    // Checked first so the flag is always used up. An update reload runs only
    // while nothing plays, so it forgets the station too (see APP UPDATES).
    if (isUpdateReload()) { forgetLastStation(); return null; }
    // The moved build at the old address never plays (24-moved.js).
    if (movedTo()) return null;
    // Resume is off, so nothing plays now: forget the station too, or turning
    // Resume on later would restart it at a launch it wasn't playing before.
    if (cfg.resume !== 'on') { forgetLastStation(); return null; }
    var last = localStorage.getItem('rgxl_last');
    if (!last) return null;
    if (!cfg.streams.some(function(s) { return s.id === last; })) return null;
    playStream(last); // if autoplay policy blocks it, playActive() shows "tap to resume"
    return last;
  } catch (e) {
    /* Storage unavailable or playback failed — stay stopped, never throw */
    return null;
  }
}


