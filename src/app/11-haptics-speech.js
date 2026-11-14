/* ================================================================
   HAPTIC FEEDBACK
   Provides a brief vibration and visual flash on button press.
   Can be disabled by the technician in settings.
   ================================================================ */

const TAP_FLASH_MS = 250; // the tapFlash animation's length in the CSS
const tapFlashTimers = new Map(); // stream ID -> timer that ends its flash

/** A station button's flash overlay. Found by id, not a '#btn-…' selector:
    an id from a backup can hold any character, and one like " or [ made
    querySelector throw, so that station never played. */
function tapFlashOf(streamId) {
  const btn = document.getElementById('btn-' + streamId);
  return btn && btn.querySelector('.tap-flash');
}

function doHaptic(streamId) {
  if (cfg.haptics !== 'on') return;

  // Visual flash on the stream button
  const el = streamId ? tapFlashOf(streamId) : null;
  if (el) {
    el.classList.remove('flash');
    void el.offsetWidth; // Force reflow to restart the animation
    el.classList.add('flash');
    // A tap flashes once. renderButtons() hands a running flash on to the
    // rebuilt button, so when the flash is over, take the class off whichever
    // button has it now. Left on, every later rebuild (a reconnect try every
    // few seconds) flashed white again. A timer, not animationend: with
    // reduced motion there is no animation, so that event never comes.
    clearTimeout(tapFlashTimers.get(streamId));
    tapFlashTimers.set(streamId, setTimeout(() => {
      tapFlashTimers.delete(streamId);
      const flash = tapFlashOf(streamId);
      if (flash) flash.classList.remove('flash');
    }, TAP_FLASH_MS));
  }

  // Vibration on Android only: iOS Safari has none, and nothing else is tried
  // there (the setting is hidden on other platforms).
  if (platform.isAndroid && navigator.vibrate) navigator.vibrate(30);
}


/* ================================================================
   TEXT-TO-SPEECH
   Announces playback actions aloud when enabled in settings.
   Uses the Web Speech API — device agnostic, no external deps.
   ================================================================ */

/** iOS Safari puts speech and Web Audio (the chime) on the "ambient" audio
    session: muted by the silent switch, and when speech starts, iOS treats it
    as a second player and pauses the stream. 'playback' moves the whole page
    onto the media session the <audio> stream already uses. Audio Session API,
    Safari 16.4+; nothing else has navigator.audioSession, so it no-ops there. */
function usePlaybackAudioSession() {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
      navigator.audioSession.type = 'playback';
    }
  } catch (e) {
    console.warn('[RadioGridXL] audioSession.type not settable:', e);
  }
}
usePlaybackAudioSession();

function speak(text) {
  if (cfg.tts !== 'on') return;
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

let speakTimer = null; // pending feedback speech; a newer action replaces it
const SPEAK_AFTER_CHIME_MS = 800;   // so speech doesn't talk over the chime
const CONNECTING_SPEECH_MS = 3000;  // a start slower than this hears "Connecting to"

/** Speak `text` after `delayMs`. Only the latest line is spoken: an accidental
    double tap or a quick switch must not announce a station that is no longer
    playing. */
function say(text, delayMs) {
  if (cfg.tts !== 'on' || !window.speechSynthesis) return;
  clearTimeout(speakTimer);
  speakTimer = setTimeout(() => speak(text), delayMs);
}

/* iPhone and iPad can't mix speech with a playing stream: whichever starts
   second interrupts the other, and a stream interrupted by our own voice
   reads as the listener pausing (the audio 'pause' listener). So on iOS a
   line spoken as audio starts goes first: the stream still starts at the
   tap (iOS only lets a tap start playback) but muted, and its sound comes
   on when the line ends. `muted`, not volume: iOS ignores a scripted volume.
   Android and desktop mix the two and keep "Now playing" once it plays. */
const SPEAK_BEFORE_SOUND = platform.isIOS;
const SPEECH_HOLD_MAX_MS = 6000; // sound comes on by then even if iOS never reports the line's end
let heldFor = null;              // the utterance the stream is muted for
let speechHoldTimer = null;
let pausedBySpeech = false;      // iOS paused the stream for our line; play it when the line ends

/** Mute the stream, say `text` after the chime, unmute when it ends. */
function sayBeforeSound(text) {
  clearTimeout(speakTimer);
  clearTimeout(speechHoldTimer);
  audio.muted = true;
  const line = new SpeechSynthesisUtterance(text);
  heldFor = line;
  line.onend = line.onerror = () => { if (heldFor === line) releaseSpeechHold(); };
  speechHoldTimer = setTimeout(releaseSpeechHold, SPEECH_HOLD_MAX_MS);
  speakTimer = setTimeout(() => {
    speechSynthesis.cancel();
    speechSynthesis.speak(line);
  }, SPEAK_AFTER_CHIME_MS);
}

function releaseSpeechHold() {
  clearTimeout(speechHoldTimer);
  speechHoldTimer = null;
  heldFor = null;
  audio.muted = false;
  // The tap's play() already unlocked this element, so iOS allows this one.
  if (pausedBySpeech) { pausedBySpeech = false; if (playing && !paused) playActive(); }
}

function speakingBeforeSound() {
  return SPEAK_BEFORE_SOUND && cfg.tts === 'on' && !!window.speechSynthesis;
}

/** Play chime then speak — ensures TTS doesn't overlap the tone. */
function feedback(direction, text) {
  chime(direction);
  // 'up' lines go with sound starting; 'down' lines follow it stopping.
  if (direction === 'up' && speakingBeforeSound()) sayBeforeSound(text);
  else say(text, SPEAK_AFTER_CHIME_MS);
}

/** Chime now; say "Now playing" when the audio really starts (the 'playing'
    listener) rather than at the tap, so a dead station is never announced as
    playing. A start slower than CONNECTING_SPEECH_MS hears "Connecting to"
    first. On iOS the line comes first instead ("Tuning to"), which still
    never claims a dead station is playing. */
function announceStart(label) {
  chime('up');
  if (speakingBeforeSound()) { announceOnPlay = null; sayBeforeSound('Tuning to ' + label); return; }
  announceOnPlay = label;
  say('Connecting to ' + label, CONNECTING_SPEECH_MS);
}

/* Chime: a synthesized soft-mallet marimba. Each note is a struck bar (sines
   at its overtone ratios) plus a noise burst for the mallet, darkened and
   given a little room. Start rises, Pause falls; both end (~740 ms) before
   SPEAK_AFTER_CHIME_MS. */
const CHIME_NOTES = { up: [392, 523.25], down: [523.25, 392] };
const CHIME_VELOCITY = { up: [0.85, 1], down: [1, 0.75] };
const CHIME_GAP_S = 0.13;
const CHIME_LEVEL = 0.5;      // × cfg.volume
const BAR_PARTIALS = [[1, 1, 1], [3.93, 0.12, 0.25], [9.2, 0.02, 0.1]]; // [ratio, level, share of decay]
const BAR_ATTACK_S = 0.006;
const BAR_DECAY_S = 0.6;
const BAR_GLIDE = 1.005;      // a struck bar starts a hair sharp and settles
const MALLET = { freq: 1100, q: 0.8, level: 0.07, dur: 0.025 };
const CHIME_LOWPASS_HZ = 1900;
const ROOM_LEVEL = 0.18;
const ROOM_S = 0.45;

/** Shared AudioContext for chime tones — reused to avoid exhausting the browser limit. */
let chimeCtx = null;
let chimeRoom = null;   // the room's input, shared by every chime on chimeCtx
let malletNoise = null; // 0.1 s of white noise, the mallet's knock

/** Once per context: mallet noise, and decaying noise as the room's impulse. */
function buildChimeVoice(ctx) {
  malletNoise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
  const noise = malletNoise.getChannelData(0);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
  const len = Math.floor(ctx.sampleRate * ROOM_S);
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  }
  chimeRoom = ctx.createConvolver();
  chimeRoom.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = ROOM_LEVEL;
  chimeRoom.connect(wet);
  wet.connect(ctx.destination);
}

/** Rise from silence and fall back exponentially, the way a struck thing rings. */
function strikeEnvelope(param, t, peak, attack, decay) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** One struck bar at time `t`, into `bus`. */
function strikeBar(t, freq, velocity, bus) {
  const note = chimeCtx.createGain();
  note.gain.value = velocity;
  note.connect(bus);
  const levelSum = BAR_PARTIALS.reduce((sum, p) => sum + p[1], 0);
  for (const [ratio, level, decayShare] of BAR_PARTIALS) {
    const osc = chimeCtx.createOscillator();
    const gain = chimeCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio * BAR_GLIDE, t);
    osc.frequency.exponentialRampToValueAtTime(freq * ratio, t + 0.03);
    const decay = BAR_DECAY_S * decayShare;
    strikeEnvelope(gain.gain, t, level / levelSum, BAR_ATTACK_S, decay);
    osc.connect(gain);
    gain.connect(note);
    osc.start(t);
    osc.stop(t + BAR_ATTACK_S + decay + 0.05);
  }
  const knock = chimeCtx.createBufferSource();
  knock.buffer = malletNoise;
  const band = chimeCtx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = MALLET.freq;
  band.Q.value = MALLET.q;
  const knockGain = chimeCtx.createGain();
  strikeEnvelope(knockGain.gain, t, MALLET.level, 0.001, MALLET.dur);
  knock.connect(band);
  band.connect(knockGain);
  knockGain.connect(note);
  knock.start(t);
  knock.stop(t + MALLET.dur + 0.02);
}

/** Play a two-note chime. direction: 'up' (play/resume) or 'down' (pause). */
function chime(direction) {
  if (cfg.chime !== 'on') return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!chimeCtx || chimeCtx.state === 'closed') {
      chimeCtx = new Ctx();
      buildChimeVoice(chimeCtx);
    }
    if (chimeCtx.state === 'suspended') chimeCtx.resume();
    const dark = chimeCtx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = CHIME_LOWPASS_HZ;
    dark.Q.value = 0.5;
    const out = chimeCtx.createGain();
    out.gain.value = CHIME_LEVEL * (cfg.volume / 100);
    dark.connect(out);
    out.connect(chimeCtx.destination);
    out.connect(chimeRoom);
    const t0 = chimeCtx.currentTime;
    CHIME_NOTES[direction].forEach((freq, i) => {
      strikeBar(t0 + i * CHIME_GAP_S, freq, CHIME_VELOCITY[direction][i], dark);
    });
  } catch (e) {
    // A chime is a nicety: never let it break the tap that played or paused.
    console.warn('[RadioGridXL] chime failed:', e);
  }
}


