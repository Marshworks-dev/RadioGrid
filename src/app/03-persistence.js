/* ================================================================
   PERSISTENCE — LocalStorage
   Config key: 'rgxl_cfg' (JSON object)
   PIN key:    'rgxl_pin' (plain string, managed separately)
   ================================================================ */

/* Schema version for the persisted `rgxl_cfg` object. Stored as `v` and read
   back in loadSettings(). Currently informational — there is nothing to
   migrate yet — but it MUST exist before any future breaking change to the
   config shape, so old configs can be detected and transformed instead of
   silently resetting to defaults. Bump this when the shape changes and add a
   migration branch in loadSettings(). */
const CFG_VERSION = 1;

/* Set by loadSettings() when storage holds a config from a newer version
   (say a rollback of the hosted app). This version loads what it understands
   but won't save over it, since that would drop the fields only the newer
   version knows. Reset to Defaults and importing a backup are explicit
   choices to replace it, so they clear this. */
let storedConfigIsNewer = false;

/* Length caps for text from storage or a backup. The organisation name matches
   its field's maxlength; the stream caps sit well above anything typed in the
   editor, so they only ever trim a hand-made or tampered file. */
const ORG_NAME_MAX = 80;
const LABEL_MAX = 120;
const SUB_MAX = 200;
const EMOJI_MAX = 16;
const ID_MAX = 64; // stream ids; checked with .length, so an emoji counts as 2

/** `text` cut to at most `max` characters, never splitting an emoji. */
function clip(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** A new id for a station whose `id` an earlier station already has: the
    same id plus -2, -3 and so on, the first that isn't in `taken`, cut to fit
    ID_MAX without splitting an emoji. Made from the id, not the clock, so the
    same saved settings give the same ids on every launch, and rgxl_last
    still finds the station that was playing. */
function uniqueStreamId(id, taken) {
  for (let n = 2; ; n++) {
    const suffix = '-' + n;
    const chars = Array.from(id);
    while (chars.join('').length + suffix.length > ID_MAX) chars.pop();
    const candidate = chars.join('') + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Pure validator: given an arbitrary object `s` (parsed from storage OR an
 * imported backup file — both UNTRUSTED), return a sanitized object containing
 * only the fields that pass the allowlist. Fields that fail validation are
 * simply omitted, so the caller can apply them over the existing defaults with
 * a graceful fall-back. Never throws on bad input; never mass-assigns.
 *
 * Extracted so loadSettings() and the import path share one allowlist and
 * can't drift apart.
 */
function validateConfig(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;

  // Schema version. Configs written before the version field existed have no
  // `v` (treated as 0). No transform is needed yet — every field below is
  // independently validated/allowlisted — but future breaking changes branch
  // here on `ver` before reading the rest. A `v` newer than CFG_VERSION is
  // handled by the callers: import refuses it, loadSettings won't save over it.
  // const ver = typeof s.v === 'number' ? s.v : 0;

  if (typeof s.orgName === 'string' && s.orgName.trim()) out.orgName = clip(s.orgName, ORG_NAME_MAX);
  if (['dark', 'light', 'auto', 'mono-dark', 'mono-light', 'mono-auto', 'contrast-dark', 'contrast-light', 'contrast-auto', 'night'].includes(s.theme)) out.theme = s.theme;
  if (['normal', 'large', 'xlarge', 'ultra'].includes(s.size)) out.size = s.size;
  if (['on', 'off'].includes(s.fillview))               out.fillview = s.fillview;
  if (['on', 'off'].includes(s.advanced))               out.advanced = s.advanced;
  if (['on', 'off'].includes(s.haptics))                out.haptics = s.haptics;
  if (['on', 'off'].includes(s.tts))                    out.tts = s.tts;
  if (['on', 'off'].includes(s.chime))                  out.chime = s.chime;
  if (['on', 'off'].includes(s.resume))                 out.resume = s.resume;
  if (['on', 'off'].includes(s.zoom))                   out.zoom = s.zoom;
  if (['on', 'off'].includes(s.settingsButton))         out.settingsButton = s.settingsButton;
  // Accessibility preset name. Allowlist = built-in preset names + 'custom'.
  // Unknown/legacy values are simply omitted (fall back to the 'Standard'
  // default) — purely a UI highlight hint, never drives behavior on its own.
  if (s.preset === 'custom' || PRESETS.some(p => p.name === s.preset)) out.preset = s.preset;
  if (['auto', 'landscape-cw', 'landscape-ccw'].includes(s.orientation)) out.orientation = s.orientation;

  if (typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 100) {
    out.volume = Math.round(s.volume);
  }

  if (Array.isArray(s.streams) && s.streams.length > 0 && s.streams.length <= 8) {
    // Only accept stream entries that have the required fields
    const streams = s.streams
      .filter(st => st && typeof st.id === 'string' && st.id && st.id.length <= ID_MAX && typeof st.label === 'string')
      .slice(0, 8)
      .map(st => {
        // Rebuilt from an explicit field list, each one type-checked: a backup
        // or tampered storage can carry any key with any type, and the stream
        // editor assumes strings (a number as the description used to break
        // settings until a Reset). Unknown keys and wrong types are dropped.
        const out = { id: st.id, label: clip(st.label, LABEL_MAX) };
        if (typeof st.sub === 'string') out.sub = clip(st.sub, SUB_MAX);
        // Defense-in-depth: re-validate URLs the same way we sanitize on save,
        // in case a legacy or tampered/imported config carries a non-http(s)
        // scheme (e.g. javascript:). Blank anything that fails.
        out.url = typeof st.url === 'string' && isValidStreamUrl(st.url) ? st.url : '';
        // An emoji is a few code units; anything longer isn't one.
        if (typeof st.emoji === 'string' && st.emoji.length <= EMOJI_MAX) out.emoji = st.emoji;
        if (PALETTE.some(p => p.id === st.color)) out.color = st.color;
        // Optional per-stream gain trim (loudness leveling alternative). A
        // finite multiplier in a sane range; anything else (string, NaN,
        // Infinity, out-of-range) drops the field so it defaults to 1.0.
        const g = sanitizeGain(st.gain);
        if (g !== null) out.gain = g;
        return out;
      });
    // The app finds a station by its id (its button, playStream, rgxl_last,
    // the retry state), so in a hand-made or tampered file with two stations
    // sharing one, the second could never play. Keep both: the first keeps
    // its id and each later one gets a new one. `taken` starts with every id
    // in the file, so a new id never takes one a later station already has.
    const taken = new Set(streams.map(st => st.id));
    const seen = new Set();
    streams.forEach(st => {
      if (seen.has(st.id)) {
        st.id = uniqueStreamId(st.id, taken);
        taken.add(st.id);
      }
      seen.add(st.id);
    });
    if (streams.length > 0) out.streams = streams;
  }

  return out;
}

/**
 * Load settings from LocalStorage into `cfg`.
 * Each value is validated against an allowlist before being accepted.
 * Corrupt or missing storage gracefully falls back to defaults.
 */
function loadSettings() {
  try {
    const stored = localStorage.getItem('rgxl_cfg');
    // Nothing saved yet: start at a text size matching the phone's. Never
    // over a saved size, which is someone's choice.
    if (stored === null) {
      const start = osStartingTextSize();
      if (start) cfg.size = start;
    } else {
      // A radio that has been saved never grows a Settings button: one saved
      // before the button existed, or with a corrupt config, keeps settings
      // behind the logo. Only a saved 'on' below shows it.
      cfg.settingsButton = 'off';
    }
    const s = JSON.parse(stored || '{}');
    storedConfigIsNewer = !!s && typeof s.v === 'number' && s.v > CFG_VERSION;
    Object.assign(cfg, validateConfig(s));
    // The preset name is derived, not trusted: a stored one can be stale.
    cfg.preset = matchingPresetName();
  } catch (e) {
    /* Corrupt storage — use defaults */
  }
}

/** Save current config to LocalStorage. Returns false when storage refuses
    (full, or blocked in a private or locked-down browser), so callers can
    say so instead of acting as if it saved. Also false, without writing,
    while storage holds a newer version's config (storedConfigIsNewer). */
function saveSettings() {
  if (storedConfigIsNewer) {
    console.warn('[settings] stored settings are from a newer version; not overwriting them');
    return false;
  }
  try {
    localStorage.setItem('rgxl_cfg', JSON.stringify({
      v: CFG_VERSION,
      orgName: cfg.orgName,
      theme: cfg.theme,
      size: cfg.size,
      fillview: cfg.fillview,
      volume: cfg.volume,
      advanced: cfg.advanced,
      haptics: cfg.haptics,
      tts: cfg.tts,
      chime: cfg.chime,
      resume: cfg.resume,
      zoom: cfg.zoom,
      settingsButton: cfg.settingsButton,
      preset: cfg.preset,
      orientation: cfg.orientation,
      streams: cfg.streams
    }));
    return true;
  } catch (e) {
    console.error('[settings] could not save rgxl_cfg:', e && e.name, e && e.message);
    return false;
  }
}


