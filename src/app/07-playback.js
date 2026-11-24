/* ================================================================
   PLAYBACK
   Manages the HTML5 audio element. A lost connection reconnects quietly
   (connectionLost(): MAX_TRIES before the station greys out); offline,
   the no-network overlay waits for Wi-Fi instead.
   ================================================================ */

/** Effective playback volume (0–1): the configured max times the currently-
    playing stream's optional per-stream gain trim, clamped to [0,1] since the
    HTML5 element can't exceed 1. The trim is the CORS-immune leveling path —
    it scales the element volume directly and works on any stream, cross-origin
    or not (unlike the Web Audio compressor, which can silence tainted streams). */
function targetVolume() {
  const base = cfg.volume / 100;
  const s = playing ? cfg.streams.find(x => x.id === playing) : null;
  const g = (s && typeof s.gain === 'number' && isFinite(s.gain)) ? s.gain : 1;
  return Math.max(0, Math.min(1, base * g));
}

/** Fade audio volume from 0 up to the configured level over 4 seconds.
    Called only after the playing event fires so buffering time doesn't eat the fade. */
function fadeInAudio() {
  clearInterval(fadeTimer);
  const target = targetVolume();
  const steps = 50;
  const intervalMs = 4000 / steps;
  let step = 0;
  fadeTimer = setInterval(() => {
    step++;
    audio.volume = Math.min(target, (step / steps) * target);
    if (step >= steps) { clearInterval(fadeTimer); fadeTimer = null; }
  }, intervalMs);
}

/** A pause during the fade-in: stop the fade and leave it owed, so resuming
    fades in again from silence. Left running, it climbed to full volume while
    paused and the resume came back at full. */
function holdFade() {
  if (!fadeTimer) return;
  clearInterval(fadeTimer); fadeTimer = null;
  audio.volume = 0;
  pendingFade = true;
}

/** rgxl_last (a top-level key, not in rgxl_cfg) is the station the next
    launch auto-resumes when cfg.resume === 'on'. It is set while a station
    plays and cleared whenever playback stops or pauses, so a launch doesn't
    restart a radio someone stopped or paused at bedtime (a reboot after a
    power cut, the browser dropping the tab). Older versions kept it through
    Stop; see APP UPDATES for that leftover. */
function rememberLastStation(id) {
  try { localStorage.setItem('rgxl_last', id); } catch (e) { /* storage full/unavailable — non-fatal */ }
}

function forgetLastStation() {
  try { localStorage.removeItem('rgxl_last'); } catch (e) { /* storage unavailable — non-fatal */ }
}

/** Cancel a pending quiet reconnect. retryTimer is null whenever none is
    pending, so connectionLost() can tell a second report of the same loss
    from a new one. */
function cancelRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
}

/** Watch for audio that stops arriving while the app expects it: a station
    that answers but never sends, or one that freezes mid-stream without
    hanging up (the element just waits, forever). STALL_MS with no progress
    in the playback position counts as a lost connection. Started with every
    load and resume; it stops itself once the radio is paused or stopped, so
    nothing it does can restart a paused radio. Counted in checks, not read
    off a clock: a locked phone that slows timers stretches it instead of
    misfiring. */
function watchForStall() {
  clearInterval(stallWatch);
  stallChecks = 0;
  lastPosition = audio.currentTime;
  stallWatch = setInterval(() => {
    if (!playing || paused) { stopStallWatch(); return; }
    const position = audio.currentTime;
    if (position !== lastPosition) {
      lastPosition = position;
      stallChecks = 0;
      if (steadyFrom !== null && position - steadyFrom >= STEADY_S) { retryCount = 0; steadyFrom = null; }
      return;
    }
    // A recording that buffers keeps its place: reloading would start it over.
    // (It hasn't got this far if it never loaded: the length isn't known yet.)
    if (!liveSource && isFinite(audio.duration)) return;
    if (++stallChecks * STALL_CHECK_MS < STALL_MS) return;
    stopStallWatch();
    connectionLost();
  }, STALL_CHECK_MS);
}

function stopStallWatch() {
  clearInterval(stallWatch);
  stallWatch = null;
}

/** Load the active station again after a lost connection. Silent, and the
    sound fades back in once it arrives: after up to STALL_MS of silence,
    audio snapping back at full volume is the loudest moment of a reconnect. */
function reloadActive() {
  const s = cfg.streams.find(x => x.id === playing);
  if (!s) return;
  clearInterval(fadeTimer); fadeTimer = null;
  audio.volume = 0;
  pendingFade = true;
  // A recording reloaded after a lost connection carries on where it was;
  // a fresh load would start it over.
  pendingSeek = !isLiveSource() && audio.currentTime > 0 ? audio.currentTime : null;
  loadedUrl = s.url;
  audio.src = s.url;
  audio.load();
  playActive();
  watchForStall();
}

/** Play a stream by its ID, switching from any other. A tile only plays;
    Stop stops. A second tap on the station already on never silences it:
    that is the tap made by mistake (a tremor, or trying again while a
    station takes a few seconds to start), so it flashes and points at Stop.
    A station paused from outside (a call, the lock screen, a blocked
    autoplay) or reconnecting plays again now. */
function playStream(id) {
  if (movedTo()) return; // the old address's last build is no longer a radio (24-moved.js)

  if (playing === id) {
    doHaptic(id);
    if (paused || streamFault) {
      hideOverlay(nonetOverlay);
      resumeActive(); // a fresh attempt: it resets the retries itself
      renderButtons();
      updateSimpleStop();
      updateAdvTransport();
    } else {
      pointAtStop();
    }
    return;
  }

  const s = cfg.streams.find(x => x.id === id);
  if (!s) return;

  cancelRetry();
  autoplayBlocked = false;
  retryCount = 0;
  steadyFrom = null;
  failedStreams.delete(id);
  hideOverlay(nonetOverlay);
  rememberRecordingPlace(); // the station being switched away from

  playing = id;
  paused = false;
  awaitingSound = true;
  pendingSeek = recordingPlaces.has(s.url) ? recordingPlaces.get(s.url) : null;
  loadedUrl = s.url;

  rememberLastStation(id);

  announceStart(s.label);
  doHaptic(id);

  clearInterval(fadeTimer); fadeTimer = null;
  audio.pause();
  audio.volume = 0;   // silence until playing event fires and fade begins
  pendingFade = true;
  streamFault = false;
  liveSource = false; // until this source says otherwise (noteLiveness)
  audio.src = s.url;
  audio.load();
  playActive();
  watchForStall();
  renderButtons();
  updateSimpleStop();
  updateAdvTransport();
  setConnStatus('buffering');
  requestWakeLock();
  applyMediaMetadata(s);
  setMediaPlaybackState('playing');
}

/** Stop all playback and reset UI to idle state. */
function stopPlayback() {
  if (!playing) return;

  rememberRecordingPlace();
  awaitingSound = false;
  pendingSeek = null;
  clearStopPoint();
  clearInterval(fadeTimer); fadeTimer = null;
  pendingFade = false;
  cancelRetry();
  stopStallWatch();
  steadyFrom = null;
  clearTimeout(speakTimer); // a "Now playing" still waiting to be said is stale now
  pausedBySpeech = false; // stopped: nothing to play when the line ends
  if (heldFor || speechHoldTimer) releaseSpeechHold(); // the next start mustn't begin muted
  audio.pause();
  audio.src = '';
  forgetLastStation();

  playing = null;
  paused = false;
  autoplayBlocked = false;
  streamFault = false;
  liveSource = false;
  announceOnPlay = null;
  retryCount = 0;

  renderButtons();
  updateSimpleStop();
  updateAdvTransport();
  setConnStatus('idle');
  hideOverlay(nonetOverlay);
  clearSleep();
  releaseWakeLock();
  setMediaPlaybackState('none');
}

/** The listener's own Stop: the advanced Stop button and the lock screen.
    Every other stop (the sleep timer, settings changes) is stopPlayback()
    alone, with no chime, voice or buzz: the sleep timer ending must not wake
    someone who has just fallen asleep. A station giving up says so, except
    while the sleep timer runs (the audio 'error' listener). */
function userStop() {
  if (!playing) return;
  doHaptic(playing);
  stopPlayback();
  feedback('down', 'Stopped');
}

/** The Simple-mode bar. It says Stop, so it stops, always: the station goes
    back to idle and the next launch won't resume it. It used to read
    "Resume …" after a station was paused, which gave the bar two jobs; a
    station paused from outside now waits on its own tile ("Tap to play"). */
function simpleStopPress() {
  if (!playing) return;
  userStop();
}

/** Where a recording stopped, so its next tap carries on there. Kept by URL
    (an edited station is a new source) and only while the app is open: no
    saved key changes. Live radio has no place to keep; a recording at or
    near its end starts over next time. */
function rememberRecordingPlace() {
  // Keyed by the address that was loaded, not the station's address now:
  // settings may have changed it since.
  if (!playing || !loadedUrl || isLiveSource()) return;
  const at = audio.currentTime;
  if (audio.ended || !(at > 0) || audio.duration - at < 5) recordingPlaces.delete(loadedUrl);
  else recordingPlaces.set(loadedUrl, at);
}

/** Seek a recording that just loaded to where it was stopped. Live radio (or
    a place past the end) drops the place instead. */
function carryOnRecording() {
  if (pendingSeek === null) return;
  // Live radio has no place to go back to: drop it, so a later reload that
  // reports a length can't jump there. A length not known yet keeps waiting.
  if (audio.duration === Infinity) { pendingSeek = null; return; }
  if (!isFinite(audio.duration)) return;
  const at = pendingSeek;
  pendingSeek = null;
  if (at < audio.duration - 5) audio.currentTime = at;
}

/** A second tap on the playing station: hold a still highlight on Stop for
    a moment, pointing at where "off" lives. No animation, so it is the
    same with Reduce Motion on; no sound, so it never talks over the radio. */
function pointAtStop() {
  clearStopPoint();
  const target = cfg.advanced === 'on' ? advTransport.querySelector('.adv-stop') : simpleStop;
  if (!target) return;
  target.classList.add('point');
  stopPointTimer = setTimeout(clearStopPoint, STOP_POINT_MS);
}

function clearStopPoint() {
  clearTimeout(stopPointTimer);
  stopPointTimer = null;
  simpleStop.classList.remove('point');
  const advStop = advTransport.querySelector('.adv-stop');
  if (advStop) advStop.classList.remove('point');
}

/** Pause, or resume if paused: Advanced mode's Pause button (recordings
    only) and the lock screen's play and pause. A paused station waits on its
    tile ("Tap to play"); a tap on it, or switching station, ends the pause. */
function softStop() {
  if (!playing) return;

  if (paused) {
    // Already soft-paused — resume
    resumeActive();
  } else {
    // Pause and keep playing ID so resume is possible
    paused = true;
    announceOnPlay = null;
    audio.pause();
    holdFade();
    dropLiveConnection();
    forgetLastStation();
    setConnStatus('idle');
    releaseWakeLock();
    setMediaPlaybackState('paused');
    feedback('down', 'Paused');
  }

  doHaptic(playing);
  renderButtons();
  updateSimpleStop();
  updateAdvTransport();
}

/** Resume the active stream (station tap, Stop bar, lock screen). After an
    error a bare play() is a dead end: it doesn't refetch a failed source, and
    after SRC_NOT_SUPPORTED it rejects outright, with no new 'error' event to
    restart the retries. So a faulted stream reloads its source first. */
function resumeActive() {
  // A fresh attempt, as a station tap is: a retry still pending from before
  // the pause would load the stream a second time, and the count of failed
  // tries starts over (after three, the next error would give up at once).
  cancelRetry();
  retryCount = 0;
  steadyFrom = null;
  paused = false;
  autoplayBlocked = false;
  awaitingSound = true;
  rememberLastStation(playing);
  const s = cfg.streams.find(x => x.id === playing);
  if ((streamFault || audio.error) && s) {
    announceStart(s.label); // a reconnect, announced like a fresh start
    reloadActive();
  } else if (isLiveSource() && s) {
    // Live radio resumes at the live point, on a fresh connection. iOS
    // Safari stops downloading a paused live stream without saying so, and a
    // bare play() then ran out the second or two it had kept and stopped,
    // which read as the radio pausing itself again.
    feedback('up', 'Resuming');
    reloadActive();
  } else {
    feedback('up', 'Resuming');
    playActive();
    watchForStall();
  }
  setConnStatus('buffering');
  requestWakeLock();
  setMediaPlaybackState('playing');
}

/** audio.play() for the active stream. If autoplay policy blocks it (no user
    gesture, as on a boot auto-resume), show "tap to resume" rather than a
    playing UI with no sound. AbortError only means a newer load or pause took
    over; load failures also fire 'error', which runs the retry path. */
function playActive() {
  const id = playing;
  const p = audio.play();
  if (!p || !p.catch) return;
  p.catch((e) => {
    const name = e && e.name;
    if (name === 'NotAllowedError') {
      // Not the listener pausing, so rgxl_last stays: the next launch offers
      // this station again.
      if (playing === id && !paused) {
        paused = true;
        autoplayBlocked = true; // its button says "Tap to play" on screen
        setConnStatus('idle');
        releaseWakeLock();
        setMediaPlaybackState('paused');
        renderButtons();
        updateSimpleStop();
        updateAdvTransport();
      }
    } else if (name !== 'AbortError') {
      console.warn('[playback] play() rejected:', name, e && e.message);
    }
  });
}

/** Skip backward 15 seconds (non-live streams only). */
function skipBack() {
  if (!playing) return;
  if (!canSkip()) {
    showSkipToast('Live stream — cannot skip');
    return;
  }
  audio.currentTime = Math.max(0, audio.currentTime - 15);
  doHaptic(playing);
  showSkipToast('⏪ Back 15s');
}

/** Skip forward 30 seconds (non-live streams only). */
function skipFwd() {
  if (!playing) return;
  if (!canSkip()) {
    showSkipToast('Live stream — cannot skip');
    return;
  }
  audio.currentTime = Math.min(audio.duration, audio.currentTime + 30);
  doHaptic(playing);
  showSkipToast('⏩ Forward 30s');
}

/** Show a brief centered toast message for skip actions. */
function showSkipToast(msg) {
  skipToast.textContent = msg;
  skipToast.classList.add('visible');
  clearTimeout(skipToastTimer);
  skipToastTimer = setTimeout(() => skipToast.classList.remove('visible'), 1200);
}

/** Retry the current stream (called from the error overlay button). */
function retryStream() {
  hideOverlay(nonetOverlay);
  cancelRetry(); // a pending auto-retry would load the stream a second time
  if (!playing) return;

  const s = cfg.streams.find(x => x.id === playing);
  if (!s) return;

  // Clear any failed/error state so a successful retry un-grays the button.
  failedStreams.delete(playing);
  retryCount = 0;
  steadyFrom = null;
  reloadActive();
  renderButtons();
  setConnStatus('buffering');
}


