/* ================================================================
   ACCESSIBILITY PRESETS — UI
   ================================================================ */

/** Return the name of the built-in preset whose bundle exactly matches the
    current cfg values, or 'custom' if none do. Pure read of cfg. */
function matchingPresetName() {
  var hit = PRESETS.find(function(p) {
    return PRESET_FIELDS.every(function(f) { return cfg[f] === p.apply[f]; });
  });
  return hit ? hit.name : 'custom';
}

/** Render the preset chips from the PRESETS const (data-driven). Built once
    per settings open; selection state is synced separately. */
function renderPresetChips() {
  var box = document.getElementById('preset-chips');
  if (!box) return;
  box.innerHTML = '';
  PRESETS.forEach(function(p) {
    var btn = document.createElement('button');
    btn.className = 'chip';
    btn.dataset.group = 'preset';
    btn.dataset.val = p.name;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    // Preset names come from the trusted in-app PRESETS const, but use
    // textContent anyway so this never becomes an innerHTML injection path.
    btn.textContent = p.label;
    btn.onclick = function() { applyPreset(p.name); };
    box.appendChild(btn);
  });
  // "Custom": always in its place, but off (dimmed) until a setting no longer
  // matches a preset, then chosen, so the hint's "your changes show as
  // Custom" is visibly true. Not a choice in itself: tapping it changes nothing.
  var custom = document.createElement('button');
  custom.className = 'chip';
  custom.dataset.group = 'preset';
  custom.dataset.val = 'custom';
  custom.setAttribute('role', 'radio');
  custom.setAttribute('aria-checked', 'false');
  custom.textContent = 'Custom';
  custom.disabled = true;
  box.appendChild(custom);
}

/** Apply a named preset's bundle to cfg, refresh the live UI, and mark it
    active. Only PRESET_FIELDS are touched — streams/orgName/orientation/
    volume/pin are intentionally left alone. No-op on an unknown name. */
function applyPreset(name) {
  var preset = PRESETS.find(function(p) { return p.name === name; });
  if (!preset) return;
  var changed = PRESET_FIELDS.filter(function(f) { return f in preset.apply && cfg[f] !== preset.apply[f]; });
  if (changed.includes('theme')) fadeTheme();
  PRESET_FIELDS.forEach(function(f) {
    if (f in preset.apply) cfg[f] = preset.apply[f];
  });
  cfg.preset = preset.name;

  // Re-apply everything the bundle could have changed.
  applyTheme();          // theme, size, fillview
  updateMode();          // advanced transport
  renderButtons();
  syncChips();           // also calls syncPresetSelection via its tail
  // A preset changes settings further down: point at each one it changed.
  if (canFlash()) changed.forEach(function(f) { flashChanged(settingBlock(f)); });
}

/** Sync the preset chip highlight to whichever preset (or 'custom') matches
    the live cfg. Recomputed rather than trusting cfg.preset so manual edits
    are reflected immediately. */
function syncPresetSelection() {
  cfg.preset = matchingPresetName();
  document.querySelectorAll('.chip[data-group="preset"]').forEach(function(c) {
    var sel = c.dataset.val === cfg.preset;
    c.classList.toggle('selected', sel);
    c.setAttribute('aria-checked', sel ? 'true' : 'false');
    if (c.dataset.val === 'custom') {
      if (c.disabled && sel && canFlash()) flashChanged(c);
      c.disabled = !sel;
    }
  });
}


