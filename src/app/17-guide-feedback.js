/* ================================================================
   HOW-TO GUIDE
   The hosted build opens its guide (PROFILE.helpUrl, on marsh.city) in
   an overlay. Hidden on file:// — the Android WebView blocks outside
   pages, so the button would be dead there — and when the profile
   names no guide (a branded build). The frame is only created on
   tap, so nothing loads from the guide's site until someone asks.
   ================================================================ */

function helpAvailable() {
  return /^https?:$/.test(location.protocol) &&
    typeof PROFILE.helpUrl === 'string' && /^https:\/\//.test(PROFILE.helpUrl);
}

function openHelp() {
  if (!helpAvailable()) return;
  var overlay = document.getElementById('help-overlay');
  var body = document.getElementById('help-body');
  if (!body.firstChild) {
    if (navigator.onLine === false) {
      var msg = document.createElement('p');
      msg.className = 'help-offline';
      msg.textContent = 'The guide needs an internet connection. Connect and try again.';
      body.appendChild(msg);
    } else {
      var frame = document.createElement('iframe');
      frame.title = 'How to use this app';
      // Empty sandbox: the guide is a static page, so it gets no scripts,
      // forms, popups or same-origin access to this app's storage.
      frame.setAttribute('sandbox', '');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.src = PROFILE.helpUrl;
      body.appendChild(frame);
    }
  }
  overlay.classList.add('open');
  inertBehind(overlay);
  overlay._focusTrap = function(e) { trapFocus(e, overlay); };
  overlay.addEventListener('keydown', overlay._focusTrap);
  document.getElementById('help-close').focus();
}

/** Close the guide; focus goes back to its button unless `moveFocus` is
    false (settings timing out, which must not be read aloud). */
function closeHelp(moveFocus = true) {
  var overlay = document.getElementById('help-overlay');
  if (overlay._focusTrap) {
    overlay.removeEventListener('keydown', overlay._focusTrap);
    overlay._focusTrap = null;
  }
  overlay.classList.remove('open');
  releaseInert(overlay);
  // Drop the frame (or offline notice) so every open starts fresh at the guide,
  // even if a link inside it navigated the frame somewhere else.
  document.getElementById('help-body').innerHTML = '';
  if (moveFocus) document.getElementById('help-btn').focus();
}

/* ================================================================
   FEEDBACK CARD
   A QR code to a static page on marsh.city, for the setter-up's own
   phone, with the address and email as plain text. Nothing is sent by
   the app. Hosted builds only, and off unless the profile turns it on
   (the default profile does).
   ================================================================ */

function showFeedbackCard() {
  // Hosted only, like the guide (the generic APK is frozen without it).
  var on = PROFILE.feedback === true && /^https?:$/.test(location.protocol);
  document.getElementById('feedback-section').hidden = !on;
}

