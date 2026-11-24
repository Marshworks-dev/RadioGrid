/* ================================================================
   AUDIO EVENT HANDLERS
   Monitor the HTML5 audio element for state changes and errors.
   ================================================================ */

audio.addEventListener('playing', () => {
  // A stall that cleared by itself before its reconnect: keep this audio.
  cancelRetry();
  // The tries reset only once the station has played a full minute since its
  // last lost connection (watchForStall() counts it in playback progress, so
  // neither buffering nor the time a stall takes to notice counts), so one
  // that plays a few seconds and hangs up (a "not available in your area"
  // clip, a broken server) gives up after MAX_TRIES instead of replaying all
  // night. A server that cuts everyone off hourly still comes back each time.
  if (retryCount > 0 && steadyFrom === null) steadyFrom = audio.currentTime;
  if (playing && !paused) watchForStall();
  // Sound arrived: clears "Reconnecting…" and "Starting…"
  if (streamFault || awaitingSound) { streamFault = false; awaitingSound = false; renderButtons(); }
  if (playing) setConnStatus('good');
  if (playing && announceOnPlay) { say('Now playing ' + announceOnPlay, SPEAK_AFTER_CHIME_MS); announceOnPlay = null; }
  updateSkipButtons();
  if (pendingFade) { pendingFade = false; fadeInAudio(); }
});

audio.addEventListener('waiting', () => {
  // play() queues 'waiting' when there's no audio yet; a pause right after
  // still receives it, and paused isn't buffering.
  if (playing && !paused) setConnStatus('buffering');
});

// INTERRUPTION / FOCUS handling. When the OS or another app pauses our media
// element out from under us (incoming call, another player grabbing audio
// focus, lock-screen pause), the element fires 'pause' without going through
// softStop/playStream. Reconcile: reflect it as the app's paused state and
// update the UI rather than fighting the OS by forcing playback back on. We
// only act when the app THINKS it's playing (playing && !paused) — the app's
// own deliberate pauses (stopPlayback sets playing=null first; toggle pauses
// set paused=true first) are already consistent and are ignored here.
audio.addEventListener('pause', () => {
  // Judge by the element's state when the event arrives, not by a flag set
  // when we paused: switching stations sets src right after pause(), and a new
  // load discards the queued 'pause' event, so a flag waiting for it stuck and
  // swallowed the next real interruption. If the element is playing again (a
  // switch called play()), this pause was ours and is already superseded.
  if (!audio.paused) return;
  // Chromium pauses the element itself as a stream fails, whether the source
  // never loaded or the connection died mid-stream (the spec's failure steps
  // don't). Recovering is the error handler's job: treating it as the
  // listener pausing would stop the retries for good. Only that pause,
  // though: where the element keeps playing after an error (the spec,
  // WebKit), a pause while the error stands is a call or the lock screen,
  // and a retry or Wi-Fi coming back must not restart audio after it.
  if (audio.error && audio.error === pausedByFailure) { pausedByFailure = null; return; }
  // A live station's server hanging up reaches the element as the end of the
  // stream: it pauses itself and then fires 'ended'. That's a lost connection,
  // not the listener pausing (it used to read "Paused, tap to resume"). A
  // recording reaching its end still lands below, as today.
  if (audio.ended && liveSource && playing && !paused) { connectionLost(); return; }
  // On iOS our own voice line pauses the stream, muted or not. That pause is
  // ours, not the listener's: the stream plays again when the line ends
  // (releaseSpeechHold). The listener's own pause set paused first, so the
  // release leaves that one alone.
  if (heldFor || speechHoldTimer) { pausedBySpeech = true; return; }
  if (playing && !paused) {
    paused = true;
    announceOnPlay = null;
    holdFade();
    forgetLastStation();
    setConnStatus('idle');
    releaseWakeLock();
    setMediaPlaybackState('paused');
    renderButtons();
    updateSimpleStop();
    updateAdvTransport();
  }
});

// Resume from a lock-screen/notification control or when the OS hands audio
// focus back: the element fires 'play'. Bring the app's paused state back in
// line so the UI shows playing again. Guarded the same way — only when the app
// believed it was paused on the active stream.
audio.addEventListener('play', () => {
  // Like 'pause' above, judge by the element's state now: a tap's own play()
  // queues this event, and a pause tapped right after still receives it. If
  // the element is paused again, that play is already superseded.
  if (audio.paused) return;
  if (playing && paused) {
    paused = false;
    rememberLastStation(playing);
    watchForStall();
    setConnStatus('buffering');
    requestWakeLock();
    setMediaPlaybackState('playing');
    renderButtons();
    updateSimpleStop();
    updateAdvTransport();
  }
});

/** A paused live station lets go of its connection; resuming starts it fresh
    (resumeActive reloads live sources). Keeping it open bought nothing, since
    live radio resumes at the live point anyway, and left iOS Safari a
    half-paused stream that quick pause/resume taps could wedge. A recording
    keeps its place. */
function dropLiveConnection() {
  if (!isLiveSource()) return;
  stopStallWatch();
  audio.removeAttribute('src');
  audio.load(); // closes the download; with no src it fires no error
}

/** Is the active source live radio? Latched by noteLiveness(); a source whose
    length isn't known yet counts as live too (only a recording reports one). */
function isLiveSource() {
  return liveSource || !isFinite(audio.duration);
}

/** A source that loads with no end is live radio. Latched for the source: an
    engine may report a length once a live stream is cut off, and that cut-off
    must still count as a lost connection. */
function noteLiveness() {
  if (audio.duration === Infinity) liveSource = true;
  // A length learned well before the end (a recording served without one,
  // known once it has downloaded) means a recording after all: its end must
  // not reconnect and replay it. A length reported at a live cut-off equals
  // the position reached, so it doesn't count.
  else if (isFinite(audio.duration) && audio.duration - audio.currentTime > 5) liveSource = false;
}

audio.addEventListener('loadedmetadata', () => {
  noteLiveness();
  carryOnRecording();
  updateAdvTransport(); // a recording's length is known now: it gets Pause and the skips
});

audio.addEventListener('durationchange', noteLiveness);

// An engine that ends a live stream without pausing first. The pause
// listener has already handled one that did (streamFault is set by then).
audio.addEventListener('ended', () => {
  if (!liveSource || !playing) return;
  // Hung up while paused: nothing reconnects now, but the source is dead, so
  // resuming must reload it rather than play() an ended element.
  if (paused) { streamFault = true; return; }
  if (!streamFault) connectionLost();
});

audio.addEventListener('error', () => {
  if (!playing) return;
  streamFault = true;
  // Paused by the listener: never restart audio on our own (a radio paused at
  // bedtime must not come back when the router reboots). Resuming is theirs,
  // and resumeActive() reloads because of the fault noted above.
  if (paused) return;
  // The app expects the element to be playing, so if it is already paused,
  // the browser paused it as part of this failure and its 'pause' comes next.
  pausedByFailure = audio.paused ? audio.error : null;
  connectionLost();
});

/** The active station stopped delivering audio while the app expects it: an
    error, a live station's server hanging up, or STALL_MS of silence. Each
    loss uses one of MAX_TRIES quiet reconnects ("Reconnecting…", no chime,
    voice, buzz or flash); the last gives up and says so. Never called while
    paused, and the reconnect re-checks, so a paused radio stays silent. */
function connectionLost() {
  if (!playing || paused) return;
  streamFault = true;
  stopStallWatch();
  steadyFrom = null;
  // Already reconnecting: this is the same loss reported again (the stalled
  // connection erroring out while its reconnect waits), not a new one.
  if (retryTimer) return;

  // If the device is offline, retrying the URL won't help and picking a
  // different station won't either — surface the accessible connection-error
  // overlay (plain-language Wi-Fi guidance) instead, using no try. Wi-Fi
  // coming back reloads the station once (the 'online' listener). Per-stream
  // failures while ONLINE still fall through to the retry-then-gray-out path
  // below, so the user can simply try another station.
  if (!navigator.onLine) {
    setConnStatus('error');
    renderButtons(); // the active button reads "Reconnecting…"
    if (!nonetOverlay.classList.contains('visible')) showOverlay(nonetOverlay);
    return;
  }

  retryCount++;
  setConnStatus('error');

  // After MAX_TRIES losses, gray out the button, stop retrying, and say so
  // in every channel: this used to be silent, after "Now playing" at the tap.
  // While the sleep timer runs someone may be asleep, so the greyed-out button
  // and the status text say it, with no buzz, flash, chime or voice. Read the
  // timer before stopPlayback(), which cancels it.
  if (retryCount >= MAX_TRIES) {
    const failedId = playing;
    const s = cfg.streams.find(x => x.id === failedId);
    const message = (s ? s.label : 'This station') + ' is not available right now. Try another station.';
    const sleepTimerRunning = sleepRemaining > 0;
    failedStreams.add(failedId);
    retryCount = 0;
    if (!sleepTimerRunning) doHaptic(failedId);
    stopPlayback();
    setConnStatus('error', message);
    if (!sleepTimerRunning) feedback('down', message);
    return;
  }

  renderButtons(); // the active button reads "Reconnecting…"

  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!playing || paused) return;
    reloadActive();
  }, RETRY_DELAY_MS);
}


/* ================================================================
   CONNECTION STATUS
   Updates the visual dot and its live-region text for screen readers.
   ================================================================ */

const CONN_LABELS = {
  idle: 'Connection: idle',
  buffering: 'Connection: buffering',
  good: 'Connection: connected',
  error: 'Connection: error'
};

/** `message` replaces the standard label, for a sentence worth announcing
    (a station that has stopped working). The dot only shows the colour; the
    words are a separate .sr-only status beside it. Inside the 8px dot Safari
    never exposed them: with an aria-label too, macOS VoiceOver read
    "Connection: idle empty application status", and without one it skipped
    the dot and stopped there.
    While connQuiet is set (the sleep timer ending) the dot stops being a live
    region before its text changes, so no "Connection: idle" wakes anyone. It
    stays quiet until the next change, which turns it back on first. */
function setConnStatus(status, message) {
  connDot.className = status === 'idle' ? '' : status;
  var label = message || CONN_LABELS[status] || CONN_LABELS.idle;
  connText.setAttribute('aria-live', connQuiet ? 'off' : 'polite');
  connText.textContent = label;
}


