/* ================================================================
   STREAM BUTTON RENDERING
   Rebuilds all stream buttons from `cfg.streams`. Called on init,
   theme change, and after playback state changes.
   Uses grid layout (2 columns) when there are more than 3 streams.
   ================================================================ */

/* Button text sizes in px for each Text Size setting: title, description,
   emoji, and the emoji on its own in compact mode. These are the sizes when a
   button has room. renderButtons() scales them down to fit its row, keeps
   titles to the size at which their longest word fits, and stops a title
   short of wrapping to a line the row has no room for. That last can hold two
   settings to the same title size, each with the rest of its button scaled
   down by as much as its title. So being bigger isn't enough: at each step
   up, the description and emoji are also bigger next to the title (15/34 <
   18/40 < 24/52 < 30/64, and 32/34 < 38/40 < 50/52 < 62/64). Then a larger
   setting never shows a smaller description or emoji, and its title is the
   same size or bigger. tests/layout.test.mjs checks this on phones and
   tablets. */
const BUTTON_TEXT_SIZES = {
  normal: { label: 34, sub: 15, emoji: 32, compactEmoji: 48 },
  large:  { label: 40, sub: 18, emoji: 38, compactEmoji: 54 },
  xlarge: { label: 52, sub: 24, emoji: 50, compactEmoji: 64 },
  ultra:  { label: 64, sub: 30, emoji: 62, compactEmoji: 76 }
};

/* Rough width of some button text in em, at the heavy weight titles use.
   renderButtons() needs it before the buttons exist, to keep each word of a
   title inside its button. Each group counts as its widest character in SF
   Pro Black, Helvetica Neue Bold and Arial Bold (measured), so the estimate
   errs wide by about 5-15%: text sized by it fits, with a little to spare. */
const TEXT_WIDTH_EM = [
  [' ', 0.28], ["ijlI.,'|", 0.31], ['frt', 0.42], [':;()[]{}/\\-!', 0.46],
  ['EFL', 0.67], ['JPSTZ0123456789', 0.71], ['mwM', 0.93], ['W%@', 1.01]
];
function textWidthEm(text) {
  var em = 0;
  for (const ch of text) {
    const c = ch.normalize('NFD')[0]; // an accented letter is as wide as its letter
    const group = TEXT_WIDTH_EM.find(function(g) { return g[0].includes(c); });
    if (group) em += group[1];
    else if (c >= 'a' && c <= 'z') em += 0.64;
    else if (c < '\u0080') em += 0.78; // the other capitals and ASCII symbols
    else em += 1.1;                    // emoji, CJK and other symbols
  }
  return em;
}

/* How many lines `text` takes at `px` in a box `width` px wide, wrapping at
   spaces as the buttons do. */
function textLines(text, px, width) {
  var space = textWidthEm(' ') * px;
  var lines = 1, used = 0;
  text.split(/\s+/).filter(Boolean).forEach(function(word) {
    var w = textWidthEm(word) * px;
    if (used > 0 && used + space + w > width) { lines++; used = w; }
    else used += (used > 0 ? space : 0) + w;
  });
  return lines;
}

function renderButtons() {
  // The old address's last build shows where the radio went instead (24-moved.js).
  if (movedTo()) { renderMoved(movedTo()); return; }
  const themeKey = resolveTheme().endsWith('light') ? 'light' : 'dark';
  // A station with no address can't play, so the listener never sees it.
  // Settings shows it (its preview is how a new one gets set up), and Apply
  // won't save one; this covers configs saved before that.
  const streams = gridStreams();
  const count = streams.length;

  // Measure available height by subtracting fixed siblings from the app container.
  // This is more reliable than reading buttonsEl.clientHeight which depends on
  // flex layout and content that we're about to replace.
  var appEl = document.getElementById('app');
  var headerEl = document.getElementById('header');
  var simpleStop = document.getElementById('simple-stop');
  var advTrans = document.getElementById('adv-transport');
  var appH = appEl.clientHeight;
  var transportH = (advTrans && advTrans.classList.contains('visible'))
    ? advTrans.offsetHeight
    : simpleStop.offsetHeight + document.getElementById('simple-stop-inset').offsetHeight;
  // Height left for the buttons under the header as it is right now.
  function measureAvailH() {
    var h = appH - headerEl.offsetHeight - transportH;
    return h < 100 ? window.innerHeight - 150 : h; // absolute fallback
  }
  // Measure under the full header. The last layout may have left it compact
  // (a landscape phone), and the rows must be sized for the header that ends
  // up showing, or the bottom row is clipped after a rotation.
  headerEl.classList.remove('compact');
  var availH = measureAvailH();


  // Determine column count based on stream count and aspect ratio.
  // Landscape or wide screens use more columns to reduce row count.
  var isLandscape = window.innerWidth > window.innerHeight;
  // Sideways, 5-8 stations split into two even rows (5 is 3+2, 6 is 3+3,
  // 7 is 4+3, 8 is 4+4), the shorter row's buttons growing to fill it. A
  // full-width first button there made 1-4-1 rows: a third row on a short
  // screen, which left a phone only room for icons.
  var twoRows = isLandscape && count >= 5;
  var cols = 1;
  if (count <= 3 && !isLandscape) cols = 1;
  else if (count <= 4) cols = 2;
  else if (twoRows) cols = Math.ceil(count / 2);
  else cols = 2;

  var useGrid = cols > 1;
  var oddGrid = useGrid && !twoRows && count % cols !== 0;
  // An odd grid makes button 0 a full-width "primary" (flex: 0 0 100%), which
  // eats a whole row by itself. Count that row — otherwise the row height is
  // oversized and the final row overflows below the clipped (overflow:hidden)
  // container, pushing a stream off-screen. Bug only bit landscape 3-4 col
  // layouts (n=5/6/7); for cols=2 the formulas coincide, so no regression.
  var rows = oddGrid ? 1 + Math.ceil((count - 1) / cols) : Math.ceil(count / cols);

  // The grid is rebuilt from scratch, which destroys the focused button and any
  // running tap flash. Note both so the replacements get them back: a screen
  // reader user keeps their place (and hears the new state), and the flash shows.
  // Only a running flash has the class: doHaptic() takes it off when it ends.
  const focused = document.activeElement;
  const focusedId = focused && buttonsEl.contains(focused) ? focused.id : null;
  const flashingIds = Array.from(buttonsEl.querySelectorAll('.tap-flash.flash'), (f) => f.parentElement.id);
  buttonsEl.innerHTML = '';
  buttonsEl.classList.toggle('grid-mode', useGrid);
  buttonsEl.style.setProperty('--btn-cols', cols);

  var heightPerRow = availH / rows;

  // Compact header when rows are very tight. It changes the header's height,
  // so measure again and work out the tiers below from the space it leaves.
  if (heightPerRow < 80 && count > 4) {
    headerEl.classList.add('compact');
    availH = measureAvailH();
    heightPerRow = availH / rows;
  }

  // Display mode tiers based on available height per row:
  //   Full:       emoji + label + sublabel + state  (needs ~130px+)
  //   Label-only: just the title                     (needs ~60px+)
  //   Compact:    emoji/initial icon only             (any height)
  //
  // 1-4 stations never go emoji-only; 5 or more decide by the room a row
  // has, like any other count. 6-8 used to go emoji-only on every screen,
  // a large tablet included, so a reader lost every station's name.
  var compact, hideSub;
  if (count <= 3) {
    // 1-3 stacked: always full, plenty of room
    compact = false;
    hideSub = heightPerRow < 120;
  } else if (count === 4) {
    // 2x2 grid: full on tablets, may need label-only on phones
    compact = false;
    hideSub = heightPerRow < 130;
  } else {
    // 3+ rows: names on most screens, descriptions where rows are tall,
    // emoji-only only when a row is too short for a name
    compact = heightPerRow < 70;
    hideSub = !compact && heightPerRow < 160;
  }

  buttonsEl.classList.toggle('compact-mode', compact);
  buttonsEl.classList.toggle('hide-sub', hideSub);

  // Calculate scale from available height.
  // Target: each row gets its fair share of space, buttons fill it.
  var gap = 6;
  var totalGaps = (rows - 1) * gap + gap * 2; // gaps + padding
  var rowH = (availH - totalGaps) / rows;

  // Set explicit row height so grid-mode buttons don't overflow
  if (useGrid) {
    buttonsEl.style.setProperty('--btn-row-h', Math.floor(rowH) + 'px');
  } else {
    buttonsEl.style.removeProperty('--btn-row-h');
  }

  // Base sizes for the chosen text size. hideSub removes sublabel/emoji/state,
  // keeping just the title, so none of those count towards the fit; compact
  // keeps only the emoji and state.
  var sizeMode = document.documentElement.getAttribute('data-size') || '';
  var sizes = BUTTON_TEXT_SIZES[sizeMode] || BUTTON_TEXT_SIZES.normal;
  // Text grows with the screen: Ultra's titles are 11% of its short side
  // stacked, 7% in a grid, and every size grows by that same factor, so a big
  // iPad's tiles don't keep phone-sized names (only Ultra used to grow) and a
  // larger setting stays larger. On a phone it comes out under 1: the base
  // sizes win.
  function screenGrow() {
    var vmin = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(1, vmin * (useGrid ? 0.07 : 0.11) / BUTTON_TEXT_SIZES.ultra.label);
  }
  var grow = screenGrow();
  var basePad = compact ? 8 : 16;
  var baseEmoji = (compact ? sizes.compactEmoji : (hideSub ? 0 : sizes.emoji)) * grow;
  var baseLabel = compact ? 0 : sizes.label * grow;
  var baseSub = compact || hideSub ? 0 : sizes.sub * grow;
  var baseState = compact ? 11 : (hideSub ? 0 : 12);

  // Width the text in button i has: its share of the grid, less its padding
  // and the border MonoRadio (2px) and High Contrast (3px) draw. It assumes
  // the full padding and gaps, which only shrink. Before the grid has a width
  // (it is hidden), there is no limit, and text is sized by height alone.
  var edge = /theme-contrast/.test(document.documentElement.className) ? 3 : 2;
  var gridW = buttonsEl.clientWidth;
  function textWidthOf(i) {
    if (!(gridW > 0)) return Infinity;
    var btnW = !useGrid ? gridW - 8 // the stack's 4px padding
      : (oddGrid && i === 0) ? gridW - 2 * gap
      : (gridW - (cols + 1) * gap) / cols;
    return btnW - 2 * basePad - 2 * edge;
  }

  // Titles wrap at spaces, and a word wider than its button is cut off. So
  // titles are no bigger than the size at which every word fits its button,
  // and the fit counts the lines they wrap to.
  var titles = compact ? [] : streams.map(function(s, i) {
    return { text: s.label, width: textWidthOf(i) };
  });
  var maxTitle = Infinity;
  titles.forEach(function(t) {
    t.text.split(/\s+/).forEach(function(word) {
      if (word) maxTitle = Math.min(maxTitle, t.width / textWidthEm(word));
    });
  });
  // Never invisibly small, and the same smallest title at every text size: a
  // word too long for its button even then is cut off at every size alike,
  // so a larger size's description and icon stay larger.
  maxTitle = Math.max(maxTitle, BUTTON_TEXT_SIZES.normal.label * 0.3);

  function titleAt(scale) { return Math.min(baseLabel * scale, maxTitle); }
  // The playing/paused glyph is 0.7 x the title, or a third of the icon in
  // compact, which has no title, and never under 12px there: compact only
  // happens on rows too short for a name, where a third of the icon is tiny.
  // Every button keeps room for it, so starting or pausing a station never
  // overflows its button.
  function glyphAt(scale) { return compact ? Math.max(12, baseEmoji * scale / 3) : (hideSub ? 0 : titleAt(scale) * 0.7); }
  // A station in trouble says so in words where its description goes, in
  // every layout, tight and compact ones included. Compact has room for "Not
  // available" alone; the aria-label always has the full text.
  var statuses = streams.map(function(s) {
    if (failedStreams.has(s.id)) return compact ? 'Not available' : 'Not available. Tap to try again.';
    if (!compact && playing === s.id && !paused && streamFault) return 'Reconnecting…';
    // Auto-resume at launch can be refused until someone taps: say so on
    // screen, not only to a screen reader, or the radio looks broken.
    if (playing === s.id && paused && autoplayBlocked) return 'Tap to resume';
    return '';
  });
  // Button i's status is the description's size, but never under 12px: it
  // says in words what's wrong with the station, so on a tight button the
  // rest of its text shrinks to make room instead. It is smaller only if
  // that's what lets its longest word fit the button ("Reconnecting…" can't
  // wrap).
  function statusAt(scale, i) {
    var longest = Math.max.apply(null, statuses[i].split(' ').map(textWidthEm));
    return Math.min(Math.max(12, sizes.sub * grow * scale), textWidthOf(i) / longest);
  }

  // Height of a button's content at `scale`: padding, then each line of text
  // (titles are 1.05em a line, descriptions and the glyph about 1.2em), plus
  // 12 px for the gaps between them. The tallest title sets it for the grid.
  // With `i`, it is button i, whose status takes the description's place, in
  // up to two lines of 1.1em.
  function contentAt(scale, i) {
    var title = titleAt(scale);
    var lines = 1;
    (i === undefined ? titles : titles.slice(i, i + 1)).forEach(function(t) {
      lines = Math.max(lines, textLines(t.text, title, t.width));
    });
    var second = baseSub * 1.2 * scale;
    if (i !== undefined) {
      var status = statusAt(scale, i);
      second = status * 1.1 * Math.min(2, textLines(statuses[i], status, textWidthOf(i)));
    }
    return (basePad * 2 + baseEmoji + 12) * scale + second + title * 1.05 * lines +
      Math.max(baseState * scale, glyphAt(scale) * 1.2);
  }

  // The largest scale, up to 1, at which a button's content fits its row.
  // Content only grows with the scale, so close in on it from both sides,
  // until the two are a billionth apart. Where a title stops short of
  // wrapping, several text sizes stop at that same title size, and this close
  // they land within a millionth of a pixel of it, so they round to the same
  // size: a larger setting doesn't come out a hair smaller.
  function fitScale(i) {
    if (contentAt(1, i) <= rowH) return 1;
    var fits = 0.3, tooBig = 1; // floor — never go invisibly small
    while (tooBig - fits > 1e-9) {
      var mid = (fits + tooBig) / 2;
      if (contentAt(mid, i) > rowH) tooBig = mid; else fits = mid;
    }
    return fits;
  }
  // Names-only rows keep the station's icon where it fits: where adding it
  // costs the name no more than 15% of its size. The fit is worked out both
  // ways and the title sizes compared, so a wide button whose title is held
  // by its longest word keeps the icon for free.
  // The choice is made once, at the Normal size, for every text size. Made
  // per size, a larger size could keep the icon a smaller one dropped and
  // show a smaller name.
  var keepIcon = false;
  if (hideSub && !compact) {
    var ownLabel = baseLabel;
    baseLabel = BUTTON_TEXT_SIZES.normal.label * grow;
    baseEmoji = 0;
    var plainTitle = titleAt(fitScale());
    baseEmoji = BUTTON_TEXT_SIZES.normal.emoji * grow;
    keepIcon = titleAt(fitScale()) >= 0.85 * plainTitle;
    baseLabel = ownLabel;
    baseEmoji = keepIcon ? sizes.emoji * grow : 0;
  }
  buttonsEl.classList.toggle('keep-icon', keepIcon);
  var scale = fitScale();

  // A status gets the room it needs on its own button, so the other stations
  // keep their size while one is in trouble. Where the full "Not available.
  // Tap to try again." would run to a third line, it says "Not available".
  var statusScales = statuses.map(function(text, i) {
    if (!text) return 0;
    var own = Math.min(scale, fitScale(i));
    if (textLines(text, statusAt(own, i), textWidthOf(i)) > 2) {
      statuses[i] = 'Not available';
      own = Math.min(scale, fitScale(i));
    }
    return own;
  });

  // Text sizes keep two decimals: where the fit squeezes two text sizes to
  // within a pixel of each other, the larger setting still comes out larger.
  // Titles held to one size by the same word or line come out the same.
  function px(n) { return Math.round(n * 100) / 100 + 'px'; }
  // The sizes for `scale`, on the grid or on one button with a status.
  function setSizes(el, scale) {
    el.style.setProperty('--btn-label-size', px(titleAt(scale)));
    el.style.setProperty('--btn-sub-size', px(baseSub * scale));
    el.style.setProperty('--btn-emoji-size', px(baseEmoji * scale));
    el.style.setProperty('--btn-state-size', px(baseState * scale));
    el.style.setProperty('--btn-glyph-size', px(glyphAt(scale)));
    el.style.setProperty('--btn-pad', Math.round(basePad * scale) + 'px');
    el.style.setProperty('--btn-pad-h', Math.round(basePad * scale) + 'px');
    el.style.setProperty('--btn-inner-gap', Math.round(3 * scale) + 'px');
  }
  setSizes(buttonsEl, scale);
  buttonsEl.style.setProperty('--btn-gap', Math.round(gap * Math.max(scale, 0.5)) + 'px');

  streams.forEach((s, i) => {
    const c = getColor(s.color || PALETTE[i % PALETTE.length].id, themeKey);
    const isActive = playing === s.id;
    const isPrimary = oddGrid && i === 0;
    const isFailed = failedStreams.has(s.id);

    const btn = document.createElement('button');
    const isPaused = isActive && paused;
    btn.className = 'stream-btn' + (isActive && !isPaused ? ' active' : '') + (isPaused ? ' paused' : '') + (isPrimary ? ' primary' : '') + (isFailed ? ' failed' : '');
    btn.id = 'btn-' + s.id;
    btn.style.background = (isActive && !isPaused) ? c.active : c.bg;
    btn.setAttribute('data-bg', c.bg);
    btn.setAttribute('data-active', c.active);
    btn.onclick = () => playStream(s.id);

    // The name is the station's own name, so saying it presses the button
    // (Voice Control matches the whole name). Playing is aria-pressed, and
    // the description is the button's description. The rare states keep
    // their word after the station, so VoiceOver says them even with spoken
    // hints off.
    const isReconnecting = isActive && !isPaused && streamFault;
    var label = s.label;
    if (isFailed) label += ', not available';
    else if (isPaused) label += ', paused';
    else if (isReconnecting) label += ', reconnecting';
    btn.setAttribute('aria-label', label);
    // Pressed only while it plays: a paused station isn't on.
    btn.setAttribute('aria-pressed', isActive && !isPaused ? 'true' : 'false');

    // When there's trouble, the description line says so in words: the
    // greyed-out button and ⚠ were the only cues before.
    const status = statuses[i];
    if (status) {
      setSizes(btn, statusScales[i]);
      btn.style.setProperty('--btn-status-size', px(statusAt(statusScales[i], i)));
    }

    // Build inner HTML — all user content is escaped to prevent XSS
    let html = '<div class="tap-flash" aria-hidden="true"></div>';

    if (compact) {
      // Compact mode: show emoji or first-letter fallback, hide text
      var icon = s.emoji || s.label.charAt(0).toUpperCase();
      html += '<div class="btn-emoji" aria-hidden="true">' + escHtml(icon) + '</div>';
      if (status) html += '<div class="btn-sublabel btn-status">' + escHtml(status) + '</div>';
      html += '<div class="btn-state" aria-hidden="true">' + (isFailed ? '&#x26A0;' : isPaused ? '&#9654;' : '&#9646;&#9646;') + '</div>';
    } else {
      // Full mode: emoji + label + sublabel
      if (s.emoji) html += '<div class="btn-emoji" aria-hidden="true">' + escHtml(s.emoji) + '</div>';
      html += '<div class="btn-label">' + escHtml(s.label) + '</div>';
      if (status) html += '<div class="btn-sublabel btn-status">' + escHtml(status) + '</div>';
      else if (s.sub) html += '<div class="btn-sublabel" id="btn-desc-' + escAttr(s.id) + '">' + escHtml(s.sub) + '</div>';
      html += '<div class="btn-state" aria-hidden="true">' + (isFailed ? '&#x26A0;' : isPaused ? '&#9654;' : '&#9646;&#9646;') + '</div>';
    }

    btn.innerHTML = html;
    // Point at the description only where one was drawn (compact layouts and
    // a status line have none), so the reference can't dangle.
    const desc = btn.querySelector('.btn-sublabel[id]');
    if (desc) btn.setAttribute('aria-describedby', desc.id);
    buttonsEl.appendChild(btn);
  });

  flashingIds.forEach((id) => {
    const flash = document.getElementById(id) && document.getElementById(id).querySelector('.tap-flash');
    if (flash) flash.classList.add('flash');
  });
  if (focusedId && document.getElementById(focusedId)) document.getElementById(focusedId).focus();
}


/* ================================================================
   HTML / ATTRIBUTE ESCAPING
   Used whenever user-provided content (stream labels, descriptions,
   emoji) is inserted into the DOM via innerHTML or attribute values.
   ================================================================ */

/** Escape text for safe insertion into innerHTML. Uses DOM-based escaping. */
function escHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

/** Escape text for safe insertion into HTML attribute values. Coerces like
    escHtml does, so a stray non-string value can't throw mid-render. */
function escAttr(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}


