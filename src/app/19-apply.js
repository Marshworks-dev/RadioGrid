/* ================================================================
   APPLY SETTINGS
   Called when the technician presses "Apply & Close". Validates
   stream data, saves everything, and refreshes the UI.
   ================================================================ */

/**
 * Validate that a stream URL uses http or https.
 * Rejects javascript:, data:, and other potentially dangerous schemes.
 */
function isValidStreamUrl(url) {
  if (!url) return true; // Empty URL is allowed (stream just won't play)
  return /^https?:\/\//i.test(url.trim());
}

/* True when the page is served over HTTPS but the stream is plain http:// —
   browsers block this as mixed content and the <audio> element fails silently.
   Only bites the hosted demo; the file:// APK is exempt, so gate on protocol. */
function isMixedContentUrl(url) {
  return location.protocol === 'https:' && /^http:\/\//i.test((url || '').trim());
}

/** Toggle the per-stream mixed-content warning as the URL field is edited. */
function updateUrlWarning(idx) {
  const input = document.querySelector('#stream-editor .s-input[data-field="url"][data-idx="' + idx + '"]');
  const warn = document.querySelector('#stream-editor .url-warn[data-warn-idx="' + idx + '"]');
  if (!input || !warn) return;
  warn.style.display = isMixedContentUrl(input.value) ? 'block' : 'none';
  showUrlError(idx, '');
}

/** What's wrong with a station's address for Apply, or '' when it's fine.
    A blank or non-web address used to be blanked silently on Apply, leaving a
    station on the grid that fails when the listener taps it. */
function streamUrlProblem(url, num) {
  var u = (url || '').trim();
  if (!u) return 'Stream ' + num + ' has no web address. Add one, or remove the stream.';
  if (!isValidStreamUrl(u)) return "Stream " + num + "'s address has to start with https:// (or http://).";
  return '';
}

/** Show (or with '' clear) the error under stream idx's address field. */
function showUrlError(idx, msg) {
  var input = document.querySelector('#stream-editor .s-input[data-field="url"][data-idx="' + idx + '"]');
  var err = document.getElementById('url-err-' + idx);
  if (!input || !err) return;
  err.textContent = msg;
  err.hidden = !msg;
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}

/* Bounds for the optional per-stream gain trim. 1.0 = unchanged. Below 1
   attenuates, above 1 boosts. Range is deliberately narrow: a 0.1–4x multiplier
   covers normalizing quiet vs. loud stations without letting a typo blast or
   silence a stream. */
const GAIN_MIN = 0.1;
const GAIN_MAX = 4;

/**
 * Validate/normalize a per-stream gain value (UNTRUSTED — from storage, an
 * imported backup, or the editor field). Accepts a finite number (or a numeric
 * string) within [GAIN_MIN, GAIN_MAX]; treats 1 (or anything failing the check)
 * as "no trim" by returning null so the caller can omit the field. Never throws.
 * Mirrors isValidStreamUrl's posture: reject-and-fall-back, no mass-assignment.
 */
function sanitizeGain(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (typeof n !== 'number' || !isFinite(n)) return null;
  if (n < GAIN_MIN || n > GAIN_MAX) return null;
  if (n === 1) return null; // 1.0 is the default — store nothing
  return n;
}

function applySettings() {
  if (!settingsOpen) return;
  readStreamEditor();

  // Read org name (fall back to default if blank)
  var orgVal = document.getElementById('in-org-name').value.trim();
  cfg.orgName = orgVal || PROFILE.orgName;

  // Every station needs a web address before anything is saved. The first
  // problem is named above Apply and marked on its field, which gets focus.
  var firstBad = -1;
  cfg.streams.forEach((s, i) => {
    var msg = streamUrlProblem(s.url, i + 1);
    showUrlError(i, msg);
    if (msg && firstBad < 0) firstBad = i;
  });
  if (firstBad >= 0) {
    setApplyStatus(streamUrlProblem(cfg.streams[firstBad].url, firstBad + 1));
    openStream(firstBad);
    var badInput = document.querySelector('#stream-editor .s-input[data-field="url"][data-idx="' + firstBad + '"]');
    if (badInput) badInput.focus();
    return;
  }

  cfg.streams.forEach((s, i) => {
    if (!s.label.trim()) s.label = 'Stream ' + (i + 1);
    s.url = s.url.trim();
    // A new address gets a fresh try: "Not available" was about the old one.
    var before = cfgSnapshot && cfgSnapshot.streams.find(o => o.id === s.id);
    if (before && before.url !== s.url) failedStreams.delete(s.id);
  });

  // Update PIN if changed — exactly 4 digits, or empty to disable.
  // The unlock pad is fixed at 4 digits, so any other length would lock the
  // technician out of settings entirely. Reject non-conforming input silently
  // (leaves the existing PIN untouched rather than saving an unenterable one).
  var newPin = document.getElementById('in-pin').value.replace(/\D/g, '');

  // Refresh the entire UI
  applyOrgName();
  applyTheme();
  updateMode();
  renderButtons();
  updateSimpleStop();
  updateAdvTransport();

  // Config first, then the PIN, so a failed save never leaves a new PIN
  // guarding old settings. If storage refuses, stay open and say so; the
  // snapshot stays, so closing still offers to discard back to what's saved.
  if (!saveSettings() || ((newPin === '' || newPin.length === 4) && !setPin(newPin))) {
    setApplyStatus(storedConfigIsNewer ? NEWER_CONFIG_MESSAGE : SAVE_FAILED_MESSAGE);
    return;
  }

  // Clear snapshot so closeSettings() won't revert
  cfgSnapshot = null;
  closeSettings();
}

const SAVE_FAILED_MESSAGE = "Couldn't save on this device, so these settings would be lost when the app restarts. Try Apply again, or close to discard them.";
const NEWER_CONFIG_MESSAGE = "These settings were saved by a newer version of RadioGrid, so this version won't change them. Update the app, or use Reset to Defaults to start over.";

/** The line above Apply & Close; an empty message hides it. */
function setApplyStatus(msg) {
  var el = document.getElementById('apply-status');
  el.hidden = !msg;
  el.textContent = msg || '';
}


