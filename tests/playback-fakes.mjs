/**
 * Fakes for playback tests: a media element, a clock, Screen Wake Lock, speech
 * and MediaSession.
 *
 * jsdom implements none of these (its play()/pause() only log "not
 * implemented"), and the playback bugs live in timing the HTML spec defines:
 * media events are queued tasks, and starting a new load discards any that are
 * still queued. So the fake element follows the spec's load algorithm,
 * resource selection, play() and pause() steps closely enough for those
 * effects to show, and nothing more. Everything runs on one fake clock, so a
 * test can step through a 4-second retry or an 800 ms speech delay exactly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadApp } from './harness.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The default profile's streams: s1 and s2, both live Icecast URLs. */
export const STREAMS = JSON.parse(readFileSync(join(repo, 'profiles', 'default.json'), 'utf-8')).streams;

const NETWORK_EMPTY = 0, NETWORK_IDLE = 1, NETWORK_LOADING = 2, NETWORK_NO_SOURCE = 3;
const HAVE_NOTHING = 0, HAVE_METADATA = 1, HAVE_ENOUGH_DATA = 4;
const MEDIA_ERR_NETWORK = 2, MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
/** How long a fake stream takes to connect (or to fail), in ms. */
export const CONNECT_MS = 50;
/** How long a 'slow' route takes to connect. */
export const SLOW_CONNECT_MS = 4000;

/** Replace the window's timers with a manual clock. The app looks the timer
    functions up on window at call time, so swapping them after boot works. */
export function installClock(w) {
  let now = 0;
  // Far above jsdom's own ids: a timer the app armed at boot, before this
  // clock, is cleared later by its real id, which must not delete a fake one.
  let nextId = 1_000_000;
  const timers = new Map(); // id -> { at, fn, every }
  w.setTimeout = (fn, ms = 0) => { const id = nextId++; timers.set(id, { at: now + Math.max(0, ms), fn }); return id; };
  w.clearTimeout = (id) => { timers.delete(id); };
  w.setInterval = (fn, ms = 0) => { const id = nextId++; timers.set(id, { at: now + Math.max(1, ms), fn, every: Math.max(1, ms) }); return id; };
  w.clearInterval = (id) => { timers.delete(id); };

  // The fake media element reads this to advance currentTime while it plays.
  w.__fakeClockNow = () => now;

  // jsdom's window shares Node's microtask queue, so awaiting here also runs
  // the app's promise callbacks (play() rejections, the wake lock request).
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

  return {
    get now() { return now; },
    /** Advance time by ms, running every timer that comes due, in order. */
    async tick(ms = 0) {
      const end = now + ms;
      await settle();
      for (;;) {
        let id = null, due = null;
        for (const [k, t] of timers) {
          if (t.at <= end && (!due || t.at < due.at)) { id = k; due = t; }
        }
        if (!due) break;
        now = due.at;
        if (due.every) due.at += due.every; else timers.delete(id);
        due.fn();
        await settle();
      }
      now = end;
    },
  };
}

/** Make `el` behave like a spec media element on the fake clock. Returns a
    controller: route URLs, drop a live connection, pause from "outside". */
export function installFakeAudio(w, el) {
  const s = {
    paused: true, error: null, networkState: NETWORK_EMPTY, readyState: HAVE_NOTHING,
    duration: NaN, currentTime: 0, src: null, // null = no src attribute
    ended: false,
    // Audio is arriving and playing: currentTime advances with the clock from
    // flowSince. Worked out when read, so no timeupdate events are needed.
    flowing: false, flowSince: 0, frozen: false,
    tasks: new Set(), pendingPlay: [],
  };
  const clockNow = () => (w.__fakeClockNow ? w.__fakeClockNow() : 0);
  const position = () => s.currentTime + (s.flowing ? (clockNow() - s.flowSince) / 1000 : 0);
  function startFlow() { if (!s.flowing && !s.frozen) { s.flowing = true; s.flowSince = clockNow(); } }
  function stopFlow() { if (s.flowing) { s.currentTime = position(); s.flowing = false; } }
  const routes = new Map(); // url -> 'live' | 'slow' | 'vod' | 'dead' | 'hang'
  const ctl = {
    fetches: [],          // every URL the element started loading, in order
    blockAutoplay: false, // play() rejects NotAllowedError, as without a gesture
    liveSeekable: false,  // a live stream reports a seekable range, as Chrome may
    pauseOnFailure: true, // a failing stream pauses the element, as in Chromium (see failSource)
    route(url, kind) { routes.set(url, kind); return ctl; },
    get state() { return s; },
    /** The connection dies mid-stream: the spec's "fatal network error"
        (MEDIA_ERR_NETWORK, networkState NETWORK_IDLE). Chromium pauses the
        element here too, as after a load failure (see failSource). */
    drop() {
      queue(() => {
        const wasPlaying = !s.paused;
        stopFlow();
        s.error = { code: MEDIA_ERR_NETWORK };
        s.networkState = NETWORK_IDLE;
        s.readyState = HAVE_METADATA;
        if (wasPlaying && ctl.pauseOnFailure) s.paused = true;
        fire('error');
        if (wasPlaying && ctl.pauseOnFailure) queue(() => fire('pause'));
      });
    },
    /** Something outside the app pauses the element: another app takes audio
        focus, a call comes in, headphones are unplugged. */
    externalPause() { internalPause(); },
    /** The server hangs up a live stream. Real engines differ (traced
        2026-10-26 against a local endless MP3, headless Playwright):
        - 'chromium': 'error' (MEDIA_ERR_SRC_NOT_SUPPORTED, networkState
          NETWORK_NO_SOURCE) with the element already paused, then 'pause'.
        - 'webkit': nothing at all. The buffered seconds play out, then
          currentTime stops while the element still reports playing at
          HAVE_ENOUGH_DATA, silent for good (its own re-request didn't help).
        - 'spec' (default): the element reaches "the end": timeupdate, then
          (if playing) paused and 'pause', then 'ended'. `reportLength` makes
          duration finite at the cut-off, as an engine may once it knows how
          much arrived. */
    hangUp({ engine = 'spec', reportLength = true } = {}) {
      if (engine === 'chromium') {
        queue(() => {
          const wasPlaying = !s.paused;
          stopFlow();
          s.error = { code: MEDIA_ERR_SRC_NOT_SUPPORTED };
          s.networkState = NETWORK_NO_SOURCE;
          if (wasPlaying) s.paused = true;
          fire('error');
          if (wasPlaying) queue(() => fire('pause'));
        });
        return;
      }
      if (engine === 'webkit') {
        queue(() => { stopFlow(); s.frozen = true; });
        return;
      }
      queue(() => {
        stopFlow();
        s.networkState = NETWORK_IDLE;
        if (reportLength) { s.duration = s.currentTime; fire('durationchange'); }
        s.ended = true;
        fire('timeupdate');
        if (!s.paused) { s.paused = true; fire('pause'); }
        fire('ended');
      });
    },
    /** The connection stays open but audio stops arriving (a frozen
        encoder, Wi-Fi that hiccups without dropping): playback runs dry and
        the element waits. */
    freeze() {
      queue(() => {
        stopFlow();
        s.frozen = true;
        s.readyState = HAVE_METADATA;
        if (!s.paused) fire('waiting');
      });
    },
    /** The engine learns the source's length mid-play, as for a recording
        served without one (chunked, no Content-Length) once it has all
        downloaded. */
    learnLength(seconds) {
      queue(() => { s.duration = seconds; fire('durationchange'); });
    },
    /** Audio arrives again after freeze(). */
    unfreeze() {
      queue(() => {
        s.frozen = false;
        s.readyState = HAVE_ENOUGH_DATA;
        if (!s.paused) { startFlow(); fire('playing'); }
      });
    },
  };

  const exception = (name) => new w.DOMException(name, name);
  const fire = (type) => el.dispatchEvent(new w.Event(type));
  // A "media element task". The load algorithm cancels every one still queued.
  function queue(fn, ms = 0) {
    const id = w.setTimeout(() => { s.tasks.delete(id); fn(); }, ms);
    s.tasks.add(id);
  }
  function settlePlay(ok, name) {
    const pending = s.pendingPlay.splice(0);
    for (const p of pending) ok ? p.resolve() : p.reject(exception(name));
  }

  function loadAlgorithm() {
    for (const id of s.tasks) w.clearTimeout(id); // pending events are discarded
    s.tasks.clear();
    stopFlow();
    s.ended = false;
    s.frozen = false;
    if (s.networkState !== NETWORK_EMPTY) {
      s.readyState = HAVE_NOTHING;
      if (!s.paused) { s.paused = true; settlePlay(false, 'AbortError'); } // no 'pause' event
      s.duration = NaN;
      s.currentTime = 0;
    }
    s.error = null;
    resourceSelection();
  }

  function resourceSelection() {
    if (s.src === null) { s.networkState = NETWORK_EMPTY; return; }
    if (s.src === '') { // an empty src attribute fails, as in Chrome ("Empty src attribute")
      s.networkState = NETWORK_NO_SOURCE;
      queue(failSource);
      return;
    }
    s.networkState = NETWORK_LOADING;
    ctl.fetches.push(s.src); // src= then load() logs twice, as a browser starts twice
    const kind = routes.get(s.src) || 'live';
    if (kind === 'hang') return;
    queue(kind === 'dead' ? failSource : () => {
      s.readyState = HAVE_ENOUGH_DATA;
      s.duration = kind === 'vod' ? 600 : Infinity;
      fire('loadedmetadata');
      fire('canplay');
      if (!s.paused) { startFlow(); fire('playing'); settlePlay(true); }
    }, kind === 'slow' ? SLOW_CONNECT_MS : CONNECT_MS);
  }

  // "Dedicated media source failure steps": a dead URL or an empty src
  // (MEDIA_ERR_SRC_NOT_SUPPORTED, networkState NETWORK_NO_SOURCE).
  // Chromium also pauses the element when a stream fails, here and on a
  // mid-stream drop: paused is already true when 'error' fires, and 'pause'
  // follows (headless Chromium traces, 2026-10). The spec's steps don't
  // pause, and WebKit didn't for a dead URL. `pauseOnFailure` is on by
  // default, since the APK's WebView and Chrome are Chromium; off follows
  // the spec.
  function failSource() {
    const wasPlaying = !s.paused;
    stopFlow();
    s.error = { code: MEDIA_ERR_SRC_NOT_SUPPORTED };
    s.networkState = NETWORK_NO_SOURCE;
    if (wasPlaying && ctl.pauseOnFailure) s.paused = true;
    fire('error');
    settlePlay(false, 'NotSupportedError');
    if (wasPlaying && ctl.pauseOnFailure) queue(() => fire('pause'));
  }

  function internalPause() {
    if (s.networkState === NETWORK_EMPTY) resourceSelection();
    if (s.paused) return; // an already-paused element fires no 'pause'
    stopFlow();
    s.paused = true;
    queue(() => { fire('timeupdate'); fire('pause'); });
    settlePlay(false, 'AbortError');
  }

  el.play = () => {
    if (ctl.blockAutoplay) return w.Promise.reject(exception('NotAllowedError'));
    if (s.error && s.error.code === MEDIA_ERR_SRC_NOT_SUPPORTED) return w.Promise.reject(exception('NotSupportedError'));
    if (s.networkState === NETWORK_EMPTY) resourceSelection();
    const p = new w.Promise((resolve, reject) => s.pendingPlay.push({ resolve, reject }));
    if (s.paused) {
      s.paused = false;
      queue(() => fire('play'));
      if (s.readyState >= HAVE_ENOUGH_DATA) queue(() => { startFlow(); fire('playing'); settlePlay(true); });
      else queue(() => fire('waiting'));
    } else if (s.readyState >= HAVE_ENOUGH_DATA) {
      queue(() => settlePlay(true));
    }
    return p;
  };
  el.pause = () => internalPause();
  el.load = () => loadAlgorithm();

  const getters = {
    paused: () => s.paused,
    error: () => s.error,
    networkState: () => s.networkState,
    readyState: () => s.readyState,
    duration: () => s.duration,
    ended: () => s.ended,
    seekable: () => {
      if (s.duration === 600) return { length: 1, start: () => 0, end: () => 600 };
      // Some engines report a range for a live stream too (what was buffered).
      if (s.duration === Infinity && ctl.liveSeekable) return { length: 1, start: () => 0, end: () => position() };
      return { length: 0, start() { throw exception('IndexSizeError'); }, end() { throw exception('IndexSizeError'); } };
    },
  };
  for (const [name, get] of Object.entries(getters)) Object.defineProperty(el, name, { configurable: true, get });
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    get: () => position(),
    set: (v) => { s.currentTime = v; if (s.flowing) s.flowSince = clockNow(); },
  });
  Object.defineProperty(el, 'src', {
    configurable: true,
    get: () => s.src || '',
    set: (v) => { s.src = String(v); loadAlgorithm(); },
  });
  const removeAttribute = el.removeAttribute.bind(el);
  el.removeAttribute = (name) => { if (name === 'src') s.src = null; removeAttribute(name); };
  // Read-only on jsdom's prototype, so define rather than assign.
  for (const [name, value] of Object.entries({ NETWORK_EMPTY, NETWORK_IDLE, NETWORK_LOADING, NETWORK_NO_SOURCE })) {
    Object.defineProperty(el, name, { configurable: true, value });
  }
  return ctl;
}

/** navigator.wakeLock that counts the locks still held. */
export function installWakeLock(w) {
  const held = new Set();
  let requests = 0;
  Object.defineProperty(w.navigator, 'wakeLock', {
    configurable: true,
    value: {
      request() {
        requests++;
        const sentinel = new w.EventTarget();
        sentinel.released = false;
        sentinel.release = () => {
          if (!sentinel.released) {
            sentinel.released = true;
            held.delete(sentinel);
            sentinel.dispatchEvent(new w.Event('release'));
          }
          return w.Promise.resolve();
        };
        held.add(sentinel);
        return w.Promise.resolve(sentinel);
      },
    },
  });
  return {
    get held() { return held.size; },
    get requests() { return requests; },
    /** The browser drops every screen lock when the page is hidden. */
    releaseAll() { for (const sentinel of [...held]) sentinel.release(); },
  };
}

/** speechSynthesis that records what would be said, in order. */
export function installSpeech(w) {
  const spoken = [];
  w.speechSynthesis = { cancel() {}, speak(u) { spoken.push(u.text); } };
  w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  return spoken;
}

/** An AudioContext that counts chimes (each chime strikes two notes, and
    every note has one mallet knock) and records each note's pitch and start,
    so a test can tell a rising chime from a falling one. */
export function installChime(w) {
  const notes = []; // { freq, at } for each struck note, in order
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra) => ({ connect() {}, ...extra });
  w.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.sampleRate = 8000; }
    resume() { return w.Promise.resolve(); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createConvolver() { return node({ buffer: null }); }
    createBiquadFilter() { return node({ type: '', frequency: param(), Q: param() }); }
    createGain() { return node({ gain: param() }); }
    createOscillator() {
      let freq = 0;
      const frequency = { ...param(), setValueAtTime(v) { if (!freq) freq = v; } };
      return node({ type: '', frequency, start(at) { if (!notes.pending) notes.pending = { freq, at }; }, stop() {} });
    }
    createBufferSource() {
      // The knock closes a note: the first oscillator started since the last
      // knock is the bar's fundamental.
      return node({ buffer: null, start() { notes.push(notes.pending); notes.pending = null; }, stop() {} });
    }
  };
  return { get chimes() { return notes.length / 2; }, notes };
}

/** navigator.mediaSession, installed before parse because the app detects it
    once at load. Returns the registered action handlers by name. */
export function stubMediaSession(w) {
  const handlers = {};
  Object.defineProperty(w.navigator, 'mediaSession', {
    configurable: true,
    value: {
      metadata: null,
      playbackState: 'none',
      setActionHandler(action, fn) { if (fn) handlers[action] = fn; else delete handlers[action]; },
    },
  });
  w.MediaMetadata = class { constructor(init) { Object.assign(this, init); } };
  return handlers;
}

/** Boot the app with every playback fake in place. `cfg` is merged into a
    saved config (for example { tts: 'on' }); `mediaSession` adds the stub;
    `beforeParse` installs anything else the app detects at load. */
export function bootPlayback({ cfg, mediaSession = false, beforeParse } = {}) {
  let handlers = null;
  const seed = cfg ? { rgxl_cfg: JSON.stringify({ streams: STREAMS, ...cfg }) } : {};
  const w = loadApp({ seed, beforeParse: (win) => {
    if (mediaSession) handlers = stubMediaSession(win);
    if (beforeParse) beforeParse(win);
  } });
  const clock = installClock(w);
  const audio = installFakeAudio(w, w.document.getElementById('audio-player'));
  const wake = installWakeLock(w);
  const spoken = installSpeech(w);
  const chime = installChime(w);
  const buzz = { count: 0 };
  Object.defineProperty(w.navigator, 'vibrate', { configurable: true, value: () => { buzz.count++; return true; } });
  const button = (id) => w.document.getElementById('btn-' + id);
  // The name, plus " (on)" while it is the current station: station names
  // don't say "Now playing", so this keeps every assertion checking state.
  const label = (id) => button(id).getAttribute('aria-label') + (button(id).getAttribute('aria-current') === 'true' ? ' (on)' : '');
  // The words in a tile's status line ("Starting…", "Tap to play"), or ''.
  const status = (id) => { const el = button(id).querySelector('.btn-status'); return el ? el.textContent : ''; };
  const conn = () => w.document.getElementById('conn-text').textContent;
  const overlayShown = () => w.document.getElementById('nonet-overlay').classList.contains('visible');
  const setOnline = (online) => {
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => online });
    w.dispatchEvent(new w.Event(online ? 'online' : 'offline'));
  };
  return { w, clock, audio, wake, spoken, chime, buzz, handlers, button, label, status, conn, overlayShown, setOnline };
}
