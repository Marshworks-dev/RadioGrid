/* ================================================================
   TRANSPORT MODE — simple vs. advanced
   Simple: full-width Stop button only.
   Advanced: adds skip back/forward, sleep timer, live badge.
   Configured by technician in settings.
   ================================================================ */

/** Show/hide the correct transport bar based on config. */
function updateMode() {
  const adv = cfg.advanced === 'on';
  simpleStop.style.display = adv ? 'none' : 'flex';
  document.getElementById('simple-stop-inset').hidden = adv;
  advTransport.classList.toggle('visible', adv);
  updateSkipButtons();
}

/** Skip is only available for finite-duration (non-live) streams. Live radio
    has no position to skip to; some engines still report a seekable range for
    it, and seeking there jumps past the live edge. */
function canSkip() {
  return !!playing && isFinite(audio.duration) && audio.duration > 0;
}

/** Show/hide skip buttons (in the app and on the lock screen) based on whether
    the stream can be skipped. */
function updateSkipButtons() {
  updateMediaSessionSkip();
  if (cfg.advanced !== 'on') return;

  const skipBackBtn = document.getElementById('adv-skip-back');
  const skipFwdBtn = document.getElementById('adv-skip-fwd');
  const liveBadge = document.getElementById('adv-live-badge');

  const skippable = canSkip();
  skipBackBtn.style.display = skippable ? '' : 'none';
  skipFwdBtn.style.display = skippable ? '' : 'none';
  // On a phone a recording's bar is taller (see the .skippable CSS), so the
  // grid is re-sized to the bar's new height, only when that changes.
  if (advTransport.classList.contains('skippable') !== skippable) {
    advTransport.classList.toggle('skippable', skippable);
    renderButtons();
  }
  // LIVE means live audio is coming in, so it hides while paused.
  liveBadge.classList.toggle('visible', !!playing && !paused && !skippable);
}

/** Update the Simple Stop bar. It always reads Stop and always stops; it is
    lit only while a station is on. A station paused from outside reads as
    off (its tile says "Tap to play"), so the bar looks idle then too, though
    a press still clears it to off. */
function updateSimpleStop() {
  const isOn = !!playing && !paused;
  const wasClass = simpleStop.className;
  simpleStop.classList.toggle('active', isOn);
  // The bar is the page's bottom edge, and Safari doesn't see it change colour.
  if (simpleStop.className !== wasClass) retintSafariBars(RETINT_SNAPPED_MS);
  // Enabled whenever a press does something: a station paused from outside
  // looks idle, but Stop still clears it to off (and says "Stopped").
  simpleStop.setAttribute('aria-disabled', playing ? 'false' : 'true');
  if (!isOn) clearStopPoint();
  fitSimpleStopLabel();
}

const STOP_LABEL_MIN_PX = 12;

/** The bar's height is fixed, so a name too long for two lines steps the
    label's font down until it fits. No-op without layout (jsdom). */
function fitSimpleStopLabel() {
  const labelEl = document.getElementById('simple-stop-label');
  labelEl.style.fontSize = '';
  const room = simpleStop.clientHeight - 4;
  let size = parseFloat(getComputedStyle(labelEl).fontSize);
  while (room > 0 && labelEl.offsetHeight > room && size > STOP_LABEL_MIN_PX) {
    size -= 1;
    labelEl.style.fontSize = size + 'px';
  }
}

// Inline transport icons (SVG, not unicode, so iOS can't substitute emoji glyphs).
const ADV_PAUSE_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
const ADV_PLAY_SVG  = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';

/** Update the Advanced bar. Pause shows only for a recording, where it holds
    the place (live radio has no pause: Stop stops it), and flips to Resume
    while that recording is paused. A live station paused from outside looks
    idle, as on the Simple bar. Stop (the square) calls userStop(). */
function updateAdvTransport() {
  const isPlaying = !!playing;
  const isPaused = isPlaying && paused;
  // The same rule that keeps a recording's place: a live source (latched,
  // even when a cut-off reports a length) never gets Pause.
  const recording = isPlaying && !isLiveSource();
  const wasClass = advTransport.className;
  advTransport.classList.toggle('has-playing', isPlaying && !isPaused);
  advTransport.classList.toggle('paused', isPaused && recording);
  if (advTransport.className !== wasClass) retintSafariBars(RETINT_SNAPPED_MS);
  if (!isPlaying || isPaused) clearStopPoint();

  const pauseBtn = document.getElementById('adv-pause');
  if (pauseBtn) {
    pauseBtn.style.display = isPlaying && recording ? '' : 'none';
    pauseBtn.innerHTML = (isPaused ? ADV_PLAY_SVG : ADV_PAUSE_SVG) +
      '<span class="adv-text" aria-hidden="true">' + (isPaused ? 'Resume' : 'Pause') + '</span>';
    pauseBtn.setAttribute('aria-label', isPaused ? 'Resume' : 'Pause');
  }
  updateSkipButtons();
}


