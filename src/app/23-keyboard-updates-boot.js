/* ================================================================
   KEYBOARD NAVIGATION
   Global keyboard handler for Escape key to close overlays/dialogs.
   ================================================================ */

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    closeTopmostOverlay();
  }
});


/* ================================================================
   APP UPDATES (hosted PWA)
   sw.js serves the app cache-first, so a new version shows only after the
   page reloads, and a kiosk can stay open for weeks. So: ask for a new
   sw.js whenever the app comes back on screen and every 6 hours, and when
   a new worker takes over, reload silently once the radio is quiet:
   nothing playing (paused counts), settings closed and no overlay showing.
   There's no "update available" prompt for the listener to puzzle over.
   An update reload is not a launch: it never auto-resumes, and since it
   only runs while nothing plays, it forgets rgxl_last too. The key stays
   when autoplay blocked a launch, and older versions kept it through Stop,
   so with Resume on the reload, or a power cut after it, could otherwise
   restart a radio someone stopped at bedtime. (The APK has no update
   reload: its first launch after an upgrade can still find an old key.)
   ================================================================ */

const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
const UPDATE_RETRY_MS = 5 * 60 * 1000;
const UPDATE_RELOAD_KEY = 'rgxl_update_reload';
let updatePending = false;
let updateRetryTimer = null;

/** Once the worker registers: look for a new sw.js on return and on a timer. */
function checkForUpdates(reg) {
  const check = () => reg.update().catch(() => { /* offline: the next check retries */ });
  setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/** A new worker took over this page, which is still the old version. */
function onNewVersion() {
  updatePending = true;
  applyUpdateWhenQuiet();
}

/** True while anything is open over the radio: settings or a screen opened
    from it, the PIN pad, the no-network or sleep timer overlay, a confirm.
    Each is marked aria-modal and shows by adding 'visible' (.overlay) or
    'open' (the rest), so there's no list to keep up to date. settingsOpen
    counts on its own: the panel only gets 'open' a frame after openSettings(). */
function overlayShowing() {
  return settingsOpen || !!document.querySelector('[aria-modal="true"].visible, [aria-modal="true"].open');
}

function applyUpdateWhenQuiet() {
  clearTimeout(updateRetryTimer);
  if (!updatePending) return;
  // A reload would wipe a half-typed PIN or a message the listener is reading.
  if ((playing && !paused) || overlayShowing()) {
    updateRetryTimer = setTimeout(applyUpdateWhenQuiet, UPDATE_RETRY_MS);
    return;
  }
  updatePending = false;
  try {
    sessionStorage.setItem(UPDATE_RELOAD_KEY, '1');
  } catch (e) {
    return; // can't mark the reload, so it could auto-resume: leave it for the next launch
  }
  location.reload();
}

/** True, once, when this page load is an update reload. */
function isUpdateReload() {
  try {
    if (!sessionStorage.getItem(UPDATE_RELOAD_KEY)) return false;
    sessionStorage.removeItem(UPDATE_RELOAD_KEY);
    return true;
  } catch (e) {
    return false; // storage unavailable: applyUpdateWhenQuiet() couldn't have set it either
  }
}


/* ================================================================
   BOOT
   ================================================================ */

init();

/* ================================================================
   PWA SERVICE WORKER (progressive enhancement)
   Registered inline to keep the file single-script + self-contained.
   No-ops on file:// (the shipped APK) and anywhere SW is unsupported —
   the guard below means the bare Android System WebView never even tries.
   Never throws: any failure is swallowed so playback is unaffected.
   ================================================================ */
(function registerServiceWorker() {
  // location.protocol is 'http:' or 'https:' only when served by a server.
  // file:// (APK), and browsers without SW support, fall through to no-op.
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  // Listen now, not after register(): the new worker can take over first.
  // The very first install also fires controllerchange (clients.claim), with
  // nothing to reload; only a page that already had a worker is out of date.
  try {
    var controlled = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (controlled) onNewVersion();
      controlled = true;
    });
  } catch (e) { /* updates then wait for the next launch */ }
  window.addEventListener('load', function () {
    try {
      navigator.serviceWorker.register('sw.js').then(checkForUpdates).catch(function () { /* offline-first is best-effort */ });
    } catch (e) { /* never let SW registration break the app */ }
    // Best-effort: ask the browser to keep our cache and settings from being
    // evicted. Only in the installed app, where losing them would hurt and
    // Chrome grants it silently. In a tab, Firefox would answer with a
    // permission prompt a first-time visitor can't make sense of.
    try {
      var installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
      if (installed && navigator.storage && navigator.storage.persisted && navigator.storage.persist) {
        navigator.storage.persisted().then(function (kept) {
          if (!kept) return navigator.storage.persist();
        }).catch(function () {});
      }
    } catch (e) { /* persistence is optional */ }
  });
})();

