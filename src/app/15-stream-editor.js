/* ================================================================
   STREAM EDITOR
   Allows technicians to add, edit, reorder, and remove streams.
   Each stream has: icon (emoji), label, description, URL, color.
   Maximum of 8 streams. At least 1 must remain.
   ================================================================ */

/* The one station whose fields are showing (by id), or null. One at a time
   keeps the list short; toggleStream keeps the tapped row where it was. */
let openStreamId = null;

function prefersReducedMotion() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Render the station list: a row per station, its fields folded under it. */
function renderStreamEditor() {
  const editor = document.getElementById('stream-editor');
  // A change to the list after a remove ends its Undo (removeStreamEntry
  // offers it after this render).
  if (undoRemoved) dropUndo(false);
  const themeKey = resolveTheme().endsWith('light') ? 'light' : 'dark';
  editor.innerHTML = '';
  if (!cfg.streams.some(function(s) { return s.id === openStreamId; })) openStreamId = null;

  cfg.streams.forEach((s, i) => {
    const isOpen = s.id === openStreamId;
    const div = document.createElement('div');
    div.className = 'stream-entry' + (isOpen ? ' open' : '');
    div.dataset.idx = String(i);
    div.dataset.id = s.id; // a dataset write, never markup

    // Build color palette picker chips
    let colorChipsHtml = '<div class="color-chips" role="radiogroup" aria-label="Button color">';
    PALETTE.forEach(p => {
      const sel = (s.color === p.id) ? ' selected' : '';
      const checked = (s.color === p.id) ? 'true' : 'false';
      colorChipsHtml +=
        '<button class="color-chip' + sel + '"' +
        ' style="background:' + p[themeKey].bg + ';"' +
        ' data-color="' + p.id + '"' +
        ' data-idx="' + i + '"' +
        ' role="radio"' +
        ' aria-checked="' + checked + '"' +
        ' aria-label="' + p.id + '"' +
        ' onclick="selectStreamColor(this,' + i + ',\'' + p.id + '\')"></button>';
    });
    colorChipsHtml += '</div>';

    // All user values are escaped (escHtml for text, escAttr for attributes).
    var num = i + 1;
    var pal = PALETTE.find(function(p) { return p.id === s.color; }) || PALETTE[0];
    var showPrimaryBadge = i === 0 && cfg.streams.length > 3 && cfg.streams.length % 2 === 1;
    var who = '<span class="sr-only">: ' + escHtml(s.label || 'station ' + num) + '</span>';
    div.innerHTML =
      '<button type="button" class="stream-row" aria-expanded="' + isOpen + '" aria-controls="stream-body-' + i + '" onclick="toggleStream(' + i + ')">' +
        '<span class="stream-row-icon" style="background:' + pal[themeKey].bg + ';" aria-hidden="true">' + (s.emoji ? escHtml(s.emoji) : '&#9835;') + '</span>' +
        '<span class="stream-row-text">' +
          '<span class="stream-row-name"><span class="sr-only">Station ' + num + ': </span>' + escHtml(s.label || 'New station') + '</span>' +
          '<span class="stream-row-sub">' + escHtml(s.sub || s.url || 'No address yet') + '</span>' +
          // A line of its own: inside the description it was cut off with it,
          // and beside the name it squeezed the name to a few letters.
          (showPrimaryBadge ? '<span class="stream-primary-badge">Full width</span>' : '') +
        '</span>' +
        '<svg class="s-icon stream-row-chevron" viewBox="0 0 18 18" aria-hidden="true"><path d="M6 3l6 6-6 6"></path></svg>' +
      '</button>' +
      '<div class="stream-body" id="stream-body-' + i + '"' + (isOpen ? '' : ' inert') + '><div class="stream-body-inner"><div class="stream-fields">' +
      '<div class="inline-row">' +
        '<div class="narrow"><div class="s-row"><label class="s-label">Icon</label>' +
          '<button type="button" class="s-input emoji-input" data-field="emoji" data-idx="' + i + '" aria-label="Stream ' + num + ' icon" onclick="openEmojiPicker(' + i + ')">' + (s.emoji ? escHtml(s.emoji) : '<span style="opacity:0.4">—</span>') + '</button>' +
          '<input type="hidden" data-field="emoji" data-idx="' + i + '" value="' + escAttr(s.emoji || '') + '"></div></div>' +
        '<div><div class="s-row"><label class="s-label">Name</label>' +
          '<input class="s-input" data-field="label" data-idx="' + i + '" value="' + escAttr(s.label) + '" aria-label="Stream ' + num + ' label" aria-describedby="name-warn-' + i + '" oninput="previewStreamEdit()"></div></div>' +
      '</div>' +
      '<div class="name-warn" id="name-warn-' + i + '" hidden></div>' +
      '<div class="s-row"><label class="s-label">Description</label>' +
        '<input class="s-input" data-field="sub" data-idx="' + i + '" value="' + escAttr(s.sub || '') + '" aria-label="Stream ' + num + ' description" oninput="previewStreamEdit()"></div>' +
      '<div class="s-row"><label class="s-label">Stream address</label>' +
        '<input class="s-input" data-field="url" data-idx="' + i + '" value="' + escAttr(s.url) + '" aria-label="Stream ' + num + ' URL" aria-describedby="url-err-' + i + '" oninput="updateUrlWarning(' + i + '); previewStreamEdit()"></div>' +
      '<div class="url-error" id="url-err-' + i + '" data-err-idx="' + i + '" hidden></div>' +
      '<div class="url-warn" data-warn-idx="' + i + '" role="alert" style="display:' + (isMixedContentUrl(s.url) ? 'block' : 'none') + ';">' +
        'This address starts with http://, so it won\'t play here, not even from the home screen: browsers block it on secure sites. Look for an https:// address for this station.' +
      '</div>' +
      '<div class="s-row ios-hide"><label class="s-label">Volume Trim</label>' +
        '<input class="s-input" type="number" inputmode="decimal" min="0.1" max="4" step="0.1" data-field="gain" data-idx="' + i + '" value="' + escAttr(s.gain != null ? String(s.gain) : '') + '" placeholder="1.0 (normal)" aria-label="Stream ' + num + ' volume trim, 0.1 to 4, 1 is normal"></div>' +
      '<div class="s-row"><label class="s-label">Button Color</label>' + colorChipsHtml + '</div>' +
      // Labelled buttons, always in the same place: disabled, never removed,
      // so nothing shifts under a finger. The station's name is for screen readers.
      '<div class="stream-entry-actions">' +
        '<button type="button" class="stream-action-btn" data-action="up" onclick="moveStream(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>Move up' + who + '</button>' +
        '<button type="button" class="stream-action-btn" data-action="down" onclick="moveStream(' + i + ',1)"' + (i === cfg.streams.length - 1 ? ' disabled' : '') + '>Move down' + who + '</button>' +
        '<button type="button" class="stream-action-btn danger" data-action="remove" onclick="removeStreamEntry(' + i + ')"' + (cfg.streams.length <= 1 ? ' disabled' : '') + '>Remove' + who + '</button>' +
      '</div>' +
      '</div></div></div>';

    editor.appendChild(div);
  });

  // At the 8-station maximum the add buttons stay where they were, turned
  // off, with the reason beside them: hiding them left people hunting.
  document.getElementById('stream-count').textContent = cfg.streams.length + ' of ' + MAX_STREAMS;
  var full = cfg.streams.length >= MAX_STREAMS;
  document.querySelectorAll('#stream-add-row button').forEach(function(b) { b.disabled = full; });
  var cap = document.getElementById('stream-cap');
  cap.hidden = !full;
  cap.textContent = full ? STREAM_CAP_MESSAGE : '';
  updateNameWarnings();

  // Show hint when 5+ streams — layout adapts but user should be aware
  var hint = document.getElementById('stream-hint');
  if (cfg.streams.length >= 5) {
    hint.style.display = 'block';
    hint.textContent = 'With 5 or more streams, text shrinks to fit, and on a small screen buttons show only their icon. Set an icon for each stream.';
  } else {
    hint.style.display = 'none';
  }
}

const MAX_STREAMS = 8;
const STREAM_CAP_MESSAGE = '8 of 8 stations. Remove one to add another.';

/** Keep each row's name, line and icon in step with its fields as they're typed. */
function syncStreamRows() {
  document.querySelectorAll('#stream-editor .stream-entry').forEach(function(entry) {
    var i = parseInt(entry.dataset.idx, 10);
    var s = cfg.streams[i];
    if (!s) return;
    var name = entry.querySelector('.stream-row-name');
    name.lastChild.textContent = s.label || 'New station';
    var sub = entry.querySelector('.stream-row-sub');
    sub.textContent = s.sub || s.url || 'No address yet';
    entry.querySelector('.stream-row-icon').textContent = s.emoji || '♫';
  });
}

/** Open or close one station's fields. animate=false snaps (used for a
    station above the tapped one, whose closing would drag the row up). */
function setStreamOpen(entry, open, animate) {
  if (!animate) entry.classList.add('instant');
  entry.classList.toggle('open', open);
  entry.querySelector('.stream-row').setAttribute('aria-expanded', open ? 'true' : 'false');
  var body = entry.querySelector('.stream-body');
  if (open) body.removeAttribute('inert'); else body.setAttribute('inert', '');
  if (!animate) { void entry.offsetHeight; entry.classList.remove('instant'); }
}

/** Tap a station's row: open its fields under it, or close them. Only one is
    open at a time, and the tapped row stays where it was on screen. */
function toggleStream(idx) {
  readStreamEditor();
  var s = cfg.streams[idx];
  var entry = document.querySelector('#stream-editor .stream-entry[data-idx="' + idx + '"]');
  if (!s || !entry) return;
  var scroller = document.getElementById('settings-body');
  var row = entry.querySelector('.stream-row');
  var before = row.getBoundingClientRect().top;
  var opening = openStreamId !== s.id;
  document.querySelectorAll('#stream-editor .stream-entry.open').forEach(function(other) {
    if (other === entry) return;
    var above = !!(other.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING);
    setStreamOpen(other, false, !above);
  });
  openStreamId = opening ? s.id : null;
  setStreamOpen(entry, opening, true);
  scroller.scrollTop += row.getBoundingClientRect().top - before;
  // No scrolling to show the fields: that moved the row out from under the
  // finger (to the top, when the fields are taller than the screen).
}

/** Open a station's fields (if closed) without moving it, e.g. to show an error. */
function openStream(idx) {
  var s = cfg.streams[idx];
  if (s && openStreamId !== s.id) toggleStream(idx);
}

/* Where each station row sits before a change, to slide it from there after. */
function stationPositions() {
  var at = {};
  document.querySelectorAll('#stream-editor .stream-entry').forEach(function(e) {
    at[e.dataset.id] = e.getBoundingClientRect().top;
  });
  return at;
}

/** Slide each station from where it was to where it is now (FLIP), so a move
    or a removal shows where things went instead of snapping. */
function slideStations(before) {
  if (prefersReducedMotion()) return;
  document.querySelectorAll('#stream-editor .stream-entry').forEach(function(e) {
    if (!(e.dataset.id in before)) return;
    var d = before[e.dataset.id] - e.getBoundingClientRect().top;
    if (!d) return;
    e.style.transition = 'none';
    e.style.transform = 'translateY(' + d + 'px)';
    void e.offsetHeight;
    e.style.transition = 'transform 0.22s ease-out';
    e.style.transform = '';
  });
}

/** Mark a setting a tap just changed: a brief accent ring (a steady one,
    for a second, with reduced motion), so the eye finds what changed. */
function flashChanged(el) {
  if (!el) return;
  el.classList.remove('s-changed');
  void el.offsetWidth;
  el.classList.add('s-changed');
  clearTimeout(el._changedTimer);
  el._changedTimer = setTimeout(function() { el.classList.remove('s-changed'); }, 1200);
}

function stationEntry(idx) {
  return document.querySelector('#stream-editor .stream-entry[data-idx="' + idx + '"]');
}

/** Focus the first control in the stream editor matching one of the selectors.
 *  renderStreamEditor() rebuilds the editor with innerHTML, which drops focus,
 *  so each editor action puts it back on the equivalent control. */
function refocusStreamEditor(selectors) {
  var editor = document.getElementById('stream-editor');
  for (var i = 0; i < selectors.length; i++) {
    var el = editor.querySelector(selectors[i]);
    if (el) { el.focus(); return; }
  }
}

/** Update a stream's color and re-render the editor + live preview. */
function selectStreamColor(el, idx, colorId) {
  readStreamEditor();
  cfg.streams[idx].color = colorId;
  renderStreamEditor();
  renderButtons();
  refocusStreamEditor(['.color-chip[data-idx="' + idx + '"][data-color="' + colorId + '"]']);
}

/** Swap a stream with its neighbor (dir: -1 = up, 1 = down). */
function moveStream(idx, dir) {
  readStreamEditor();
  const target = idx + dir;
  if (target < 0 || target >= cfg.streams.length) return;

  const scroller = document.getElementById('settings-body');
  const wasAt = stationEntry(idx).offsetTop - scroller.scrollTop;
  const temp = cfg.streams[idx];
  cfg.streams[idx] = cfg.streams[target];
  cfg.streams[target] = temp;
  const before = stationPositions();
  renderStreamEditor();
  renderButtons();
  // Keep the moved station where it was on screen (its Move button stays
  // under the finger for the next tap) and let its neighbour slide past.
  const moved = stationEntry(target);
  scroller.scrollTop += (moved.offsetTop - scroller.scrollTop) - wasAt;
  slideStations(before);
  flashChanged(moved);
  // Follow the moved stream: same direction again if it can, else the other way.
  const at = '.stream-entry[data-idx="' + target + '"] ';
  var btn = document.querySelector('#stream-editor ' + at + '[data-action="' + (dir < 0 ? 'up' : 'down') + '"]:not([disabled])') ||
            document.querySelector('#stream-editor ' + at + '[data-action="' + (dir < 0 ? 'down' : 'up') + '"]:not([disabled])');
  // preventScroll: the scroll above already put it in place.
  if (btn) btn.focus({ preventScroll: true });
}

/** Add a station by its address: a new row, open, with the address field focused. */
function addStreamEntry() {
  if (cfg.streams.length >= 8) return;
  readStreamEditor();

  const colorIdx = cfg.streams.length % PALETTE.length;
  const id = 's' + Date.now();
  cfg.streams.push({
    id: id,
    label: 'New Stream',
    sub: '',
    url: '',
    emoji: '',
    color: PALETTE[colorIdx].id
  });
  openStreamId = id;
  renderStreamEditor();
  renderButtons();
  const idx = cfg.streams.length - 1;
  flashChanged(stationEntry(idx));
  refocusStreamEditor(['.s-input[data-field="url"][data-idx="' + idx + '"]']);
}

/** Remove a stream entry. Stops playback if that stream is playing. */
function removeStreamEntry(idx) {
  if (cfg.streams.length <= 1) return;
  readStreamEditor();

  const before = stationPositions();
  const removed = cfg.streams[idx];
  if (playing === removed.id) stopPlayback();
  cfg.streams.splice(idx, 1);
  renderStreamEditor();
  renderButtons();
  slideStations(before);
  offerUndoRemove(removed, idx);
}

/* The last removed station, for Undo: until the next change to the list,
   or 8 s. Remove sat right beside the move buttons with no way back. */
const UNDO_MS = 8000;
let undoRemoved = null; // { stream, idx }
let undoTimer = null;

function offerUndoRemove(stream, idx) {
  undoRemoved = { stream: stream, idx: idx };
  document.getElementById('stream-undo-text').textContent = 'Removed ' + (stream.label || 'a stream') + '.';
  var bar = document.getElementById('stream-undo');
  bar.hidden = false;
  flashChanged(bar);
  document.getElementById('stream-undo-btn').focus();
  clearTimeout(undoTimer);
  undoTimer = setTimeout(function() { dropUndo(true); }, UNDO_MS);
}

/** Forget the removed station. refocus: Undo had focus and is going away. */
function dropUndo(refocus) {
  clearTimeout(undoTimer);
  undoTimer = null;
  undoRemoved = null;
  var bar = document.getElementById('stream-undo');
  var hadFocus = bar.contains(document.activeElement);
  bar.hidden = true;
  if (refocus && hadFocus) refocusStreamEditor(['.stream-row']);
}

/** Put the last removed station back where it was. It's the station
    object settings already held, so nothing new is trusted here. */
function undoRemoveStream() {
  if (!undoRemoved || cfg.streams.length >= MAX_STREAMS) { dropUndo(true); return; }
  readStreamEditor();
  var r = undoRemoved;
  dropUndo(false);
  const before = stationPositions();
  cfg.streams.splice(Math.min(r.idx, cfg.streams.length), 0, r.stream);
  renderStreamEditor();
  renderButtons();
  slideStations(before);
  var at = Math.min(r.idx, cfg.streams.length - 1);
  flashChanged(stationEntry(at));
  refocusStreamEditor(['.stream-entry[data-idx="' + at + '"] .stream-row']);
}

/** Live-preview stream label/description/emoji changes as the user types. */
function previewStreamEdit() {
  readStreamEditor();
  syncStreamRows();
  updateNameWarnings();
  renderButtons();
}

/* Someone using Voice Control picks a station by saying its name, so two
   stations called the same thing, or one called like a button on the radio
   ("Stop"), can press the wrong one. A warning, never a block: the setter-up
   may have a reason. */
const CONTROL_NAMES = ['stop', 'pause', 'resume', 'sleep', 'back 15', 'skip 30', 'close'];

function spokenName(label) {
  return ((label || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');
}

/** The warning for station i's name, or '' when it's fine to say. */
function stationNameClash(i) {
  var said = spokenName(cfg.streams[i] && cfg.streams[i].label);
  if (!said) return '';
  if (CONTROL_NAMES.indexOf(said) !== -1) {
    return 'The radio also has a ' + cfg.streams[i].label.trim() + ' button, so saying this name with Voice Control could press the wrong one. Try a different name.';
  }
  var twin = cfg.streams.some(function(o, j) { return j !== i && spokenName(o.label) === said; });
  if (twin) return 'Another station has this name too, so Voice Control can\'t tell them apart. Give one of them a different name.';
  return '';
}

/** Show or clear each station's name warning. textContent only: names come
    from imports and the directory, so they're never parsed as HTML. */
function updateNameWarnings() {
  cfg.streams.forEach(function(s, i) {
    var warn = document.getElementById('name-warn-' + i);
    if (!warn) return;
    var msg = stationNameClash(i);
    warn.textContent = msg;
    warn.hidden = !msg;
  });
}

/** Read all input values from the stream editor form back into cfg.streams. */
function readStreamEditor() {
  document.querySelectorAll('#stream-editor .s-input, #stream-editor input[type="hidden"]').forEach(input => {
    const idx = parseInt(input.dataset.idx, 10);
    const field = input.dataset.field;
    if (cfg.streams[idx] && field) {
      if (input.tagName === 'BUTTON') return; // skip emoji button (value is in hidden input)
      if (field === 'gain') {
        // Per-stream gain trim is a number, not free text — normalize through
        // the same validator storage/import use. Out-of-range or non-numeric
        // input drops the field (defaults to 1.0), never stores a bad value.
        const g = sanitizeGain(input.value);
        if (g === null) delete cfg.streams[idx].gain; else cfg.streams[idx].gain = g;
        return;
      }
      cfg.streams[idx][field] = input.value;
    }
  });
}


