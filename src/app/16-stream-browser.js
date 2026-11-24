/* ================================================================
   STREAM BROWSER
   Searches the Radio Browser API (radio-browser.info) to let
   technicians discover and add radio stations by name, country,
   or genre — instead of manually entering stream URLs.
   ================================================================ */

/* Starter shelves: hand-picked stations the browser opens on, so finding
   something good doesn't start from an empty search box. Every address is
   https (they play on the hosted app too), and `npm run check:shelves` plays
   each one before a release. Plain JSON, so that script can read it. */
/* === SHELVES — check-shelves.mjs reads this block === */
const SHELVES = [
  { "id": "calm", "label": "Calm & easy", "icon": "🌿", "stations": [
    { "name": "Radio Paradise Mellow Mix", "sub": "Soft rock and acoustic, no ads · California", "url": "https://stream.radioparadise.com/mellow-128" },
    { "name": "Classic FM Calm", "sub": "Relaxing classical · UK", "url": "https://media-ice.musicradio.com/ClassicFMCalmMP3" },
    { "name": "YourClassical Favorites", "sub": "Well-loved classical · Minnesota", "url": "https://favorites.stream.publicradio.org/favorites.mp3" },
    { "name": "Classic Vinyl HD", "sub": "Standards and crooners, 1930s–60s", "url": "https://icecast.walmradio.com:8443/classic" },
    { "name": "SmoothJazz.com", "sub": "Smooth jazz", "url": "https://smoothjazz.cdnstream1.com/2585_128.mp3" },
    { "name": "Airport Lounge Radio", "sub": "Lounge and easy listening · Canada", "url": "https://az1.mediacp.eu/listen/airport-lounge-radio/radio.mp3" }
  ] },
  { "id": "oldies", "label": "Oldies", "icon": "📻", "stations": [
    { "name": "Old Time Radio", "sub": "Radio dramas and comedy, 1930s–50s", "url": "https://icecast.walmradio.com:8443/otr" },
    { "name": "1940s Radio", "sub": "Music of the 1940s · UK", "url": "https://cast2.asurahosting.com/proxy/1940sradio/stream" },
    { "name": "50s on Radio", "sub": "Hits of the 1950s", "url": "https://0n-50s.radionetz.de/0n-50s.mp3" },
    { "name": "60s on Radio", "sub": "Hits of the 1960s", "url": "https://0n-60s.radionetz.de/0n-60s.mp3" },
    { "name": "Gold", "sub": "Hits of the 60s, 70s and 80s · UK", "url": "https://media-ssl.musicradio.com/GoldMP3" },
    { "name": "Soul Radio", "sub": "Classic soul · UK", "url": "https://listen.soulradio.uk/uk" }
  ] },
  { "id": "classical", "label": "Classical", "icon": "🎻", "stations": [
    { "name": "YourClassical MPR", "sub": "Classical · Minnesota", "url": "https://cms.stream.publicradio.org/cms.mp3" },
    { "name": "WQXR", "sub": "Classical · New York", "url": "https://stream.wqxr.org/wqxr-web" },
    { "name": "WFMT", "sub": "Classical · Chicago", "url": "https://wfmt.streamguys1.com/main128.aac" },
    { "name": "Classical KUSC", "sub": "Classical · Los Angeles", "url": "https://playerservices.streamtheworld.com/api/livestream-redirect/KUSCMP256.mp3" },
    { "name": "Classic FM", "sub": "Classical · UK", "url": "https://media-ice.musicradio.com/ClassicFMMP3" },
    { "name": "YourClassical Chamber Music", "sub": "Chamber music · Minnesota", "url": "https://chambermusic.stream.publicradio.org/chambermusic.mp3" },
    { "name": "Venice Classic Radio", "sub": "Classical · Italy", "url": "https://uk2.streamingpulse.com/ssl/vcr1" }
  ] },
  { "id": "jazz", "label": "Jazz", "icon": "🎷", "stations": [
    { "name": "Jazz 88 KBEM", "sub": "Jazz · Minneapolis", "url": "https://kbem-live.streamguys1.com/kbem_aac" },
    { "name": "Jazz24", "sub": "Jazz · Seattle", "url": "https://knkx-live-a.edge.audiocdn.com/6285_128k" },
    { "name": "WBGO", "sub": "Jazz · Newark", "url": "https://ais-sa8.cdnstream1.com/3629_128.mp3" },
    { "name": "KUVO Jazz", "sub": "Jazz · Denver", "url": "https://kuvo.streamguys1.com/kuvo-aac-128" },
    { "name": "WWOZ", "sub": "Jazz and blues · New Orleans", "url": "https://wwoz-sc.streamguys1.com/wwoz-hi.mp3" },
    { "name": "TSF Jazz", "sub": "Jazz · Paris", "url": "https://tsfjazz.ice.infomaniak.ch/tsfjazz-high.mp3" }
  ] },
  { "id": "country", "label": "Country & gospel", "icon": "🤠", "stations": [
    { "name": "HPR Traditional Classic Country", "sub": "Country, 1940s–70s, no ads · Missouri", "url": "https://us2.maindigitalstream.com/ssl/7713" },
    { "name": "HPR Today's Classic Country", "sub": "Country, 1970s–90s, no ads · Missouri", "url": "https://us2.maindigitalstream.com/ssl/7735" },
    { "name": "HPR Bluegrass Gospel", "sub": "Bluegrass and country gospel, no ads", "url": "https://us2.maindigitalstream.com/ssl/7739" },
    { "name": "WDVX", "sub": "Bluegrass and Americana · Tennessee", "url": "https://wdvx.streamguys1.com/live" }
  ] },
  { "id": "news", "label": "News & talk", "icon": "🗞️", "stations": [
    { "name": "MPR News", "sub": "News · Minnesota", "url": "https://nis.stream.publicradio.org/nis.mp3" },
    { "name": "WNYC", "sub": "News · New York", "url": "https://fm939.wnyc.org/wnycfm-web" },
    { "name": "WBUR", "sub": "News · Boston", "url": "https://fm909.wbur.org/wbur_www" },
    { "name": "WAMU", "sub": "News · Washington, DC", "url": "https://wamu.cdnstream1.com/wamu.mp3" },
    { "name": "KQED", "sub": "News · San Francisco", "url": "https://streams.kqed.org/kqedradio" },
    { "name": "C-SPAN Radio", "sub": "Public affairs · Washington, DC", "url": "https://playerservices.streamtheworld.com/api/livestream-redirect/CSPANRADIO.mp3" }
  ] },
  { "id": "sleep", "label": "Sleep", "icon": "🌙", "stations": [
    { "name": "YourClassical Relax", "sub": "Quiet classical · Minnesota", "url": "https://relax.stream.publicradio.org/relax.mp3" },
    { "name": "Ambient Sleeping Pill", "sub": "Slow ambient, no beats", "url": "https://radio.stereoscenic.com/asp-h" },
    { "name": "Sleep Classical", "sub": "Slow classical", "url": "https://streaming.positivity.radio/pr/sleepclassical/icecast.audio" },
    { "name": "Music for Sleep", "sub": "Soft classical", "url": "https://0nlineradio.radioho.st/classical-classical-music-for-sleep" },
    { "name": "Piano for Sleep", "sub": "Soft piano", "url": "https://air.radioart.online/fPiano_for_sleep.mp3" },
    { "name": "Guitar for Sleep", "sub": "Soft guitar", "url": "https://air.radioart.online/fGuitar_for_sleep.mp3" },
    { "name": "Nature Radio Sleep", "sub": "Nature sounds", "url": "https://az1.mediacp.eu/listen/natureradiosleep/radio.mp3" }
  ] }
];
/* === END SHELVES === */

/* Moods: what kind of station, in plain words, in place of the directory's
   raw genre tags. Each searches up to three tags (the directory matches one
   tag per search). The icon is what a station found this way gets when no
   tag of its own suggests a better one. */
const MOODS = [
  { id: 'relaxing',  label: 'Relaxing',    icon: '🌿', tags: ['easy listening', 'ambient', 'lounge'] },
  { id: 'upbeat',    label: 'Upbeat',      icon: '🎤', tags: ['pop', 'hits', 'rock'] },
  { id: 'oldies',    label: 'Oldies',      icon: '📻', tags: ['oldies', '60s', '50s'] },
  { id: 'classical', label: 'Classical',   icon: '🎻', tags: ['classical'] },
  { id: 'jazz',      label: 'Jazz',        icon: '🎷', tags: ['jazz', 'smooth jazz', 'blues'] },
  { id: 'country',   label: 'Country',     icon: '🤠', tags: ['country', 'bluegrass', 'folk'] },
  { id: 'news',      label: 'News & talk', icon: '🗞️', tags: ['news', 'talk', 'public radio'] },
  { id: 'sports',    label: 'Sports',      icon: '🏟️', tags: ['sports'] },
  { id: 'faith',     label: 'Faith',       icon: '🕊️', tags: ['christian', 'gospel', 'religious'] },
];
var sbMood = ''; // the chosen mood's id, or '' for none

/* Smart add: a station from the browser arrives ready to use. Its genre (an
   icon and a plain label) is read from its tags in the directory's order;
   the first tag a rule matches wins. Tags are free text, and the first is
   often a city or a year ("1930", "minneapolis"), so a tag only counts when
   it names a genre. Words match whole ("rap" never matches "grand rapids");
   a trailing * matches the start of a word ("symphon*" → "symphonic"). */
const DEFAULT_STATION_ICON = '🎵';
const GENRES = [
  [['classical', 'opera', 'baroque', 'symphon*', 'chamber'], '🎻', 'Classical'],
  [['jazz', 'swing', 'big band'], '🎷', 'Jazz'],
  [['blues'], '🎷', 'Blues'],
  [['news', 'information'], '🗞️', 'News'],
  [['talk'], '🗞️', 'Talk'],
  [['public radio', 'npr'], '🗞️', 'Public radio'],
  [['oldies', '40s', '50s', '60s', '70s', 'retro', 'golden', 'nostalgi*'], '📻', 'Oldies'],
  [['country', 'americana'], '🤠', 'Country'],
  [['bluegrass'], '🤠', 'Bluegrass'],
  [['sleep', 'meditation'], '🌙', 'Sleep'],
  [['easy listening'], '🌿', 'Easy listening'],
  [['lounge'], '🌿', 'Lounge'],
  [['ambient'], '🌿', 'Ambient'],
  [['relax*', 'chill*', 'calm'], '🌿', 'Relaxing'],
  [['sport*'], '🏟️', 'Sports'],
  [['christian', 'gospel', 'religio*', 'worship', 'spiritual'], '🕊️', 'Faith'],
  [['rock', 'metal'], '🎸', 'Rock'],
  [['folk', 'acoustic'], '🪕', 'Folk'],
  [['hip hop', 'hiphop', 'rap'], '🎧', 'Hip hop'],
  [['electronic', 'house', 'techno', 'dance', 'edm'], '🎧', 'Electronic'],
  [['r&b', 'rnb'], '🎤', 'R&B'],
  [['soul'], '🎤', 'Soul'],
  [['pop', 'hits', 'top 40'], '🎤', 'Pop'],
  [['reggae'], '🎵', 'Reggae'],
  [['latin*', 'salsa'], '🎵', 'Latin'],
  [['world'], '🎵', 'World'],
];

/** Whether a lower-case tag names `word` (see GENRES for the rules). */
function tagNames(tag, word) {
  if (word.includes(' ')) return (' ' + tag.replace(/[^a-z0-9&]+/g, ' ') + ' ').includes(' ' + word + ' ');
  const words = tag.split(/[^a-z0-9&]+/);
  return word.endsWith('*')
    ? words.some(w => w.startsWith(word.slice(0, -1)))
    : words.includes(word);
}

/** The genre a directory station's tags name, as { icon, label }, or null. */
function genreOf(tags) {
  if (typeof tags !== 'string') return null;
  for (const raw of tags.toLowerCase().split(',')) {
    const tag = raw.trim();
    if (!tag) continue;
    for (const [words, icon, label] of GENRES) {
      if (words.some(w => tagNames(tag, w))) return { icon, label };
    }
  }
  return null;
}

/** The icon a directory station's tags suggest ("jazz,blues" → 🎷), or ''. */
function guessIcon(tags) {
  const genre = genreOf(tags);
  return genre ? genre.icon : '';
}

/** A directory name without its clutter: "KNOW 91.1 MPR News - Minneapolis,
    MN" → "KNOW 91.1 MPR News". Cut at the first " - ", " | ", " (", " – " or
    " — " that leaves at least three letters; otherwise the whole name. Plain
    indexOf, no regex, so a long hostile name can't make it slow. */
function cleanStationName(name) {
  const full = typeof name === 'string' ? name.trim() : '';
  let cut = full.length;
  for (const sep of [' - ', ' | ', ' (', ' – ', ' — ']) {
    const at = full.indexOf(sep);
    if (at > 0 && at < cut) {
      const letters = (full.slice(0, at).match(/[\p{L}]/gu) || []).length;
      if (letters >= 3) cut = at;
    }
  }
  return clip(full.slice(0, cut).trim(), 40);
}

/** The first station colour no station in `streams` uses; once all eight are
    taken, they repeat in order. */
function freeColour(streams) {
  const used = new Set(streams.map(st => st.color));
  const free = PALETTE.find(p => !used.has(p.id));
  return (free || PALETTE[streams.length % PALETTE.length]).id;
}

/* Look-alikes for a guessed icon another station already has, so three jazz
   stations don't arrive as three 🎷 buttons a non-reader can't tell apart. */
const ICON_ALTERNATES = {
  '🎻': ['🎹', '🎼', '🪈'],
  '🎷': ['🎺', '🎹', '🎶'],
  '🗞️': ['🎙️', '📰', '📡'],
  '📻': ['📀', '💿', '🎙️'],
  '🤠': ['🪕', '🎸', '🌾'],
  '🌙': ['⭐', '✨', '🌌'],
  '🌿': ['🌊', '🌸', '🍃'],
  '🏟️': ['⚾', '🏈', '🏒'],
  '🕊️': ['⛪', '🙏', '✨'],
  '🎸': ['🥁', '🎤', '🔥'],
  '🪕': ['🎸', '🪗', '🌾'],
  '🎧': ['🎛️', '💿', '🎚️'],
  '🎤': ['🎶', '⭐', '💿'],
  '🎵': ['🎶', '🎼', '📻'],
};

/** `icon`, or the first look-alike no station in `streams` has yet. */
function distinctIcon(icon, streams) {
  const used = new Set(streams.map(st => st.emoji));
  if (!used.has(icon)) return icon;
  const alt = (ICON_ALTERNATES[icon] || []).find(a => !used.has(a));
  return alt || icon;
}

/** The label, description, icon and colour a browser item gets on add. */
function smartStation(item, streams) {
  return {
    label: cleanStationName(item.name),
    sub: clip(typeof item.meta === 'string' ? item.meta : '', SUB_MAX),
    emoji: distinctIcon(item.icon || DEFAULT_STATION_ICON, streams),
    color: freeColour(streams)
  };
}

var sbPreviewAudio = null;

/* Radio Browser runs several mirrors and publishes the list at
   all.api.radio-browser.info. That list picks which host the search goes to,
   so only names under api.radio-browser.info are used. A search tries up to
   three in random order (spreading the load), the long-standing de1 mirror
   among them, and each request gives up after 8 s so "Searching…" can't hang. */
const RB_SERVERS_URL = 'https://all.api.radio-browser.info/json/servers';
const RB_DEFAULT_HOST = 'de1.api.radio-browser.info';
const RB_HOST_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.api\.radio-browser\.info$/i;
const RB_TRIES = 3;
const RB_TIMEOUT_MS = 8000;

/** fetch() that gives up after `ms`. AbortController + setTimeout rather than
    AbortSignal.timeout(), which older Android WebViews lack. */
async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The mirror hosts to try for one search, in order. Never throws. */
async function radioBrowserHosts() {
  let names = [];
  try {
    const servers = await (await fetchWithTimeout(RB_SERVERS_URL, RB_TIMEOUT_MS)).json();
    if (Array.isArray(servers)) {
      names = servers.map(s => s && s.name).filter(n => typeof n === 'string' && RB_HOST_NAME.test(n));
    }
  } catch (e) { /* no list: the default host alone */ }
  names = [...new Set(names)].filter(n => n !== RB_DEFAULT_HOST);
  for (let i = names.length - 1; i > 0; i--) { // Fisher–Yates shuffle
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names.slice(0, RB_TRIES - 1).concat(RB_DEFAULT_HOST);
}

function openStreamBrowser() {
  var overlay = document.getElementById('stream-browser-overlay');
  overlay._returnFocus = document.activeElement;
  overlay.classList.add('open');
  inertBehind(overlay);
  overlay._focusTrap = function(e) { trapFocus(e, overlay); };
  overlay.addEventListener('keydown', overlay._focusTrap);
  document.getElementById('sb-search').value = '';
  document.getElementById('sb-country').value = '';
  renderMoods();
  loadRegions(); // no country: hides the region list
  showShelves();
  document.getElementById('sb-status').textContent = '';
  // Focus the title, not the search box: most people start from a shelf, and a
  // focused input pops the phone keyboard over them. A screen reader still
  // hears the dialog's name first.
  document.getElementById('sb-title').focus();
}

/** The mood chips, none chosen. */
function renderMoods() {
  sbMood = '';
  const box = document.getElementById('sb-moods');
  box.innerHTML = '';
  MOODS.forEach(function(mood) {
    const chip = document.createElement('button');
    chip.className = 'sb-mood';
    chip.dataset.mood = mood.id;
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', 'false');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = mood.icon + ' ';
    chip.append(icon, document.createTextNode(mood.label));
    chip.addEventListener('click', function() { selectMood(mood.id); });
    box.appendChild(chip);
  });
}

/** Choose a mood and search; choosing the chosen one again clears it. */
function selectMood(id) {
  sbMood = sbMood === id ? '' : id;
  document.querySelectorAll('#sb-moods .sb-mood').forEach(function(chip) {
    chip.setAttribute('aria-checked', chip.dataset.mood === sbMood ? 'true' : 'false');
  });
  const query = document.getElementById('sb-search').value.trim();
  const country = document.getElementById('sb-country').value;
  if (sbMood || query || country) searchStations();
  else showShelves();
}

/** The starter shelves, in place of any results. */
function showShelves() {
  stopSbPreview();
  sbSearched = false;
  const results = document.getElementById('sb-results');
  results._stations = null;
  results.innerHTML = '';
  const intro = document.createElement('p');
  intro.className = 'sb-shelves-intro';
  intro.textContent = 'Start with a shelf of hand-picked stations, or search the directory above.';
  const grid = document.createElement('div');
  grid.className = 'sb-shelves';
  SHELVES.forEach(function(shelf) {
    const btn = document.createElement('button');
    btn.className = 'sb-shelf';
    btn.dataset.shelf = shelf.id;
    const icon = document.createElement('span');
    icon.className = 'sb-shelf-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = shelf.icon;
    btn.append(icon, document.createTextNode(shelf.label));
    btn.addEventListener('click', function() { openShelf(shelf.id); });
    grid.appendChild(btn);
  });
  results.append(intro, grid);
}

function openShelf(id) {
  const shelf = SHELVES.find(function(sh) { return sh.id === id; });
  if (!shelf) return;
  renderStationRows(shelf.stations.map(function(st) {
    return { name: st.name, url: st.url, meta: st.sub, icon: shelf.icon };
  }), shelf.id);
  document.getElementById('sb-status').textContent =
    shelf.label + ': ' + shelf.stations.length + ' stations.';
}

/** Back to the shelves from a shelf or a search. Focus goes to the shelf that
    was open (or the first), since the button that had it is gone. */
function backToShelves(fromShelf) {
  showShelves();
  const results = document.getElementById('sb-results');
  const target = (fromShelf && results.querySelector('.sb-shelf[data-shelf="' + fromShelf + '"]')) ||
    results.querySelector('.sb-shelf');
  if (target) target.focus();
  document.getElementById('sb-status').textContent = 'Shelves.';
}

function backButton(fromShelf) {
  const back = document.createElement('button');
  back.className = 'sb-back';
  back.innerHTML = '<span aria-hidden="true">&#8249; </span>All shelves';
  back.addEventListener('click', function() { backToShelves(fromShelf); });
  return back;
}

/** A message where results would be, with the way back to the shelves. */
function showResultsMessage(msg) {
  const results = document.getElementById('sb-results');
  results._stations = null;
  results.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'stream-browser-empty';
  empty.textContent = msg;
  results.append(backButton(), empty);
}

/* ── Stations near you ────────────────────────────────────────────────
   Once a country is picked, its states or regions come from the directory.
   The directory's region names are typed in by whoever listed each station,
   so the list keeps names with enough stations to be worth a search, drops
   bare abbreviations ("CA", "NY") and repeats, and sorts the rest. If the
   list can't load, the region picker stays off and the country search works
   as before. */
const REGION_MIN_STATIONS = 10;
var sbCountryNames = null; // ISO code → the directory's country name, fetched once
var sbRegionRequest = 0;   // a newer country pick wins over a slower older one

/** GET a directory path as JSON, trying mirrors like searchStations does. */
async function radioBrowserJson(path) {
  for (const host of await radioBrowserHosts()) {
    try {
      const resp = await fetchWithTimeout('https://' + host + path, RB_TIMEOUT_MS);
      if (!resp.ok) throw new Error('API returned ' + resp.status);
      return await resp.json();
    } catch (err) {
      console.warn('[stream browser] ' + host + ' ' + path + ' failed:', err && err.message);
    }
  }
  throw new Error('the station directory is not responding');
}

function regionNames(states, countryName) {
  if (!Array.isArray(states)) return [];
  const seen = new Set();
  const names = [];
  states.forEach(function(st) {
    if (!st || st.country !== countryName || typeof st.name !== 'string') return;
    if (!(st.stationcount >= REGION_MIN_STATIONS)) return;
    const name = st.name.trim().replace(/\s+/g, ' ');
    // Folded for the repeat check: case, spacing and accents ("Île-de-France"
    // and "Ile-de-France" were listed twice).
    const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!name || /^[A-Z]{2,3}$/.test(name) || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names.sort(function(a, b) { return a.localeCompare(b); });
}

async function loadRegions() {
  const country = document.getElementById('sb-country').value;
  const region = document.getElementById('sb-region');
  const request = ++sbRegionRequest;
  region.innerHTML = '';
  region.appendChild(new Option('Any region', ''));
  region.disabled = true;
  region.hidden = !country;
  if (!country) return;
  region.options[0].textContent = 'Loading regions…';
  try {
    if (!sbCountryNames) {
      const countries = await radioBrowserJson('/json/countries');
      if (!Array.isArray(countries)) throw new Error('country list is not a list');
      sbCountryNames = {};
      countries.forEach(function(c) {
        if (c && typeof c.iso_3166_1 === 'string' && typeof c.name === 'string') sbCountryNames[c.iso_3166_1] = c.name;
      });
    }
    const countryName = sbCountryNames[country];
    if (!countryName) throw new Error('no directory name for ' + country);
    const states = await radioBrowserJson('/json/states/' + encodeURIComponent(countryName) + '/?hidebroken=true');
    if (request !== sbRegionRequest) return;
    const names = regionNames(states, countryName);
    if (names.length === 0) { region.hidden = true; return; }
    region.options[0].textContent = 'Any region';
    names.forEach(function(name) { region.appendChild(new Option(name, name)); });
    region.disabled = false;
  } catch (err) {
    if (request !== sbRegionRequest) return;
    console.warn('[stream browser] region list:', err && err.message);
    region.options[0].textContent = 'Regions unavailable';
  }
}

/* The last search, so a filter change can run it again: changing the
   country or region left the old results up as if they matched. */
var sbSearched = false;

function sbCountryChanged() {
  loadRegions();
  sbFilterChanged();
}

function sbFilterChanged() {
  if (sbSearched) searchStations();
}

function closeStreamBrowser() {
  stopSbPreview();
  var overlay = document.getElementById('stream-browser-overlay');
  if (overlay._focusTrap) {
    overlay.removeEventListener('keydown', overlay._focusTrap);
    overlay._focusTrap = null;
  }
  overlay.classList.remove('open');
  releaseInert(overlay);
  restoreFocus(overlay._returnFocus);
  overlay._returnFocus = null;
}

async function searchStations() {
  const query = document.getElementById('sb-search').value.trim();
  const country = document.getElementById('sb-country').value;
  const mood = MOODS.find(m => m.id === sbMood);
  const regionSelect = document.getElementById('sb-region');
  const region = country && !regionSelect.disabled ? regionSelect.value : '';

  if (!query && !country && !mood) return;
  sbSearched = true;

  stopSbPreview();
  const results = document.getElementById('sb-results');
  const status = document.getElementById('sb-status');
  results._stations = null;
  results.innerHTML = '<div class="sb-loading">Searching...</div>';
  status.textContent = 'Searching…';

  // 60, not 40: repeats of one station fold together below, so a page of
  // 60 still fills the list.
  const params = new URLSearchParams({
    limit: '60',
    order: 'clickcount',
    reverse: 'true',
    hidebroken: 'true'
  });
  if (query) params.set('name', query);
  if (country) params.set('countrycode', country);
  if (region) params.set('state', region);
  // An https page can't play http:// streams (see isMixedContentUrl), so the
  // hosted app asks only for https stations: a full page of results that play.
  // The file:// APK plays both and keeps searching everything.
  const httpsOnly = location.protocol === 'https:';
  if (httpsOnly) params.set('is_https', 'true');

  // The directory matches one tag per search, so a mood runs one search per
  // tag, side by side, and merges them by popularity.
  const tags = mood ? mood.tags : [null];
  function queries() {
    return tags.map(t => {
      const q = new URLSearchParams(params);
      if (t) q.set('tag', t);
      return q;
    });
  }

  for (const host of await radioBrowserHosts()) {
    try {
      const searchUrl = 'https://' + host + '/json/stations/search?';
      const fetchAll = (list) => Promise.all(list.map(async q => {
        const resp = await fetchWithTimeout(searchUrl + q.toString(), RB_TIMEOUT_MS);
        if (!resp.ok) throw new Error('API returned ' + resp.status);
        const found = await resp.json();
        return Array.isArray(found) ? found : [];
      }));
      const pages = await fetchAll(queries());
      const stations = pages.length === 1 ? pages[0] :
        pages.flat().sort((a, b) => (Number(b && b.clickcount) || 0) - (Number(a && a.clickcount) || 0));
      // Nothing secure found: look once more without the filter, so the empty
      // message only blames http:// when http:// stations really did match.
      let onlyHttpMatches = false;
      if (httpsOnly && playableHere(stations).length === 0) {
        params.delete('is_https');
        try {
          onlyHttpMatches = (await fetchAll(queries())).some(page => page.length > 0);
        } catch (err) {
          console.warn('[stream browser] ' + host + ' recheck failed:', err && err.message);
        }
      }
      renderBrowserResults(stations, onlyHttpMatches, mood);
      return;
    } catch (err) {
      console.warn('[stream browser] ' + host + ' failed:', err && err.message);
    }
  }

  // Every mirror failed. Offline, that's the network; online, it's the directory.
  const msg = navigator.onLine === false
    ? 'Search failed. Check your network connection and try again.'
    : "The station directory isn't responding. Try again in a few minutes, or pick a shelf.";
  showResultsMessage(msg);
  status.textContent = msg;
}

/** Directory results this page can play: on the hosted (https) app, a station
    whose resolved address is http:// would fail silently, so it's left out.
    The is_https search filter checks the listed address, which can still
    resolve to http://. */
function playableHere(stations) {
  if (!Array.isArray(stations)) return [];
  return stations.filter(s => s && !(typeof s.url_resolved === 'string' && isMixedContentUrl(s.url_resolved)));
}

const HTTP_ONLY_RESULTS_MESSAGE = 'No stations found that can play on this website. Some use http:// addresses, which browsers block here.';

/** The first entry of a directory list field ("english,french" → "English"). */
function firstListed(field) {
  const first = typeof field === 'string' ? field.split(',')[0].trim() : '';
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
}

/** One plain line about a directory station: "Jazz · Minnesota · English". */
function stationLine(s) {
  const place = (typeof s.state === 'string' && s.state.trim()) || s.country || '';
  const genre = genreOf(s.tags);
  return [genre ? genre.label : '', place, firstListed(s.language)].filter(Boolean).join(' · ');
}

/** One entry per station. The directory lists many stations several times
    (one per bitrate or mirror): the same address, or the same name and
    homepage, fold into the copy with the highest bitrate. */
function collapseDuplicates(stations) {
  const groups = new Map();
  stations.forEach(function(s) {
    if (typeof s.url_resolved !== 'string' || !s.url_resolved) return;
    const home = typeof s.homepage === 'string'
      ? s.homepage.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '') : '';
    const name = typeof s.name === 'string' ? s.name.trim().toLowerCase() : '';
    const key = home ? name + '|' + home : 'url|' + s.url_resolved;
    const group = groups.get(key);
    if (!group) groups.set(key, s);
    else if ((Number(s.bitrate) || 0) > (Number(group.bitrate) || 0)) groups.set(key, s);
  });
  const seenUrls = new Set();
  return [...groups.values()].filter(function(s) {
    if (seenUrls.has(s.url_resolved)) return false;
    seenUrls.add(s.url_resolved);
    return true;
  });
}

/* A name past this is keyword stuffing ("Jazz Smooth Jazz Lounge Chill
   Relax Café …", 300 characters and more): it ranks below plain names,
   whatever its popularity, and shows cut short. */
const SB_NAME_MAX = 60;

/** Plain names first, each group keeping the directory's popularity order. */
function rankByName(stations) {
  const long = (s) => (typeof s.name === 'string' ? s.name.trim().length : 0) > SB_NAME_MAX;
  return stations.filter(s => !long(s)).concat(stations.filter(long));
}

/** A name cut to SB_NAME_MAX characters for the list. */
function shortStationName(name) {
  const chars = Array.from(name);
  return chars.length > SB_NAME_MAX ? chars.slice(0, SB_NAME_MAX - 1).join('').trimEnd() + '…' : name;
}

function renderBrowserResults(stations, onlyHttpMatches, mood) {
  const status = document.getElementById('sb-status');
  // lastcheckok 0: the directory's own check found the station failing.
  stations = playableHere(stations).filter(s => s.lastcheckok !== 0);

  if (stations.length === 0) {
    const msg = onlyHttpMatches ? HTTP_ONLY_RESULTS_MESSAGE : 'No stations found. Try different search terms.';
    showResultsMessage(msg);
    status.textContent = onlyHttpMatches ? msg : 'No stations found.';
    return;
  }

  const items = rankByName(collapseDuplicates(stations)).slice(0, 60).map(s => ({
    name: typeof s.name === 'string' ? s.name.trim() : '',
    url: s.url_resolved,
    meta: stationLine(s),
    icon: guessIcon(s.tags) || (mood && mood.icon) || DEFAULT_STATION_ICON
  }));
  renderStationRows(items);
  status.textContent = items.length === 1 ? '1 station found.' : items.length + ' stations found.';
}

/** Addresses already on this radio, including edits not yet applied. */
function addedStreamUrls() {
  const urls = new Set(cfg.streams.map(st => typeof st.url === 'string' ? st.url.trim() : ''));
  document.querySelectorAll('#stream-editor [data-field="url"]').forEach(input => urls.add(input.value.trim()));
  urls.delete('');
  return urls;
}

/** Station rows (from a shelf or a search) under a way back to the shelves.
    Each item is { name, url, meta, icon }: meta is the line under the name,
    and with icon, what a station gets when added (smartStation). */
function renderStationRows(items, fromShelf) {
  stopSbPreview();
  const results = document.getElementById('sb-results');
  const added = addedStreamUrls();
  // A shelf tap removes the button that had focus; a search keeps it in the box.
  const hadFocus = results.contains(document.activeElement);
  results.innerHTML = '';
  const back = backButton(fromShelf);
  results.appendChild(back);
  items.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'sb-result';

    // Station name/URL are third-party (anyone can submit to Radio Browser).
    // Buttons are built with DOM APIs + closures, never an inline onclick
    // string: escAttr() is undone by the HTML parser before an inline handler's
    // JS runs, so a URL containing ' could break out and execute.
    const playBtn = document.createElement('button');
    playBtn.className = 'sb-result-play';
    playBtn.setAttribute('aria-label', 'Preview ' + s.name);
    playBtn.title = 'Preview';
    playBtn.innerHTML = '&#9654;';
    playBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleSbPreview(s.url, playBtn);
    });

    const info = document.createElement('div');
    info.className = 'sb-result-info';
    info.setAttribute('aria-hidden', 'true');
    info.innerHTML =
      '<div class="sb-result-name">' + escHtml(shortStationName(s.name)) + '</div>' +
      '<div class="sb-result-meta">' + escHtml(s.meta) + '</div>';

    let addBtn;
    if (added.has(s.url)) {
      addBtn = addedMark(s.name);
    } else {
      addBtn = document.createElement('button');
      addBtn.className = 'sb-result-add';
      addBtn.setAttribute('aria-label', 'Add ' + s.name);
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        addFromBrowser(i);
      });
    }

    div.append(playBtn, info, addBtn);
    div.dataset.stationIdx = i;
    results.appendChild(div);
  });

  // Stash results for addFromBrowser
  results._stations = items;
  syncBrowserCap();
  if (hadFocus) back.focus();
}

/** The "Added" mark that takes a row's + Add place. */
function addedMark(name) {
  const mark = document.createElement('span');
  mark.className = 'sb-result-added';
  mark.tabIndex = -1; // focus lands here after an add, so a screen reader hears it
  mark.textContent = 'Added';
  const why = document.createElement('span');
  why.className = 'sr-only';
  why.textContent = ': ' + name + ' is already on this radio';
  mark.appendChild(why);
  return mark;
}

/** At 8 stations, every + Add left is turned off, and the browser says why. */
function syncBrowserCap() {
  const full = cfg.streams.length >= MAX_STREAMS;
  document.querySelectorAll('#sb-results .sb-result-add').forEach(function(b) { b.disabled = full; });
  const cap = document.getElementById('sb-cap');
  cap.hidden = !full;
  cap.textContent = full ? STREAM_CAP_MESSAGE : '';
}

function toggleSbPreview(url, btn) {
  if (typeof url !== 'string' || !url || !isValidStreamUrl(url)) return;
  if (movedTo()) return; // nothing plays at the old address (24-moved.js)
  if (sbPreviewAudio && sbPreviewAudio.src === url) {
    stopSbPreview();
    return;
  }
  stopSbPreview();
  var preview = new Audio(url);
  sbPreviewAudio = preview;
  preview.volume = 0.5;
  preview.play().catch(function() {});
  btn.innerHTML = '&#9724;';
  btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Preview', 'Stop preview of'));
  btn.style.background = 'var(--accent)';
  btn.style.color = 'var(--on-accent)';
  // Only this preview may end itself: the one stopSbPreview() just discarded
  // still fires a late 'error' (clearing its src does that), and must not stop
  // the preview that replaced it.
  preview.addEventListener('ended', function() { if (sbPreviewAudio === preview) stopSbPreview(); });
  preview.addEventListener('error', function() { if (sbPreviewAudio === preview) stopSbPreview(); });
}

function stopSbPreview() {
  if (sbPreviewAudio) {
    sbPreviewAudio.pause();
    sbPreviewAudio.src = '';
    sbPreviewAudio = null;
  }
  // Reset all preview buttons
  document.querySelectorAll('.sb-result-play').forEach(function(btn) {
    btn.innerHTML = '&#9654;';
    btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Stop preview of', 'Preview'));
    btn.style.background = '';
    btn.style.color = '';
  });
}

function addFromBrowser(idx) {
  const results = document.getElementById('sb-results');
  const stations = results._stations;
  if (!stations || !stations[idx]) return;
  if (cfg.streams.length >= 8) return;

  stopSbPreview();
  readStreamEditor();

  const s = stations[idx];
  // Third-party URL — same http(s)-only rule applySettings() enforces, checked
  // here so a bad scheme never reaches the live preview before Apply.
  if (typeof s.url !== 'string' || !s.url || !isValidStreamUrl(s.url)) return;
  const station = Object.assign({ id: 's' + Date.now(), url: s.url }, smartStation(s, cfg.streams));
  cfg.streams.push(station);

  renderStreamEditor();
  renderButtons();
  // Browse stays open, so several stations can be added in one visit (each
  // add used to close it). The row says Added, and focus goes there.
  const row = document.querySelector('#sb-results .sb-result[data-station-idx="' + idx + '"]');
  const btn = row && row.querySelector('.sb-result-add');
  if (btn) {
    const mark = addedMark(s.name);
    btn.replaceWith(mark);
    mark.focus();
  }
  syncBrowserCap();
  document.getElementById('sb-status').textContent = 'Added ' + station.label + '. ' +
    cfg.streams.length + ' of ' + MAX_STREAMS + ' stations.';
}

// Allow Enter key to trigger search
document.addEventListener('DOMContentLoaded', function() {
  var sbInput = document.getElementById('sb-search');
  if (sbInput) {
    sbInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); searchStations(); }
    });
  }

  // Prevent all touch-scroll on the main interface (no pull-to-refresh,
  // no rubber-banding). Allow scrolling only inside designated containers.
  // Also block pinch-to-zoom (multi-touch), unless Allow pinch to zoom is
  // on: then a pinch goes through, and so does a one-finger drag while
  // zoomed in, or the reader couldn't move around the enlarged page.
  document.addEventListener('touchmove', function(e) {
    if (zoomAllowed()) {
      var zoomedIn = window.visualViewport && window.visualViewport.scale > 1.01;
      if (e.touches.length > 1 || zoomedIn) return;
    }
    if (e.touches.length > 1) { e.preventDefault(); return; }
    var el = e.target;
    while (el && el !== document.body) {
      // Allow scroll inside settings sidebar and overlay scroll containers
      if (el.id === 'settings-panel' || el.classList.contains('stream-browser-results') || el.classList.contains('stream-browser') ||
          el.classList.contains('emoji-grid') || el.classList.contains('emoji-picker-tabs')) {
        return;
      }
      el = el.parentElement;
    }
    e.preventDefault();
  }, { passive: false });

  // Safari-specific: block gesturestart (pinch/rotate gestures). iOS
  // ignores user-scalable=no, so these handlers are what keep it from
  // zooming, and they must stand aside when zoom is allowed.
  function blockGesture(e) { if (!zoomAllowed()) e.preventDefault(); }
  document.addEventListener('gesturestart', blockGesture);
  document.addEventListener('gesturechange', blockGesture);
  document.addEventListener('gestureend', blockGesture);
});


