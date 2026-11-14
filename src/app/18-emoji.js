/* ================================================================
   EMOJI PICKER
   Cross-platform popup for selecting stream icons. Uses a curated
   set of emoji organized by category. Works on Android, iOS, and
   desktop without any external dependencies.
   ================================================================ */

var emojiPickerIdx = -1;

var EMOJI_CATEGORIES = [
  { name: 'Music', emojis: ['🎵', '🎶', '🎸', '🎹', '🎺', '🎻', '🎷', '🥁', '🎤', '🎧', '🎼', '🪗', '🪘', '🪕', '🪈'] },
  { name: 'Radio', emojis: ['📻', '📡', '🔊', '📢', '📣', '🎙️', '🎚️', '🎛️', '📺', '💿', '📀', '💽', '🔌', '🔋'] },
  { name: 'Nature', emojis: ['🌅', '🌄', '🌊', '🌿', '🌸', '🌺', '🌻', '🌲', '🌴', '🍀', '🌈', '⛅', '🌙', '⭐', '✨', '🌎', '🔥', '💧', '❄️', '🌾'] },
  { name: 'Faces', emojis: ['😀', '😎', '🥰', '😇', '🤩', '😌', '🧘', '💆', '🙏', '💪', '👋', '👍', '❤️', '💛', '💙', '💜', '🤍', '🖤', '💚', '🧡'] },
  { name: 'Places', emojis: ['🏠', '⛪', '🏛️', '🏢', '🏫', '🏥', '🕌', '🕍', '⛩️', '🏰', '🗼', '🌆', '🏞️', '🗻', '🏖️'] },
  { name: 'Food', emojis: ['☕', '🍵', '🧃', '🍺', '🍷', '🎂', '🍕', '🍔', '🌽', '🍎', '🍇', '🍓', '🥐', '🍪', '🧁'] },
  { name: 'Things', emojis: ['📰', '📖', '📚', '✏️', '🔔', '💡', '🕯️', '🎁', '🎈', '🎉', '🏆', '🎯', '🧩', '♟️', '🎲'] },
  { name: 'Travel', emojis: ['✈️', '🚗', '🚂', '⛵', '🚀', '🛸', '🏍️', '🚲', '🛶', '⚓', '🗺️', '🧳', '🏕️', '🎡', '🎢'] },
  { name: 'Animals', emojis: ['🐶', '🐱', '🐦', '🦅', '🦋', '🐝', '🐠', '🐬', '🦊', '🦁', '🐻', '🐼', '🦉', '🐸', '🐢'] },
  { name: 'Symbols', emojis: ['☮️', '✝️', '☪️', '🕉️', '✡️', '🔯', '♾️', '💠', '🔷', '🔶', '🟢', '🟡', '🔴', '⚪', '♥️', '♠️', '♦️', '♣️', '⚡', '☀️'] }
];

var emojiPickerReturnFocus = null;

function openEmojiPicker(idx) {
  emojiPickerIdx = idx;
  emojiPickerReturnFocus = document.activeElement;
  renderEmojiTabs(0);
  renderEmojiGrid(0);
  var overlay = document.getElementById('emoji-picker-overlay');
  overlay.classList.add('open');
  inertBehind(overlay);
  overlay._focusTrap = function(e) { trapFocus(e, overlay); };
  overlay.addEventListener('keydown', overlay._focusTrap);
  // Move focus to first emoji tab for keyboard accessibility
  var firstTab = overlay.querySelector('.emoji-tab');
  if (firstTab) firstTab.focus();
}

function closeEmojiPicker() {
  var overlay = document.getElementById('emoji-picker-overlay');
  if (overlay._focusTrap) {
    overlay.removeEventListener('keydown', overlay._focusTrap);
    overlay._focusTrap = null;
  }
  overlay.classList.remove('open');
  releaseInert(overlay);
  emojiPickerIdx = -1;
  if (emojiPickerReturnFocus) {
    emojiPickerReturnFocus.focus();
    emojiPickerReturnFocus = null;
  }
}

// Close emoji picker on backdrop tap
document.getElementById('emoji-picker-overlay').addEventListener('click', function (e) {
  if (e.target === this) closeEmojiPicker();
});

function renderEmojiTabs(activeIdx) {
  var html = '';
  EMOJI_CATEGORIES.forEach(function (cat, i) {
    html += '<button class="emoji-tab' + (i === activeIdx ? ' active' : '') + '" role="tab" aria-selected="' + (i === activeIdx) + '" aria-controls="emoji-grid" tabindex="' + (i === activeIdx ? '0' : '-1') + '" onclick="switchEmojiTab(' + i + ')">' + escHtml(cat.name) + '</button>';
  });
  document.getElementById('emoji-tabs').innerHTML = html;

  // Arrow key navigation between tabs
  document.getElementById('emoji-tabs').onkeydown = function (e) {
    var tabs = Array.from(this.querySelectorAll('[role="tab"]'));
    var idx = tabs.indexOf(document.activeElement);
    if (idx === -1) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      var next = (idx + 1) % tabs.length;
      switchEmojiTab(next);
      document.getElementById('emoji-tabs').querySelectorAll('[role="tab"]')[next].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      var prev = (idx - 1 + tabs.length) % tabs.length;
      switchEmojiTab(prev);
      document.getElementById('emoji-tabs').querySelectorAll('[role="tab"]')[prev].focus();
    }
  };
}

function switchEmojiTab(catIdx) {
  renderEmojiTabs(catIdx);
  renderEmojiGrid(catIdx);
}

function renderEmojiGrid(catIdx) {
  var emojis = EMOJI_CATEGORIES[catIdx].emojis;
  var html = '';
  emojis.forEach(function (em) {
    html += '<button type="button" class="emoji-cell" onclick="emojiPickerSelect(this.textContent)" aria-label="' + em + '">' + em + '</button>';
  });
  document.getElementById('emoji-grid').innerHTML = html;
}

function emojiPickerSelect(emoji) {
  if (emojiPickerIdx < 0) return;
  var idx = emojiPickerIdx;

  // Update hidden input value
  var hidden = document.querySelector('#stream-editor input[type="hidden"][data-field="emoji"][data-idx="' + idx + '"]');
  if (hidden) hidden.value = emoji;

  // Update visible button text
  var btn = document.querySelector('#stream-editor button.emoji-input[data-idx="' + idx + '"]');
  if (btn) btn.innerHTML = emoji ? escHtml(emoji) : '<span style="opacity:0.4">—</span>';

  closeEmojiPicker();
  previewStreamEdit();
}


