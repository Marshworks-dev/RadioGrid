/* ================================================================
   PIN SYSTEM
   Protects settings access. Tap the logo 5 times within 2 seconds
   to trigger the PIN overlay. Locks out after 5 failed attempts
   with an escalating delay (5s increments, max 30s).
   ================================================================ */

const PIN_DEFAULT = PROFILE.pin;
let tapCount = 0;
let tapTimer = null;
let pinEntry = '';
let pinFailCount = 0;
let pinLocked = false;
let pinResetTimer = null; // pending lockout tick — cancelled before each new one so a stale tick can't wipe a later message
let pinWrongShown = false; // "Incorrect PIN" stays up until the next key press

const pinOverlay = document.getElementById('pin-overlay');
const pinDots = document.querySelectorAll('.pin-dot');
const pinErrorEl = document.getElementById('pin-error');
const pinStatusEl = document.getElementById('pin-status');
const pinWaitEl = document.getElementById('pin-wait');

/**
 * One-time self-heal for legacy/corrupt PINs. The unlock pad is fixed at 4
 * digits, so a stored PIN that isn't exactly 4 digits can never be entered —
 * a device in that state is locked out of settings permanently. Drop any such
 * value so the device falls back to the profile default (a 4-digit PIN or
 * none) instead of being bricked. A deliberately-empty PIN ('') is left alone.
 */
function sanitizeStoredPin() {
  try {
    var stored = localStorage.getItem('rgxl_pin');
    if (stored && !/^\d{4}$/.test(stored)) localStorage.removeItem('rgxl_pin');
  } catch (e) {
    /* storage unavailable — nothing to heal */
  }
}

/**
 * Get the current PIN. A stored value takes precedence — including an empty
 * string, which means the technician deliberately disabled the PIN. Only fall
 * back to the profile default when nothing has been stored at all (fresh
 * install). Using `|| PIN_DEFAULT` here would be a bug: '' is falsy, so a
 * cleared PIN on a branded profile with a default PIN would silently
 * snap back to the default and could never be turned off.
 */
function getPin() {
  try {
    const stored = localStorage.getItem('rgxl_pin');
    return stored !== null ? stored : PIN_DEFAULT;
  } catch (e) {
    return PIN_DEFAULT;
  }
}

/** Save a new PIN to LocalStorage. Returns false when storage refuses. */
function setPin(v) {
  try {
    localStorage.setItem('rgxl_pin', v);
    return true;
  } catch (e) {
    console.error('[settings] could not save rgxl_pin:', e && e.name, e && e.message);
    return false;
  }
}

// Logo tap counter — 5 taps within 2 seconds opens the PIN overlay. Only
// while the Settings button is hidden: next to a visible button, a second,
// secret way in would be a hidden feature.
document.getElementById('logo-area').addEventListener('click', function (e) {
  e.stopPropagation();
  if (settingsButtonShown()) return;
  tapCount++;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => { tapCount = 0; }, 2000);

  if (tapCount >= 5) {
    tapCount = 0;
    clearTimeout(tapTimer);
    requestSettings();
  }
});

/** The way into settings, from the logo or the Settings button: through
    the PIN pad (and its lockout) whenever a PIN is set. */
function requestSettings() {
  if (getPin()) { showPinOverlay(); } else { openSettings(); }
}

// Also allow Enter/Space on logo area for keyboard users
document.getElementById('logo-area').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    this.click();
  }
});

/** Show the PIN entry overlay with a fresh state. */
function showPinOverlay() {
  pinEntry = '';
  pinStatusEl.textContent = '';
  pinDots.forEach(d => d.classList.remove('filled'));
  // A lockout keeps running (and showing) if the pad is closed and reopened.
  if (!pinLocked) clearPinError();
  showOverlay(pinOverlay);
  // The title, not the 1 key, so VoiceOver reads the dialog's name on open
  // (runs after showOverlay's own first-button focus in the same frame).
  requestAnimationFrame(() => { if (pinOverlay.classList.contains('visible')) document.getElementById('pin-overlay-title').focus(); });
  restartPinIdle();
}

/** Clear "Incorrect PIN" and the red dots. */
function clearPinError() {
  pinWrongShown = false;
  // Only touch the alert when it has text: VoiceOver speaks any rewrite of an
  // assertive region, and a blank one drowns out the dialog's own name.
  if (pinErrorEl.textContent !== '') pinErrorEl.textContent = '';
  pinDots.forEach(d => d.classList.remove('wrong'));
}

/** Turn the digit keys off during a lockout, on after. Cancel stays on. */
function setPinKeysEnabled(on) {
  document.querySelectorAll('#pin-pad .pin-key').forEach(function(k) {
    if (!k.classList.contains('pin-key-wide')) k.disabled = !on;
  });
}

/** Lock the pad for `sec` seconds, counting down on screen each second. */
function startPinLockout(sec) {
  pinLocked = true;
  setPinKeysEnabled(false);
  pinErrorEl.textContent = 'Too many attempts';
  pinStatusEl.textContent = 'Wait ' + sec + ' seconds, then try again.';
  pinWaitEl.hidden = false;
  (function tick(left) {
    if (left <= 0) {
      pinLocked = false;
      setPinKeysEnabled(true);
      pinWaitEl.hidden = true;
      pinWaitEl.textContent = '';
      pinEntry = '';
      clearPinError();
      pinStatusEl.textContent = 'You can try again now.';
      return;
    }
    pinWaitEl.textContent = 'Try again in ' + left + ' s';
    pinResetTimer = setTimeout(function() { tick(left - 1); }, 1000);
  })(sec);
}

/** Show or mask the PIN in settings. It opens masked every time. */
function setPinShown(shown) {
  document.getElementById('in-pin').classList.toggle('pin-masked', !shown);
  var btn = document.getElementById('pin-show');
  btn.textContent = shown ? 'Hide' : 'Show';
  btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
}
function togglePinShown() {
  setPinShown(document.getElementById('in-pin').classList.contains('pin-masked'));
}

/** Handle a PIN digit press. Validates after 4 digits are entered. */
function pinKey(n) {
  if (pinLocked || pinEntry.length >= 4) return;
  if (pinWrongShown) clearPinError();

  pinEntry += n;
  pinDots[pinEntry.length - 1].classList.add('filled');
  // Announce digit count to screen readers without revealing digits
  pinStatusEl.textContent = pinEntry.length + ' of 4 digits entered';

  if (pinEntry.length === 4) {
    setTimeout(() => {
      if (pinEntry === getPin()) {
        // Correct PIN — open settings
        hideOverlay(pinOverlay);
        pinEntry = '';
        pinFailCount = 0;
        openSettings();
      } else {
        // Wrong PIN
        pinFailCount++;
        pinDots.forEach(d => { d.classList.remove('filled'); d.classList.add('wrong'); });
        // Cancel any prior attempt's pending banner-clear so it can't fire on
        // top of this attempt's message (the lockout banner was being wiped by
        // an earlier 800ms timer during rapid failures).
        clearTimeout(pinResetTimer);

        pinEntry = '';
        if (pinFailCount >= 5) {
          // Lockout: escalating delay (5s per failure, capped at 30s)
          startPinLockout(Math.min(30, pinFailCount * 5));
        } else {
          // Stays until the next key press: gone after 0.8 s, it was easy
          // to miss, and the pad looked as if it had ignored the PIN.
          pinErrorEl.textContent = 'Incorrect PIN — try again';
          pinWrongShown = true;
        }
      }
    }, 200);
  }
}

/** Delete the last entered PIN digit. */
function pinBackspace() {
  if (pinEntry.length === 0) return;
  pinDots[pinEntry.length - 1].classList.remove('filled');
  pinEntry = pinEntry.slice(0, -1);
  if (!pinLocked) clearPinError();
  pinStatusEl.textContent = pinEntry.length + ' of 4 digits entered';
}

/** Cancel PIN entry and close the overlay. */
function pinCancel() {
  hideOverlay(pinOverlay);
  pinEntry = '';
}


