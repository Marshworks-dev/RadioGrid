/* ================================================================
   LOUDNESS LEVELING — per-stream volume trim
   Leveling is done per station via an optional `gain` multiplier on each stream
   (set in the stream editor, applied through targetVolume() by scaling
   audio.volume). This is CORS-immune: it never routes the element through Web
   Audio, so it works on any cross-origin stream. A global Web Audio compressor
   was tried and removed — MediaElementAudioSourceNode silences cross-origin
   streams that don't send CORS headers (most internet radio), with no thrown
   error to fall back on. See sanitizeGain() and targetVolume().
   ================================================================ */


/* ================================================================
   SLEEP TIMER
   Automatically stops playback after a set duration.
   Countdown is shown in the header's sleep indicator. A screen reader hears
   the listener's own taps once (set, cancelled) and nothing when the timer
   ends: that must not wake someone who has just fallen asleep.
   ================================================================ */

const SLEEP_STATUS_MS = 5000; // long enough for a screen reader to finish the line

function showSleepOverlay() {
  document.getElementById('sleep-cancel').hidden = !(sleepRemaining > 0);
  showOverlay(document.getElementById('sleep-overlay'));
}

function closeSleepOverlay() {
  hideOverlay(document.getElementById('sleep-overlay'));
}

/** Start a sleep timer for the given number of minutes. Pass 0 to cancel. */
function setSleep(minutes) {
  clearSleep();
  closeSleepOverlay();
  if (minutes <= 0) {
    confirmSleep('Sleep timer off.');
    return;
  }

  sleepRemaining = minutes * 60;
  updateSleepDisplay();
  sleepInd.classList.add('visible');
  confirmSleep('Sleep timer set for ' + durationText(minutes) + '.');

  sleepTick = setInterval(() => {
    sleepRemaining--;
    if (sleepRemaining <= 0) {
      clearSleep();
      // Silent to a screen reader too: no "Connection: idle" (see userStop()),
      // and no focus move, which a screen reader reads out like a tap. The
      // grid rebuild re-focuses a focused station, and closing the offline
      // overlay hands focus back, so give neither anything to restore.
      connQuiet = true;
      if (buttonsEl.contains(document.activeElement)) document.activeElement.blur();
      nonetOverlay._returnFocus = null;
      try { stopPlayback(); } finally { connQuiet = false; }
      return;
    }
    updateSleepDisplay();
  }, 1000);
}

/** Say `text` to a screen reader once, after the overlay has closed (a modal
    hides the rest of the page from it). Cleared a little later so a swipe
    through the header doesn't find a stale line, and so the timer ending has
    nothing left to change. Only the listener's own taps call this. */
function confirmSleep(text) {
  sleepStatus.textContent = text;
  clearTimeout(sleepStatusTimer);
  sleepStatusTimer = setTimeout(() => { sleepStatus.textContent = ''; }, SLEEP_STATUS_MS);
}

/** Cancel any active sleep timer and hide the indicator. */
function clearSleep() {
  clearInterval(sleepTick);
  sleepRemaining = 0;
  sleepInd.classList.remove('visible');
  sleepCountdown.textContent = '';
  sleepLeft.textContent = '';
}

/** "30 minutes", "2 hours", "1 hour 59 minutes". */
function durationText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [];
  if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'));
  if (m || !h) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
  return parts.join(' ');
}

/** Update the header's sleep countdown display. The visible seconds are
    hidden from screen readers; the sr-only line carries the time left in
    whole minutes, rounded up, so it changes once a minute, not every second. */
function updateSleepDisplay() {
  const m = Math.floor(sleepRemaining / 60);
  const s = sleepRemaining % 60;
  sleepCountdown.textContent = '💤 ' + m + ':' + (s < 10 ? '0' : '') + s;
  const left = 'Sleep timer, ' + durationText(Math.ceil(sleepRemaining / 60)) + ' left';
  if (sleepLeft.textContent !== left) sleepLeft.textContent = left;
}


/* ================================================================
   WAKE LOCK
   Keeps the tablet screen on while audio is playing.
   Automatically re-acquired when the app returns to the foreground.
   ================================================================ */

let wakeLockPending = false; // a request is in flight; don't start a second one

/** Hold one screen lock while audio plays. Every request() creates a separate
    lock and the screen stays on while any is held, so this never asks twice:
    an orphaned lock kept the screen on all night after the sleep timer. The
    request is async, so the state is checked again once it resolves. */
async function requestWakeLock() {
  if (wakeLock || wakeLockPending || !('wakeLock' in navigator)) return;
  wakeLockPending = true;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (!playing || paused) { sentinel.release(); return; } // paused or stopped meanwhile
    wakeLock = sentinel;
    sentinel.addEventListener('release', () => { if (wakeLock === sentinel) wakeLock = null; });
  } catch (e) {
    /* Wake lock not available or denied — non-critical */
  } finally {
    wakeLockPending = false;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Re-acquire wake lock when returning from background (OS may release it)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && playing && !paused) {
    requestWakeLock();
  }
});

// Network loss / restore. When Wi-Fi drops mid-playback, show the accessible
// connection-error overlay; when it returns, auto-recover the active stream.
// Only while actually playing: `playing` stays set through a pause (and the
// simple-mode Stop bar pauses), and a paused radio must stay silent.
window.addEventListener('offline', () => {
  if (playing && !paused) {
    setConnStatus('error');
    if (!nonetOverlay.classList.contains('visible')) showOverlay(nonetOverlay);
  }
});
window.addEventListener('online', () => {
  if (!nonetOverlay.classList.contains('visible')) return;
  if (playing && !paused) retryStream();
  else hideOverlay(nonetOverlay); // paused from the lock screen meanwhile: just clear it
});


/* ================================================================
   VOLUME — max app volume cap (all platforms)
   Scales the HTML5 audio element volume (0–1.0). Device hardware
   buttons still control system volume independently.
   ================================================================ */

function setVolume(val) {
  cfg.volume = parseInt(val, 10);
  // Don't fight an in-progress fade; otherwise apply the effective volume
  // (max × current stream's gain trim) immediately so the slider is live.
  if (!fadeTimer) audio.volume = targetVolume();
  showVolume();
}

/** Put cfg.volume on the slider, its label and its spoken value together:
    a value set without the spoken text left screen readers reading the old
    one (after a Discard) or a bare "100.0" (on open). */
function showVolume() {
  var slider = document.getElementById('vol-slider');
  slider.value = cfg.volume;
  slider.setAttribute('aria-valuetext', cfg.volume + ' percent');
  document.getElementById('vol-val').textContent = cfg.volume + '%';
}


