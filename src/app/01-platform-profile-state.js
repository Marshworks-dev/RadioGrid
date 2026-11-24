
/* ================================================================
   PLATFORM DETECTION
   Determines if the device is mobile (Android/iOS) or desktop.
   This affects which UI features are shown (volume slider, card
   mode, haptics, etc.) and cannot change at runtime.
   ================================================================ */

const platform = (function () {
  const ua = navigator.userAgent || '';
  const isAndroid = /android/i.test(ua);
  // iPadOS asks for desktop sites, so it reports a Mac user agent; a Mac
  // with multi-touch is an iPad.
  const isIOS = /ipad|iphone|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const isMobile = isAndroid || isIOS || (navigator.maxTouchPoints > 0 && hasCoarsePointer);
  return { isAndroid, isIOS, isMobile, isDesktop: !isMobile };
})();

document.documentElement.classList.add(platform.isDesktop ? 'is-desktop' : 'is-android');
if (platform.isIOS) document.documentElement.classList.add('is-ios');


/* ================================================================
   COLOR PALETTES
   Eight distinct hues for stream buttons. Each has dark and light
   theme variants with idle (bg) and playing (active) states.

   Design goals:
   - Every background, idle and playing, holds WCAG AA 4.5:1 with
     the white label and description, also under the desktop hover
     tint. The label shrinks to fit small screens, so the large-text
     3:1 can't be counted on.
     tests/contrast.test.mjs measures every entry.
   - Hues are well-separated so buttons are visually distinct
   - Active state is noticeably brighter than idle in dark mode,
     and deeper in light mode, but colour is never the only cue:
     playing adds an accent ring and ▮▮, paused a dashed ring and ▶.
     Dark-mode playing colours stay dark enough for the yellow ring
     and ▮▮ to hold 3:1 against them.
   - For color blindness: rely on OS accessibility settings (the
     kiosk tablets support system-level color correction filters)
   ================================================================ */

const PALETTE = [
  { id: 'blue',   dark: { bg: '#1a3d6e', active: '#2b6cb0' }, light: { bg: '#2b6cb0', active: '#1a4178' } },
  { id: 'green',  dark: { bg: '#1a5235', active: '#277751' }, light: { bg: '#27804a', active: '#1a5535' } },
  { id: 'purple', dark: { bg: '#3f1d70', active: '#6436b5' }, light: { bg: '#5a3aad', active: '#3d2478' } },
  { id: 'teal',   dark: { bg: '#155858', active: '#1c7574' }, light: { bg: '#1e7c7a', active: '#155a58' } },
  { id: 'red',    dark: { bg: '#6d1f1f', active: '#b03636' }, light: { bg: '#a13030', active: '#7a2020' } },
  { id: 'amber',  dark: { bg: '#6b4d10', active: '#866415' }, light: { bg: '#8f6a18', active: '#664c10' } },
  { id: 'slate',  dark: { bg: '#2a4058', active: '#436a95' }, light: { bg: '#3e6088', active: '#2c4560' } },
  { id: 'rose',   dark: { bg: '#6a1d42', active: '#a83070' }, light: { bg: '#952a60', active: '#701d45' } },
];


/* === PROFILE CONFIG — build-profile.mjs replaces this block === */
const PROFILE = {
  orgName: 'RadioGrid',
  pin: '',
  logoSvg: '<rect class="logo-tile" fill="#58c6f8" x="28.75" y="28.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="39.75" y="28.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="50.75" y="28.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="28.75" y="39.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="61.75" y="39.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="28.75" y="50.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="39.75" y="50.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="50.75" y="50.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="28.75" y="61.75" width="9.5" height="9.5" rx="2.6"/><rect class="logo-tile" fill="#58c6f8" x="61.75" y="61.75" width="9.5" height="9.5" rx="2.6"/>',
  logoViewBox: '25 25 50 50',
  helpUrl: 'https://marsh.city/embed/guides/radiogridxl/',
  feedback: true,
  madeBy: 'MarshWorks',
  streams: [
    {
      id: 's1',
      label: 'Radio Paradise Mellow Mix',
      sub: 'Soft rock and acoustic, no ads',
      url: 'https://stream.radioparadise.com/mellow-128',
      emoji: '🎸',
      color: 'green'
    },
    {
      id: 's2',
      label: 'YourClassical Relax',
      sub: 'Quiet classical',
      url: 'https://relax.stream.publicradio.org/relax.mp3',
      emoji: '🎻',
      color: 'blue'
    }
  ]
};
/* === END PROFILE CONFIG === */


/* ================================================================
   ACCESSIBILITY PRESETS
   Data-driven named bundles of DISPLAY/INTERACTION settings. Each
   preset's `apply` keys are a subset of cfg fields (theme/size/advanced/
   haptics/tts/chime/fillview). Presets DELIBERATELY never touch
   streams, orgName, orientation, volume, or pin — those stay owned by their
   own editors. Applying a preset is a starting point, not a lock: the admin
   can still fine-tune each control afterward (which flips cfg.preset to
   'custom'). Adding a preset here is the only change needed to extend the
   feature — UI and tests read this const, not a hardcoded list.
   ================================================================ */
const PRESETS = [
  {
    name: 'Standard',
    label: 'Standard',
    apply: { theme: 'auto', size: 'large', advanced: 'off', haptics: 'on', tts: 'off', chime: 'on', fillview: 'on' }
  },
  {
    name: 'Low Vision',
    label: 'Low Vision',
    apply: { theme: 'contrast-dark', size: 'ultra', advanced: 'off', haptics: 'on', tts: 'on', chime: 'on', fillview: 'on' }
  },
  {
    name: 'Simplest',
    label: 'Simplest',
    apply: { theme: 'auto', size: 'xlarge', advanced: 'off', haptics: 'off', tts: 'off', chime: 'off', fillview: 'on' }
  }
];

/** Fields a preset is allowed to set. Used to detect 'custom' drift and to
    guard application against any stray key in a preset's `apply`. */
const PRESET_FIELDS = ['theme', 'size', 'advanced', 'haptics', 'tts', 'chime', 'fillview'];


/* ================================================================
   APP STATE
   `cfg` holds all user-configurable settings (persisted to LocalStorage).
   The other variables track runtime state that resets on page load.
   ================================================================ */

const cfg = {
  orgName: PROFILE.orgName,
  theme: 'auto',
  size: 'large',
  fillview: 'on',
  volume: 100,
  advanced: 'off',
  haptics: 'on',
  tts: 'off',
  chime: 'on',
  resume: 'off',
  zoom: 'off',
  settingsButton: 'on', // a new radio only: loadSettings() hides it on any radio saved without it
  preset: 'Standard',
  orientation: PROFILE.orientation || 'auto',
  streams: JSON.parse(JSON.stringify(PROFILE.streams))
};

/* Playback state */
let playing = null;       // ID of the currently playing stream, or null
let paused = false;       // Whether the currently playing stream is paused
let retryTimer = null;    // setTimeout handle for auto-retry on error
let fadeTimer = null;     // setInterval handle for volume fade-in on stream start
let pendingFade = false;  // true when a new stream start should fade in once playing fires
let retryCount = 0;       // consecutive errors before marking stream as failed
const failedStreams = new Set(); // stream IDs that have exhausted retries
let autoplayBlocked = false; // a launch's auto-resume was refused by the browser: the station waits for a tap
let streamFault = false;  // the active stream errored and hasn't played since;
                          // the element can't recover by itself, so resume reloads
let pausedByFailure = null; // the error the browser paused the element for as the
                            // stream failed (Chromium does); its 'pause' isn't the
                            // listener's. Tied to that error, so a reload ends it
let awaitingSound = false; // a start or resume hasn't heard audio yet: its tile reads "Starting…"
const recordingPlaces = new Map(); // recording URL -> seconds in, kept when it stops
                                   // (memory only), so its next tap carries on there
let pendingSeek = null;   // the place the source now loading should carry on from
let stopPointTimer = null; // ends the highlight a second tap puts on Stop (pointAtStop)
const STOP_POINT_MS = 2000;
let announceOnPlay = null; // station label to say "Now playing" for once its audio starts
let liveSource = false;   // the active source loaded with no end (live radio): the
                          // server hanging up is a lost connection, not the end.
                          // Kept if the browser reports a length at the cut-off
let stallWatch = null;    // setInterval handle for the no-audio check (watchForStall)
let stallChecks = 0;      // consecutive checks with no playback progress
let lastPosition = 0;     // audio.currentTime at the last check
let steadyFrom = null;    // audio.currentTime when play resumed after the last lost
                          // connection; STEADY_S of progress past it resets
                          // retryCount. null when no reset is pending

const RETRY_DELAY_MS = 4000;  // wait before each quiet reconnect
const MAX_TRIES = 4;          // lost connections in a row before a station gives up
const STALL_MS = 20000;       // this long with no audio arriving counts as a lost connection
const STALL_CHECK_MS = 2000;
const STEADY_S = 60;          // a reconnected station must play this long before its tries reset

/* Sleep timer state */
let sleepRemaining = 0;   // seconds remaining until auto-stop
let sleepTick = null;     // setInterval handle for countdown
let sleepStatusTimer = null; // clears the spoken confirmation; replaced by each new one
let connQuiet = false;    // true while the sleep timer stops playback: the dot changes without a word

/* UI timers */
let skipToastTimer = null; // setTimeout handle for skip action toast

/* Wake lock */
let wakeLock = null;      // WakeLockSentinel — keeps screen on during playback

/* Focus management — each overlay and the settings panel keep their own return
   target (el._returnFocus); one shared global was overwritten by nested overlays. */

/* Settings preview — snapshot of cfg before editing, used to revert on cancel */
let cfgSnapshot = null;

/* True only between openSettings() and doCloseSettings(). Settings actions check
   it, so a click that still reaches the closed panel does nothing. */
let settingsOpen = false;
/* True while settings is slid aside to preview the grid (settingsOpen stays true). */
let previewing = false;


/* ================================================================
   DOM REFERENCES
   Cached once at startup to avoid repeated lookups.
   ================================================================ */

const audio        = document.getElementById('audio-player');
const buttonsEl    = document.getElementById('buttons');
const connDot      = document.getElementById('conn-dot');
const connText     = document.getElementById('conn-text');
const sleepInd     = document.getElementById('sleep-indicator');
const sleepCountdown = document.getElementById('sleep-countdown');
const sleepLeft    = document.getElementById('sleep-left');
const sleepStatus  = document.getElementById('sleep-status');
const simpleStop   = document.getElementById('simple-stop');
const advTransport = document.getElementById('adv-transport');
const skipToast    = document.getElementById('skip-toast');
const nonetOverlay = document.getElementById('nonet-overlay');


