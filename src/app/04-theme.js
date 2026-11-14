/* ================================================================
   THEME
   Resolves "auto" to the system preference, then applies the
   appropriate CSS classes and re-renders buttons with new colors.
   ================================================================ */

const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const DEFAULT_THEME_COLOR = themeColorMeta ? themeColorMeta.getAttribute('content') : null;

/** Whether the system asks for more contrast. */
function osWantsMoreContrast() {
  try { return window.matchMedia('(prefers-contrast: more)').matches; } catch (e) { return false; }
}

/* The phone's own text size, read where the browser shares it: Safari sizes
   the -apple-system-body font by the iOS Larger Text setting (17 px at the
   default; the accessibility sizes start at 28 px). Elsewhere the font is
   unknown and the probe reads the page's 16 px. */
const OS_TEXT_XLARGE_PX = 28;

/** The Text Size a fresh install starts at for the phone's text size: X-Large
    for the iOS accessibility sizes, otherwise null (the usual default). */
function osStartingTextSize() {
  try {
    var probe = document.createElement('span');
    probe.style.font = '-apple-system-body';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.textContent = 'A';
    document.body.appendChild(probe);
    var px = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return px >= OS_TEXT_XLARGE_PX ? 'xlarge' : null;
  } catch (e) {
    return null;
  }
}

/** The theme to paint: an Auto choice resolved to its dark or light half by the system preference. */
function resolveTheme() {
  var t = cfg.theme;
  // Any Auto theme follows the phone's Increase Contrast (iOS) or high
  // contrast setting, as it follows dark mode. A theme picked by hand is
  // left alone, and the saved choice stays Auto.
  if ((t === 'auto' || t === 'mono-auto' || t === 'contrast-auto') && osWantsMoreContrast()) {
    return 'contrast-' + (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  if (t === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  if (t === 'mono-auto' || t === 'contrast-auto') {
    var family = t.slice(0, -'auto'.length);
    return family + (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  return t;
}

/** The orientation to draw. A new choice waits until settings closes:
    applied at once, it turned the open settings panel sideways under the
    finger that chose it. The saved one holds meanwhile, so opening settings
    on a sideways kiosk doesn't turn it upright. */
function shownOrientation() {
  return settingsOpen && cfgSnapshot ? cfgSnapshot.orientation : cfg.orientation;
}

/** Apply the current theme, size, and desktop view mode to the DOM. */
function applyTheme() {
  const resolved = resolveTheme();
  const base = (platform.isDesktop ? 'is-desktop' : 'is-android') + (platform.isIOS ? ' is-ios' : '');
  const fill = (platform.isDesktop && cfg.fillview === 'on') ? ' fill-view' : '';
  const orient = shownOrientation() !== 'auto' ? ' force-' + shownOrientation() : '';
  const snap = document.documentElement.classList.contains('theme-snap') ? ' theme-snap' : ''; // see snapTheme()
  const fading = document.documentElement.classList.contains('theme-fading') ? ' theme-fading' : ''; // see fadeTheme()
  document.documentElement.className = base + fill + orient + snap + fading + ' theme-' + resolved;
  // The browser bar / Android status bar matches the header in every theme
  // (Night's header is black, which has no blue). Read from the theme's own
  // --header-bg token so there's no second colour table to drift; custom
  // properties don't transition, so this is the new theme's value at once.
  if (themeColorMeta) {
    var headerBg = getComputedStyle(document.documentElement).getPropertyValue('--header-bg').trim();
    themeColorMeta.setAttribute('content', headerBg || DEFAULT_THEME_COLOR);
  }
  document.documentElement.setAttribute('data-size', cfg.size);
  applyAccessOptions(); // every load, apply, revert, import and reset path runs through here
  showCredit(); // the credit is the logo block or the text line, by theme
  renderButtons();
}

const FIXED_VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
const ZOOMABLE_VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover';

/** Whether pinch-zoom is on. The touch and Safari gesture blockers ask
    this at each event, so the switch takes effect without a reload. */
function zoomAllowed() {
  return cfg.zoom === 'on';
}

/** The two Setup switches that change the page itself: pinch-zoom (the
    viewport, rewritten live; browsers re-read it) and the header's Settings
    button. With the button hidden, the logo is the way into settings. */
function applyAccessOptions() {
  document.getElementById('viewport-meta').setAttribute('content', cfg.zoom === 'on' ? ZOOMABLE_VIEWPORT : FIXED_VIEWPORT);
  document.getElementById('settings-btn').hidden = !settingsButtonShown();
  labelLogo();
  document.getElementById('pin-hint').textContent = '4 digits, or blank for none.'
    + (settingsButtonShown() ? '' : ' Tap the logo 5 times to open settings.');
}

function settingsButtonShown() {
  return cfg.settingsButton === 'on';
}

/** The logo is a button only while five taps on it open settings; next to
    a Settings button it's the radio's name and nothing to press. */
function labelLogo() {
  var logo = document.getElementById('logo-area');
  if (settingsButtonShown()) {
    logo.removeAttribute('role');
    logo.removeAttribute('tabindex');
    logo.removeAttribute('aria-label');
    return;
  }
  logo.setAttribute('role', 'button');
  logo.setAttribute('tabindex', '0');
  logo.setAttribute('aria-label', cfg.orgName.replace(/\n/g, ' ') + ' — tap 5 times for settings');
}

/** Where to change the speaking voice on this device. Only the APK has an
    OS Settings button; iPhone and iPad call it Spoken Content. */
function voiceSettingsHint(hasBridge) {
  if (hasBridge) return 'To change the voice or improve quality, use OS Settings below (Accessibility → Text-to-speech output).';
  if (platform.isIOS) return 'To change the voice, open the Settings app: Accessibility → Spoken Content → Voices.';
  if (platform.isAndroid) return "To change the voice, open this device's Settings app and search for Text-to-speech.";
  return "The voice is your computer's own; change it in its system settings.";
}

/** Skip the background fade for the theme change just made. */
function snapTheme() {
  var root = document.documentElement;
  root.classList.add('theme-snap');
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { root.classList.remove('theme-snap'); });
  });
}

/* iOS Safari colours its status bar and the home-bar strip from the page's
   own edges, and re-reads them only when a new fixed layer appears at an edge
   (settings opening is one), not when the colours under them change. Found
   in the simulator 2026-11-07: after a light/dark switch the bar kept the old
   theme's colour, and after closing settings it kept the panel's. So after a
   theme change, add a fixed strip at each edge in the colour already there
   (no visible change) and take it away again: Safari re-reads both. The top
   strip has to reach below the status bar, where Safari samples. It waits
   out the colour fades (the stop bar's runs 0.3 s), or the bottom strip took
   the old theme's colour mid-fade. On an iPhone the stop and transport bars
   don't fade (04-transport.css), so a Stop or a station tap waits only for
   the paint: with the full wait, the home-bar strip lagged the bar. */
const RETINT_HOLD_MS = 250;
const RETINT_AFTER_MS = 350;
const RETINT_SNAPPED_MS = 50;
let retintTimer = null;
let retintWait = 0;

/** The painted background at the bottom edge: the first non-transparent
    one from the element there up. */
function bottomEdgeColour() {
  var el = document.elementFromPoint ? document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1) : null;
  for (; el && el !== document.documentElement; el = el.parentElement) {
    var bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return 'var(--screen-bg)';
}

/** `afterMs` is how long the colour change takes to settle. A longer wait
    already pending stands, so a quick retint never lands mid-fade. */
function retintSafariBars(afterMs = RETINT_AFTER_MS) {
  if (!platform.isIOS) return;
  if (retintTimer && retintWait > afterMs) return;
  clearTimeout(retintTimer);
  retintWait = afterMs;
  retintTimer = setTimeout(addRetintStrips, afterMs);
}

function addRetintStrips() {
  retintTimer = null;
  var edges = [
    'top:0;height:calc(env(safe-area-inset-top) + 24px);background:var(--header-bg)',
    'bottom:0;height:calc(env(safe-area-inset-bottom) + 24px);background:' + bottomEdgeColour(),
  ];
  edges.forEach(function(edge) {
    var strip = document.createElement('div');
    strip.className = 'retint-strip';
    strip.setAttribute('aria-hidden', 'true');
    strip.style.cssText = 'position:fixed;left:0;right:0;pointer-events:none;z-index:1;' + edge;
    document.body.appendChild(strip);
    setTimeout(function() { strip.remove(); }, RETINT_HOLD_MS);
  });
}

/** Apply the configurable organization name to the header. */
function applyOrgName() {
  var el = document.getElementById('org-name');
  // Split on newlines to support multi-line names (joined with <br>)
  var lines = cfg.orgName.split('\n');
  el.innerHTML = lines.map(l => escHtml(l)).join('<br>');
  // Update aria-label with plain text version
  labelLogo();
}

/**
 * Look up the color scheme for a given palette ID and theme.
 * Falls back to the first palette if the ID is unrecognized.
 */
function getColor(colorId, themeKey) {
  const p = PALETTE.find(c => c.id === colorId);
  if (!p) return PALETTE[0][themeKey];
  return p[themeKey];
}


/** The stations the grid shows: all of them while settings is open,
    otherwise those with an address (all, if none has one). */
function gridStreams() {
  if (settingsOpen) return cfg.streams;
  var playable = cfg.streams.filter(function(s) { return s.url && s.url.trim(); });
  return playable.length ? playable : cfg.streams;
}

