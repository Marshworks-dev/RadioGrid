/* ================================================================
   OVERLAY MANAGEMENT
   Shows/hides overlays with focus management. When an overlay opens,
   focus moves to it. When it closes, focus returns to what was
   focused before. Escape key closes the topmost overlay.
   ================================================================ */

/** Focusable element selector for focus trapping. */
var FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

/** Trap Tab/Shift+Tab focus inside a container element. */
function trapFocus(e, container) {
  if (e.key !== 'Tab') return;
  var focusable = Array.from(container.querySelectorAll(FOCUSABLE)).filter(
    function(el) { return el.offsetParent !== null; }
  );
  if (focusable.length === 0) return;
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  // Focus parked on something outside the cycle (a dialog title with
  // tabindex=-1) would otherwise Shift+Tab straight out of the dialog.
  var outsideCycle = focusable.indexOf(document.activeElement) === -1;
  if (e.shiftKey && (document.activeElement === first || outsideCycle)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Focus a saved return target if it is still in the page. */
function restoreFocus(target) {
  if (target && target.isConnected && typeof target.focus === 'function') target.focus();
}

/** Show an overlay and move focus to its first focusable element. */
/* While a dialog is open, everything behind it is inert: out of the tab
   order and hidden from screen readers, which aria-modal alone doesn't do
   on iOS (VoiceOver swiped on into the page behind). Each ancestor's
   siblings are marked, so it works wherever the dialog sits. Dialogs nest
   (the discard prompt over settings): opening one lifts inert from itself
   and its ancestors, and closing it puts back exactly what it changed. */
function inertBehind(el) {
  var marked = [], lifted = [];
  for (var node = el; node && node !== document.body && node.parentElement; node = node.parentElement) {
    if (node.hasAttribute('inert')) { node.removeAttribute('inert'); lifted.push(node); }
    Array.prototype.forEach.call(node.parentElement.children, function(sib) {
      if (sib === node || sib.tagName === 'SCRIPT' || sib.hasAttribute('inert')) return;
      sib.setAttribute('inert', '');
      marked.push(sib);
    });
  }
  el._inert = { marked: marked, lifted: lifted };
}

/** Undo inertBehind(el). Call before moving focus back behind it. */
function releaseInert(el) {
  if (!el._inert) return;
  el._inert.marked.forEach(function(n) { n.removeAttribute('inert'); });
  el._inert.lifted.forEach(function(n) { n.setAttribute('inert', ''); });
  el._inert = null;
}

function showOverlay(el) {
  inertBehind(el);
  el._returnFocus = document.activeElement;
  el.classList.add('visible');
  el._focusTrap = function(e) { trapFocus(e, el); };
  el.addEventListener('keydown', el._focusTrap);
  // Move focus to the first button inside the overlay
  // (unless it closed before the frame: focus on a hidden button is lost)
  var firstBtn = el.querySelector('button');
  if (firstBtn) requestAnimationFrame(() => { if (el.classList.contains('visible')) firstBtn.focus(); });
}

/** Hide an overlay and return focus to what was focused before it opened.
 *  A no-op when it isn't showing: stopPlayback() hides the connection overlay
 *  on every stop, and that must not move focus. */
function hideOverlay(el) {
  if (!el.classList.contains('visible')) return;
  el.classList.remove('visible');
  if (el._focusTrap) {
    el.removeEventListener('keydown', el._focusTrap);
    el._focusTrap = null;
  }
  releaseInert(el);
  restoreFocus(el._returnFocus);
  el._returnFocus = null;
}

/** Find the topmost visible overlay and close it. Returns true if one was closed. */
function closeTopmostOverlay() {
  var helpOverlay = document.getElementById('help-overlay');
  if (helpOverlay.classList.contains('open')) {
    closeHelp();
    return true;
  }
  // Emoji picker has highest z-index
  var emojiOverlay = document.getElementById('emoji-picker-overlay');
  if (emojiOverlay.classList.contains('open')) {
    closeEmojiPicker();
    return true;
  }
  // Stream browser next
  var sbOverlay = document.getElementById('stream-browser-overlay');
  if (sbOverlay.classList.contains('open')) {
    closeStreamBrowser();
    return true;
  }
  // Check overlays first (may be on top of settings panel, e.g. discard confirm)
  var overlays = document.querySelectorAll('.overlay.visible');
  if (overlays.length > 0) {
    var topOverlay = overlays[overlays.length - 1];
    hideOverlay(topOverlay);
    return true;
  }
  // A preview goes back to settings rather than closing it
  if (previewing) {
    endPreview();
    return true;
  }
  // Then check settings panel
  var settingsPanel = document.getElementById('settings-panel');
  if (settingsPanel.classList.contains('open')) {
    closeSettings();
    return true;
  }
  return false;
}


