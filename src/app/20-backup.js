/* ================================================================
   BACKUP / RESTORE
   Export the full config (rgxl_cfg fields + PIN) to a JSON file and
   re-import it on this or another device. Imported files are
   UNTRUSTED: every field is run through validateConfig() (the same
   allowlist loadSettings() uses) before anything is applied, and the
   PIN must match the existing 4-digit-or-empty rule. A bad file is
   rejected with a clear message and never corrupts the live config.
   ================================================================ */

/** The status line's opening hint, kept so a new export or import can put
 * it back instead of leaving the last result on screen. */
var backupHint = null;

/** Small status line under the Backup buttons. */
function setBackupStatus(msg, isError) {
  var el = document.getElementById('backup-status');
  if (!el) return;
  if (backupHint === null) backupHint = el.textContent;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger, #e66)' : '';
}

/** Back to the opening hint while the share sheet or picker is up, so an
 * earlier "Backup saved." isn't read as this attempt's result. */
function clearBackupStatus() {
  if (backupHint !== null) setBackupStatus(backupHint, false);
}

/** Serialize the current config (same field list as saveSettings) + PIN. */
/**
 * Build the backup object written to the export file. Mirrors the exact field
 * list saveSettings() persists (so a backup is a complete config), plus `pin`
 * ONLY when includePin is true. PIN export is opt-in (a checkbox, default off)
 * because the file travels off-device and the PIN unlocks settings — see the
 * Backup section UI. Pure + side-effect-free so a test can assert the real
 * exported field set without invoking the browser download path. */
function buildBackupPayload(includePin) {
  var backup = {
    v: CFG_VERSION,
    orgName: cfg.orgName,
    theme: cfg.theme,
    size: cfg.size,
    fillview: cfg.fillview,
    volume: cfg.volume,
    advanced: cfg.advanced,
    haptics: cfg.haptics,
    tts: cfg.tts,
    chime: cfg.chime,
    resume: cfg.resume,
    zoom: cfg.zoom,
    settingsButton: cfg.settingsButton,
    preset: cfg.preset,
    orientation: cfg.orientation,
    streams: cfg.streams
  };
  if (includePin) backup.pin = getPin();
  return backup;
}

/** The iOS app's native save/open bridge (ios/App/App/BackupPlugin.swift),
 * or null on the website and the Android APK. Capacitor injects it before
 * this script runs, so the page itself stays free of any Capacitor code. */
function nativeBackup() {
  var cap = window.Capacitor;
  return (cap && cap.Plugins && cap.Plugins.Backup) || null;
}

/** Backup needs a browser that can save a download and open a file
 * picker, or the iOS app's native bridge. The Android WebView APK
 * (file://) has neither, and it used to report success while saving
 * nothing, so the section is hidden there. */
function backupAvailable() {
  return /^https?:$/.test(location.protocol) || !!nativeBackup();
}

function exportConfig() {
  if (!settingsOpen || !backupAvailable()) return;
  try {
    var pinBox = document.getElementById('in-backup-pin');
    var includePin = !!(pinBox && pinBox.checked);
    var backup = buildBackupPayload(includePin);
    var native = nativeBackup();
    if (native) {
      // The share sheet answers once the person saves, sends or cancels, so
      // the app can say what happened rather than "ready to save". Copy and
      // AirDrop finish too, so only Save to Files is called "saved".
      clearBackupStatus();
      native.save({ text: JSON.stringify(backup, null, 2) }).then(function(result) {
        if (result && result.saved) {
          var done = result.toFiles ? 'Backup saved' : 'Backup sent';
          setBackupStatus(includePin ? done + ' (includes PIN — store it securely).' : done + '.', false);
        } else {
          setBackupStatus('Backup not saved.', false);
        }
      }, function() {
        setBackupStatus('Could not export backup on this device.', true);
      });
      return;
    }
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'radiogridxl-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick so the download has a chance to start first.
    setTimeout(function() { URL.revokeObjectURL(url); }, 0);
    // "Ready to save", not "exported": the phone may still be asking where
    // to save it, or the person may cancel.
    setBackupStatus(includePin ? 'Backup ready to save (includes PIN — store it securely).' : 'Backup ready to save.', false);
  } catch (e) {
    setBackupStatus('Could not export backup on this device.', true);
  }
}

/**
 * Apply a parsed, already-validated backup object to the live config and
 * persist it. `sanitized` is the output of validateConfig(); `pin` is the raw
 * PIN value from the file (may be undefined). Returns false, with the live
 * config left as it was, when storage refuses the save; the caller has
 * already decided the input is acceptable. Returns 'pin-not-saved' when the
 * config saved but storage refused the backup's PIN, so the device's PIN is
 * unchanged; true when everything saved.
 */
function applyImportedConfig(sanitized, pin) {
  // Stop playback before swapping streams out from under it.
  stopPlayback();

  const before = JSON.parse(JSON.stringify(cfg));
  // A backup with no Settings button in it came from a radio whose settings
  // were behind the logo; it restores that way, as loadSettings() reads it.
  cfg.settingsButton = 'off';
  Object.assign(cfg, sanitized);
  cfg.preset = matchingPresetName(); // a backup's preset name is a hint, like storage's
  const wasNewer = storedConfigIsNewer;
  storedConfigIsNewer = false; // restoring a backup is a choice to replace what's stored
  if (!saveSettings()) {
    // Nothing reached storage: put the live config back, so what's on screen
    // is what the next launch loads.
    Object.assign(cfg, before);
    storedConfigIsNewer = wasNewer;
    return false;
  }

  // PIN: only apply when present and conforming (4 digits or empty=disabled).
  // Anything else is ignored so the current PIN is preserved. Set after the
  // config saved, so a failed restore never changes the PIN alone. If storage
  // refuses the PIN, the config stays restored and the caller says so.
  let pinSaved = true;
  if (typeof pin === 'string' && (pin === '' || /^\d{4}$/.test(pin))) {
    pinSaved = setPin(pin);
  }

  // Reflect the restored config live across the whole UI.
  loadSettings();      // re-read from storage so cfg + storage are authoritative
  applyOrgName();
  applyTheme();
  updateMode();
  renderButtons();
  updateSimpleStop();
  updateAdvTransport();
  syncChips();
  if (!fadeTimer) audio.volume = targetVolume();

  // If the settings panel is open, refresh its live inputs too.
  showVolume();
  document.getElementById('in-org-name').value = cfg.orgName;
  // The field must hold the PIN now in force (the device's, or the one the
  // backup just restored). A blank field here made the next Apply remove it.
  document.getElementById('in-pin').value = getPin();
  if (typeof renderStreamEditor === 'function') renderStreamEditor();

  // A successful import replaces the snapshot baseline so closeSettings()
  // won't revert the freshly-restored config. Read the editor back first: it
  // fills in fields a backup may omit (sub, emoji), and a baseline without them
  // made an untouched close ask "Discard Changes?".
  if (typeof readStreamEditor === 'function') readStreamEditor();
  cfgSnapshot = JSON.parse(JSON.stringify(cfg));
  return pinSaved ? true : 'pin-not-saved';
}

/** Import Backup: the iOS app's Files picker, or the web file input. */
function chooseBackupFile() {
  if (!settingsOpen || !backupAvailable()) return;
  var native = nativeBackup();
  if (!native) {
    document.getElementById('import-file').click();
    return;
  }
  clearBackupStatus();
  native.open().then(function(result) {
    // Settings may have timed out while the picker was up; a restore then
    // would change the radio with nobody looking at it.
    if (!settingsOpen || !result || result.cancelled) return;
    if (result.tooLarge || typeof result.text !== 'string') {
      setBackupStatus('That file is not a RadioGridXL backup. Nothing was changed.', true);
      return;
    }
    importBackupText(result.text);
  }, function() {
    setBackupStatus('Could not read that file. Nothing was changed.', true);
  });
}

/** Handle a chosen backup file from the web file input: read, then import. */
function importConfig(event) {
  if (!settingsOpen || !backupAvailable()) return;
  var input = event && event.target;
  var file = input && input.files && input.files[0];
  if (!file) return;

  var reader = new FileReader();
  reader.onload = function() {
    importBackupText(reader.result);
    input.value = '';  // allow re-importing the same file later
  };
  reader.onerror = function() {
    setBackupStatus('Could not read that file. Nothing was changed.', true);
    input.value = '';
  };
  reader.readAsText(file);
}

/** Parse, validate and apply a backup's text. Both import paths end here. */
function importBackupText(text) {
  var parsed;
  try {
    // Some editors (Windows Notepad) save a byte-order mark. The web file
    // reader drops it; the native picker hands it over as the first character.
    if (typeof text === 'string' && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    parsed = JSON.parse(text);
  } catch (e) {
    setBackupStatus('That file is not valid JSON. Nothing was changed.', true);
    return;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    setBackupStatus('That file is not a RadioGridXL backup. Nothing was changed.', true);
    return;
  }

  // A newer version's backup may use fields this version doesn't know;
  // applying the rest would half-restore it without a word.
  if (typeof parsed.v === 'number' && parsed.v > CFG_VERSION) {
    setBackupStatus('This backup is from a newer version of RadioGridXL. Update the app first. Nothing was changed.', true);
    return;
  }

  // UNTRUSTED input — run through the shared allowlist. validateConfig()
  // returns only the fields that pass; it never throws and never mass-assigns.
  var sanitized = validateConfig(parsed);

  // A backup with zero recognizable settings is almost certainly the wrong
  // file. Reject rather than silently no-op against the live config.
  if (Object.keys(sanitized).length === 0) {
    setBackupStatus('No valid settings found in that file. Nothing was changed.', true);
    return;
  }

  var restored;
  try {
    restored = applyImportedConfig(sanitized, parsed.pin);
    if (!restored) {
      setBackupStatus("Couldn't save on this device, so nothing was changed.", true);
      return;
    }
  } catch (e) {
    // validateConfig() should make this unreachable; if it isn't, say so
    // rather than leave the technician looking at a silent half-restore.
    console.error('[backup] restore failed:', e);
    setBackupStatus("Couldn't finish restoring that backup. Check the settings before you close.", true);
    return;
  }
  // A technician restoring a backup to set a new PIN must not leave
  // believing it took when storage refused it.
  if (restored === 'pin-not-saved') {
    setBackupStatus("Backup restored, but the PIN couldn't be saved on this device. The PIN hasn't changed.", true);
  } else {
    setBackupStatus('Backup restored.', false);
  }
}
