/* ================================================================
   MEDIA SESSION — lock-screen / notification controls + background audio
   Entirely feature-detected behind ('mediaSession' in navigator). The bare
   Android System WebView (file://) has no mediaSession, so every entry point
   here no-ops and existing behavior is unchanged. Verified on-device in Chrome
   for Android, where lock-screen controls, background audio and call/focus
   interruption are real. Handlers map to the app's EXISTING
   playback functions — no duplicated playback logic.
   ================================================================ */

const mediaSessionOK = ('mediaSession' in navigator);

/** Build a plain MediaMetadata descriptor from a stream + org name. Pure and
    side-effect free so it's unit-testable without a real MediaSession. Returns
    null when there's no stream. Strings flow straight into the MediaMetadata
    constructor (never innerHTML), so no extra escaping is needed. */
function buildMediaMetadata(stream, orgName) {
  if (!stream) return null;
  return {
    title: stream.label || '',
    artist: stream.sub || '',
    album: orgName || '',
    artwork: mediaArtwork()
  };
}

/** Self-contained artwork derived from the inline profile logo (no external
    file — keeps the single-file / file:// guarantee). Returns [] if no logo. */
function mediaArtwork() {
  if (!PROFILE.logoSvg) return [];
  var vb = PROFILE.logoViewBox || '0 0 100 100';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '">' +
            PROFILE.logoSvg + '</svg>';
  var uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
  return [{ src: uri, sizes: 'any', type: 'image/svg+xml' }];
}

/** Push the active stream's metadata to the lock screen. No-op if unsupported. */
function applyMediaMetadata(stream) {
  if (!mediaSessionOK) return;
  try {
    var meta = buildMediaMetadata(stream, cfg.orgName);
    navigator.mediaSession.metadata = meta ? new MediaMetadata(meta) : null;
  } catch (e) { /* MediaMetadata unavailable/threw — non-fatal */ }
}

/** Keep mediaSession.playbackState in sync with the app's playing/paused state. */
function setMediaPlaybackState(state) {
  if (!mediaSessionOK) return;
  try { navigator.mediaSession.playbackState = state; } catch (e) { /* non-fatal */ }
}

/** Set or clear (fn = null) one lock-screen action. Guarded individually
    because setActionHandler throws for actions the platform doesn't support. */
function bindMediaAction(action, fn) {
  try { navigator.mediaSession.setActionHandler(action, fn); }
  catch (e) { /* action unsupported on this platform — skip */ }
}

/** Register lock-screen play/pause/stop once. Skip and seek come and go with
    the stream (updateMediaSessionSkip). */
function registerMediaSessionHandlers() {
  if (!mediaSessionOK) return;
  // Lock-screen play/pause routes through softStop's existing toggle so the
  // resume/fade path and UI updates are reused, not duplicated.
  bindMediaAction('play', function () { if (playing && paused) softStop(); });
  bindMediaAction('pause', function () { if (playing && !paused) softStop(); });
  bindMediaAction('stop', function () { userStop(); });
  updateMediaSessionSkip();
}

/** Offer lock-screen skip and seek only when the in-app skip buttons show. On
    live radio they were dead buttons (or seeked past the live edge), and radio
    listeners read ⏭ as "next station". The browser hides an action that has
    no handler. */
function updateMediaSessionSkip() {
  if (!mediaSessionOK) return;
  var skippable = canSkip();
  bindMediaAction('previoustrack', skippable ? skipBack : null);
  bindMediaAction('nexttrack', skippable ? skipFwd : null);
  bindMediaAction('seekbackward', skippable ? skipBack : null);
  bindMediaAction('seekforward', skippable ? skipFwd : null);
}

