/**
 * Stream browser — third-party station data from radio-browser.info is
 * UNTRUSTED (anyone can submit a station). Covers the preview-button XSS and
 * the http(s)-only URL rule on add. Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { installClock, installFakeAudio, CONNECT_MS } from './playback-fakes.mjs';

/** Boot with media playback stubbed — jsdom doesn't implement play(). */
function loadWithMedia() {
  const w = loadApp();
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  return w;
}

const streamButtonCount = (w) => w.document.querySelectorAll('#buttons .stream-btn').length;

test('preview button does not execute a quote-breaking station URL (XSS regression)', () => {
  // REGRESSION: the URL was spliced into an inline onclick="toggleSbPreview('…')"
  // with escAttr(). The HTML parser decodes &#39; back to ' before the handler
  // runs, so this URL broke out of the string literal and executed.
  const w = loadWithMedia();
  const evil = "http://x.example/'+(window.__pwned=1)+'";
  w.renderBrowserResults([{ name: 'Evil FM', url_resolved: evil, country: 'XX' }]);

  const play = w.document.querySelector('.sb-result-play');
  assert.equal(play.hasAttribute('onclick'), false, 'no inline handler string');
  play.click();

  assert.equal(w.__pwned, undefined, 'URL payload must not run');
  assert.equal(play.getAttribute('aria-label'), 'Stop preview of Evil FM', 'preview started with the raw URL');
});

test('station name is rendered as text, not markup', () => {
  const w = loadWithMedia();
  w.renderBrowserResults([{ name: '<img src=x onerror="window.__pwned=1">', url_resolved: 'https://ok.example/s' }]);
  assert.equal(w.document.querySelector('.sb-result img'), null, 'no injected element');
  assert.equal(w.__pwned, undefined);
});

test('addFromBrowser rejects a non-http(s) station URL (unhappy path)', () => {
  const w = loadWithMedia();
  const before = streamButtonCount(w);
  w.renderBrowserResults([{ name: 'Bad Scheme', url_resolved: 'javascript:alert(1)' }]);
  w.addFromBrowser(0);
  assert.equal(streamButtonCount(w), before, 'javascript: station is not added');
});

test('addFromBrowser adds a valid https station', () => {
  const w = loadWithMedia();
  const before = streamButtonCount(w);
  w.renderBrowserResults([{ name: 'Good FM', url_resolved: 'https://good.example/stream', country: 'US', tags: 'jazz,blues' }]);
  w.addFromBrowser(0);
  assert.equal(streamButtonCount(w), before + 1);
  const added = w.document.querySelector('#buttons .stream-btn:last-child');
  assert.equal(added.getAttribute('aria-label'), 'Good FM', 'named by the station alone');
  assert.equal(w.document.getElementById(added.getAttribute('aria-describedby')).textContent, 'Jazz · US', 'the line is its description');
});

test('previewing one station straight after another keeps the new preview playing', async () => {
  const w = loadApp();
  const clock = installClock(w);
  const previews = [];
  w.Audio = function (url) {
    const el = w.document.createElement('audio');
    installFakeAudio(w, el);
    el.src = url;
    previews.push(el);
    return el;
  };
  w.renderBrowserResults([
    { name: 'A FM', url_resolved: 'https://a.example/stream' },
    { name: 'B FM', url_resolved: 'https://b.example/stream' },
  ]);
  const [playA, playB] = w.document.querySelectorAll('.sb-result-play');
  playA.click();
  await clock.tick(CONNECT_MS);
  playB.click(); // discarding A queues an 'error' on A (its src is cleared)
  await clock.tick(CONNECT_MS);
  assert.equal(previews[1].paused, false, 'B is still playing');
  assert.equal(playB.getAttribute('aria-label'), 'Stop preview of B FM');
  assert.equal(playA.getAttribute('aria-label'), 'Preview A FM');
});

// ── Station search: which mirror, failover, timeouts ────────────────────

const SERVERS_URL = 'https://all.api.radio-browser.info/json/servers';
const STATION = { name: 'Jazz FM', url_resolved: 'https://ice.example.com/jazz', country: 'US' };
const reply = (data, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data });

/** Stub fetch: the server list returns `servers`; each search goes to
    `search(host, attempt)`. Records every search host in order. */
function stubDirectory(w, { servers, search }) {
  const hosts = [];
  w.console.warn = () => {};
  w.fetch = async (url, init) => {
    if (url === SERVERS_URL) return reply(servers);
    const host = new URL(url).host;
    hosts.push(host);
    return search(host, hosts.length, init);
  };
  return hosts;
}

async function search(w, query = 'jazz') {
  w.document.getElementById('sb-search').value = query;
  await w.searchStations();
  return w.document.getElementById('sb-status').textContent;
}

test('a server-list name outside api.radio-browser.info is never searched — unhappy path', async () => {
  const w = loadApp();
  const hosts = stubDirectory(w, {
    servers: [{ name: 'evil.example.com' }, { name: 'api.radio-browser.info.evil.example' }, {}, { name: 42 }],
    search: () => reply([STATION]),
  });
  await search(w);
  assert.deepEqual(hosts, ['de1.api.radio-browser.info']);
});

test('a dead mirror falls through to the next one', async () => {
  const w = loadApp();
  const hosts = stubDirectory(w, {
    servers: [{ name: 'nl1.api.radio-browser.info' }, { name: 'at1.api.radio-browser.info' }],
    search: (host, attempt) => (attempt === 1 ? Promise.reject(new TypeError('Failed to fetch')) : reply([STATION])),
  });
  await search(w);
  assert.equal(hosts.length, 2);
  assert.ok(w.document.querySelector('.sb-result'), 'results from the second mirror');
});

test('when every mirror fails, it says the directory is down, not the network — unhappy path', async () => {
  const w = loadApp();
  const hosts = stubDirectory(w, {
    servers: ['a', 'b', 'c', 'd'].map((x) => ({ name: x + '1.api.radio-browser.info' })),
    search: () => reply(null, false),
  });
  const status = await search(w);
  assert.ok(hosts.length <= 3, 'gives up after three tries');
  assert.match(status, /directory isn't responding/);
});

test('offline, the failure still points at the network', async () => {
  const w = loadApp();
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
  stubDirectory(w, { servers: [], search: () => Promise.reject(new TypeError('Failed to fetch')) });
  assert.match(await search(w), /Check your network connection/);
});

test('a mirror that never answers is given up on, so "Searching…" can\'t hang — unhappy path', async () => {
  const w = loadApp();
  const clock = installClock(w);
  const hosts = stubDirectory(w, {
    servers: [{ name: 'nl1.api.radio-browser.info' }],
    // Never resolves on its own; only the abort ends it.
    search: (host, attempt, init) => (attempt === 1
      ? new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new w.DOMException('aborted', 'AbortError'))))
      : reply([STATION])),
  });
  w.document.getElementById('sb-search').value = 'jazz';
  const done = w.searchStations();
  for (let i = 0; i < 3; i++) await clock.tick(8000);
  await done;
  assert.equal(hosts.length, 2, 'moved on to the next host');
  assert.ok(w.document.querySelector('.sb-result'));
});

// ── http:// stations on the hosted (https) app ──────────────────────────
// Browsers block http:// audio on an https page, so the hosted app only lists
// stations it can play. The file:// APK plays both.

const HTTP_STATION = { name: 'Plain FM', url_resolved: 'http://plain.example/live' };

/** Stub the directory, recording each search's query string. `searchReply`
    gets the URLSearchParams of that search. */
function stubQueries(w, searchReply) {
  const queries = [];
  w.console.warn = () => {};
  w.fetch = async (url) => {
    if (url === SERVERS_URL) return reply([{ name: 'nl1.api.radio-browser.info' }]);
    const params = new URL(url).searchParams;
    queries.push(params);
    return searchReply(params);
  };
  return queries;
}

const names = (w) => [...w.document.querySelectorAll('.sb-result-name')].map((el) => el.textContent);

test('hosted over https: the search asks for https stations and lists no http:// one', async () => {
  const w = loadApp({ url: 'https://marsh.city/radio/' });
  // The directory's is_https filter checks the listed address; this http://
  // one stands for a station whose https address resolves to http://.
  const queries = stubQueries(w, () => reply([STATION, HTTP_STATION]));
  await search(w);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].get('is_https'), 'true');
  assert.deepEqual(names(w), ['Jazz FM']);
  assert.equal(w.document.getElementById('sb-status').textContent, '1 station found.');
});

test('opened from a file (the Android app): http:// stations are searched and listed', async () => {
  const w = loadApp({ url: 'file:///android_asset/RadioGridXL.html' });
  const queries = stubQueries(w, () => reply([STATION, HTTP_STATION]));
  await search(w);
  assert.equal(queries[0].has('is_https'), false);
  assert.deepEqual(names(w), ['Jazz FM', 'Plain FM']);
});

test('hosted: when only http:// stations match, it says why nothing is listed (unhappy path)', async () => {
  const w = loadApp({ url: 'https://marsh.city/radio/' });
  const queries = stubQueries(w, (params) => reply(params.get('is_https') === 'true' ? [] : [HTTP_STATION]));
  const status = await search(w, 'plain');
  assert.equal(queries.length, 2, 'one recheck without the filter');
  assert.equal(queries[1].get('name'), 'plain', 'the recheck is the same search');
  assert.equal(status, 'No stations found that can play on this website. Some use http:// addresses, which browsers block here.');
  assert.equal(w.document.querySelector('.sb-result'), null);
});

test('hosted: no matches at all is still a plain "No stations found" (unhappy path)', async () => {
  const w = loadApp({ url: 'https://marsh.city/radio/' });
  stubQueries(w, () => reply([]));
  assert.equal(await search(w, 'zzzz'), 'No stations found.');
});

test('hosted: if the recheck fails, the empty result still shows plainly (unhappy path)', async () => {
  const w = loadApp({ url: 'https://marsh.city/radio/' });
  stubQueries(w, (params) => (params.get('is_https') === 'true' ? reply([]) : Promise.reject(new TypeError('Failed to fetch'))));
  assert.equal(await search(w), 'No stations found.');
});

// ── Starter shelves ─────────────────────────────────────────────────────

const shelfLabels = (w) => [...w.document.querySelectorAll('.sb-shelf')].map((b) => b.lastChild.textContent);
const rowNames = (w) => [...w.document.querySelectorAll('.sb-result-name')].map((el) => el.textContent);

/** fetch that fails every call and counts them: the directory is down. */
function directoryDown(w) {
  const calls = [];
  w.console.warn = () => {};
  w.fetch = async (url) => { calls.push(url); throw new TypeError('Failed to fetch'); };
  return calls;
}

test('the browser opens on the starter shelves, with no directory request', () => {
  const w = loadWithMedia();
  const calls = directoryDown(w);
  w.openStreamBrowser();
  assert.deepEqual(shelfLabels(w), ['Calm & easy', 'Oldies', 'Classical', 'Jazz', 'Country & gospel', 'News & talk', 'Sleep']);
  assert.equal(calls.length, 0, 'the shelves need no network');
  assert.equal(w.document.activeElement.id, 'sb-title', 'focus starts on the title, so no keyboard pops up');
});

test('Shift+Tab from the focused title wraps inside the dialog, not out of it', () => {
  const w = loadWithMedia();
  directoryDown(w);
  // jsdom has no layout, so every offsetParent is null; trapFocus filters on it.
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode; } });
  w.openStreamBrowser();
  const overlay = w.document.getElementById('stream-browser-overlay');
  const event = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  w.document.activeElement.dispatchEvent(event);
  assert.ok(event.defaultPrevented, 'the trap handles it');
  assert.ok(overlay.contains(w.document.activeElement), 'focus stays in the dialog');
  assert.equal(w.document.activeElement.textContent, 'Close');
});

test('a shelf lists its stations; one previews and adds like a search result', () => {
  const w = loadWithMedia();
  directoryDown(w);
  w.openStreamBrowser();
  const before = streamButtonCount(w);
  const jazz = [...w.document.querySelectorAll('.sb-shelf')].find((b) => b.dataset.shelf === 'jazz');
  jazz.focus();
  jazz.click();
  assert.ok(rowNames(w).includes('Jazz 88 KBEM'));
  assert.equal(w.document.activeElement.className, 'sb-back', 'focus moves to All shelves, not the page');
  assert.match(w.document.getElementById('sb-status').textContent, /^Jazz: \d stations\.$/);
  const row = [...w.document.querySelectorAll('.sb-result')].find((r) => r.textContent.includes('Jazz 88 KBEM'));
  assert.equal(row.querySelector('.sb-result-meta').textContent, 'Jazz · Minneapolis');
  const play = row.querySelector('.sb-result-play');
  play.click();
  assert.equal(play.getAttribute('aria-label'), 'Stop preview of Jazz 88 KBEM');
  row.querySelector('.sb-result-add').click();
  assert.equal(streamButtonCount(w), before + 1);
  const added = w.document.querySelector('#buttons .stream-btn:last-child');
  assert.equal(added.getAttribute('aria-label'), 'Jazz 88 KBEM', 'named by the station alone');
  assert.equal(w.document.getElementById(added.getAttribute('aria-describedby')).textContent, 'Jazz · Minneapolis', 'the line is its description');
});

test('All shelves goes back, with focus on the shelf that was open', () => {
  const w = loadWithMedia();
  directoryDown(w);
  w.openStreamBrowser();
  w.openShelf('sleep');
  w.document.querySelector('.sb-back').click();
  assert.equal(shelfLabels(w).length, 7);
  assert.equal(w.document.activeElement.dataset.shelf, 'sleep');
});

test('with the directory down, the shelves still work and a search says the directory isn\'t responding — unhappy path', async () => {
  const w = loadWithMedia();
  directoryDown(w);
  w.openStreamBrowser();
  assert.match(await search(w), /directory isn't responding/);
  assert.ok(w.document.querySelector('.sb-back'), 'a way back to the shelves');
  w.document.querySelector('.sb-back').click();
  w.openShelf('news');
  assert.ok(rowNames(w).includes('MPR News'));
});

test('no shelf lists a broadcaster whose terms bar directories (BBC, iHeart, Audacy, SomaFM)', () => {
  // These say no to third-party apps, or nothing clear.
  const w = loadWithMedia();
  const urls = [...w.eval('SHELVES')].flatMap((shelf) => shelf.stations.map((s) => s.url));
  const barred = /bbc|iheart|audacy|somafm|radiotime\.com/i;
  assert.deepEqual([...urls.filter((u) => barred.test(u))], []);
});

// ── Stations near you ───────────────────────────────────────────────────

const US = 'The United States Of America';
const STATES = [
  { name: 'Minnesota', country: US, stationcount: 93 },
  { name: ' Minnesota', country: US, stationcount: 12 }, // a repeat with a stray space
  { name: 'California', country: US, stationcount: 463 },
  { name: 'CA', country: US, stationcount: 40 },          // a bare abbreviation
  { name: 'Duluth MN', country: US, stationcount: 4 },    // too few to be worth a search
  { name: 'Ontario', country: 'Canada', stationcount: 362 }, // the path filter matches by substring
];

/** A directory with a country list, a region list and a search, recording
    each search's parameters. `fail` names the parts that are down. */
function stubRegions(w, { fail = [] } = {}) {
  const searches = [];
  w.console.warn = () => {};
  w.fetch = async (url) => {
    if (url === SERVERS_URL) return reply([{ name: 'nl1.api.radio-browser.info' }]);
    const u = new URL(url);
    if (u.pathname === '/json/countries') {
      if (fail.includes('countries')) return reply(null, false);
      return reply([{ name: US, iso_3166_1: 'US', stationcount: 8820 }, { name: 'Canada', iso_3166_1: 'CA', stationcount: 1659 }]);
    }
    if (u.pathname.startsWith('/json/states/')) {
      if (fail.includes('states')) return Promise.reject(new TypeError('Failed to fetch'));
      return reply(decodeURIComponent(u.pathname) === `/json/states/${US}/` ? STATES : []);
    }
    searches.push(u.searchParams);
    return reply([{ ...STATION, name: 'Jazz 88', state: 'Minnesota' }]);
  };
  return searches;
}

const regionOptions = (w) => [...w.document.getElementById('sb-region').options].map((o) => o.value);

test('picking United States lists its regions; Minnesota narrows the search to Minnesota', async () => {
  const w = loadApp();
  const searches = stubRegions(w);
  w.openStreamBrowser();
  const region = w.document.getElementById('sb-region');
  assert.equal(region.hidden, true, 'no region list before a country');
  w.document.getElementById('sb-country').value = 'US';
  await w.loadRegions();
  assert.equal(region.hidden, false);
  assert.equal(region.disabled, false);
  assert.deepEqual(regionOptions(w), ['', 'California', 'Minnesota'], 'tidied: no abbreviation, repeat, tiny region or other country');
  region.value = 'Minnesota';
  await w.searchStations();
  assert.equal(searches.length, 1);
  assert.equal(searches[0].get('countrycode'), 'US');
  assert.equal(searches[0].get('state'), 'Minnesota');
  assert.deepEqual(rowNames(w), ['Jazz 88']);
});

test('a region list that fails to load leaves the country search working — unhappy path', async () => {
  for (const fail of ['countries', 'states']) {
    const w = loadApp();
    const searches = stubRegions(w, { fail: [fail] });
    w.openStreamBrowser();
    w.document.getElementById('sb-country').value = 'US';
    await w.loadRegions();
    const region = w.document.getElementById('sb-region');
    assert.equal(region.disabled, true, `${fail} down: region list off`);
    assert.equal(region.options[0].textContent, 'Regions unavailable');
    await w.searchStations();
    assert.equal(searches[0].get('countrycode'), 'US', `${fail} down: country search still runs`);
    assert.equal(searches[0].has('state'), false);
    assert.ok(w.document.querySelector('.sb-result'));
  }
});

test('changing country clears the old region, and a slow old region list can\'t overwrite the new one', async () => {
  const w = loadApp();
  stubRegions(w);
  w.document.getElementById('sb-country').value = 'US';
  const slow = w.loadRegions();
  w.document.getElementById('sb-country').value = '';
  await w.loadRegions();
  await slow;
  const region = w.document.getElementById('sb-region');
  assert.equal(region.hidden, true);
  assert.deepEqual(regionOptions(w), ['']);
});

// ── Cleaner results ─────────────────────────────────────────────────────

test('results fold repeats of one station into its best copy and drop failing ones', () => {
  const w = loadWithMedia();
  w.renderBrowserResults([
    { name: 'Jazz 88', homepage: 'https://www.jazz88.fm/', bitrate: 64, url_resolved: 'https://a.example/64', tags: 'jazz', state: 'Minnesota', language: 'english' },
    { name: 'Jazz 88 ', homepage: 'http://jazz88.fm', bitrate: 128, url_resolved: 'https://a.example/128', tags: 'jazz', state: 'Minnesota', language: 'english' },
    { name: 'Copy FM', url_resolved: 'https://a.example/128' },                 // same address under another name
    { name: 'Dead FM', url_resolved: 'https://dead.example/s', lastcheckok: 0 },  // failing its last check
    { name: 'Plain FM', url_resolved: 'https://plain.example/s', country: 'Canada', tags: 'talk,news', language: 'french,english' },
  ]);
  assert.deepEqual(rowNames(w), ['Jazz 88', 'Plain FM']);
  w.document.querySelector('.sb-result-play').click();
  assert.equal(w.document.querySelector('.sb-result-play').getAttribute('aria-label'), 'Stop preview of Jazz 88');
  const metas = [...w.document.querySelectorAll('.sb-result-meta')].map((el) => el.textContent);
  assert.deepEqual(metas, ['Jazz · Minnesota · English', 'Talk · Canada · French']);
  assert.equal(w.document.getElementById('sb-status').textContent, '2 stations found.');
});

test('every result failing its check reads as no stations found — unhappy path', () => {
  const w = loadWithMedia();
  w.renderBrowserResults([{ name: 'Dead FM', url_resolved: 'https://dead.example/s', lastcheckok: 0 }]);
  assert.equal(w.document.querySelector('.sb-result'), null);
  assert.equal(w.document.getElementById('sb-status').textContent, 'No stations found.');
});

test('a station already on this radio shows Added instead of + Add', () => {
  const w = loadWithMedia();
  // The default profile's first station.
  w.renderBrowserResults([
    { name: 'Mellow Mix', url_resolved: 'https://stream.radioparadise.com/mellow-128' },
    { name: 'New FM', url_resolved: 'https://new.example/s' },
  ]);
  const [onRadio, fresh] = w.document.querySelectorAll('.sb-result');
  assert.equal(onRadio.querySelector('.sb-result-add'), null);
  assert.equal(onRadio.querySelector('.sb-result-added').textContent, 'Added: Mellow Mix is already on this radio');
  assert.ok(fresh.querySelector('.sb-result-add'));
});

test('Added counts a station typed into settings but not yet applied, and shelves show it too', () => {
  const w = loadWithMedia();
  w.openSettings();
  const url = w.document.querySelector('#stream-editor [data-field="url"]');
  assert.ok(url, 'the stream editor has a URL field');
  url.value = 'https://nis.stream.publicradio.org/nis.mp3';
  w.openStreamBrowser();
  w.openShelf('news');
  const mpr = [...w.document.querySelectorAll('.sb-result')].find((r) => r.textContent.includes('MPR News'));
  assert.ok(mpr.querySelector('.sb-result-added'));
});

// ── Smart add ───────────────────────────────────────────────────────────

/** The stream editor's view of station `i`: label, description, icon, colour. */
function editorStation(w, i) {
  const d = w.document;
  const field = (f) => d.querySelector(`#stream-editor input[data-field="${f}"][data-idx="${i}"]`).value;
  return {
    label: field('label'),
    sub: field('sub'),
    emoji: field('emoji'),
    color: d.querySelector(`#stream-editor .color-chip[data-idx="${i}"][aria-checked="true"]`).dataset.color,
  };
}

test('a shelf station arrives ready to use: its shelf\'s icon, its plain line, a colour no other station has', () => {
  const w = loadWithMedia();
  directoryDown(w);
  w.openSettings();
  w.openStreamBrowser();
  w.openShelf('jazz');
  // The default stations are green and blue; purple is the first free colour.
  w.document.querySelector('.sb-result-add').click();
  assert.deepEqual(editorStation(w, 2), { label: 'Jazz 88 KBEM', sub: 'Jazz · Minneapolis', emoji: '🎷', color: 'purple' });
  w.openStreamBrowser();
  w.openShelf('news');
  w.document.querySelector('.sb-result-add').click();
  assert.equal(editorStation(w, 3).color, 'teal', 'the next free colour');
  assert.equal(editorStation(w, 3).emoji, '🗞️');
});

test('a directory station gets a name without the clutter and an icon from its tags', () => {
  const w = loadWithMedia();
  w.openSettings();
  w.renderBrowserResults([{
    name: 'KNOW 91.1 Minnesota Public Radio News - Minneapolis-St. Paul, MN',
    url_resolved: 'https://nis.example/nis.mp3',
    tags: 'minneapolis,minnesota public radio,news,npr',
    state: 'Minnesota',
    language: 'english',
  }]);
  w.addFromBrowser(0);
  assert.deepEqual(editorStation(w, 2), {
    label: 'KNOW 91.1 Minnesota Public Radio News',
    sub: 'Public radio · Minnesota · English',
    emoji: '🗞️',
    color: 'purple',
  });
});

test('names are cut only where a name is left, and never split an emoji', () => {
  const w = loadApp();
  const cases = [
    ['Jazz FM (London)', 'Jazz FM'],
    ['Radio One | Hits all day - live', 'Radio One'],
    ['- 0 N - 50s on Radio', '- 0 N - 50s on Radio'], // "- 0 N" has one letter: kept whole
    ['FM - 1', 'FM - 1'],
    ['  ', ''],
    [undefined, ''],
    ['A very long station name that runs well past forty characters', 'A very long station name that runs well '],
    ['🎷'.repeat(45), '🎷'.repeat(40)],
  ];
  for (const [name, expected] of cases) assert.equal(w.cleanStationName(name), expected, String(name));
});

test('icons come from the first tag that suggests one', () => {
  const w = loadApp();
  assert.equal(w.guessIcon('minneapolis,jazz,news'), '🎷');
  assert.equal(w.guessIcon('Classical,Relax'), '🎻');
  assert.equal(w.guessIcon('60s,rock'), '📻');
  assert.equal(w.guessIcon('community,local'), '');
  assert.equal(w.guessIcon(undefined), '');
});

test('the plain line names the first tag that is a genre, never a year or a city — unhappy path', () => {
  const w = loadWithMedia();
  w.renderBrowserResults([
    { name: 'Vinyl', url_resolved: 'https://a.example/1', tags: '1930,1940,swing,crooners', state: 'New York NY', language: 'english' },
    { name: 'Rapids FM', url_resolved: 'https://a.example/2', tags: 'grand rapids,community', state: 'Michigan' },
    { name: 'Symph', url_resolved: 'https://a.example/3', tags: 'Symphonic,orchestra', country: 'Austria' },
    { name: 'Hop', url_resolved: 'https://a.example/4', tags: 'Hip-Hop,R&B' },
  ]);
  const metas = [...w.document.querySelectorAll('.sb-result-meta')].map((el) => el.textContent);
  assert.deepEqual(metas, ['Jazz · New York NY · English', 'Michigan', 'Classical · Austria', 'Hip hop']);
  assert.equal(w.guessIcon('grand rapids'), '', '"rap" is a whole word, not part of "rapids"');
});

test('with all eight colours in use, colours repeat in order', () => {
  const w = loadApp();
  const ids = ['blue', 'green', 'purple', 'teal', 'red', 'amber', 'slate', 'rose'];
  assert.equal(w.freeColour(ids.map((color) => ({ color }))), 'blue');
  assert.equal(w.freeColour(ids.concat('blue').map((color) => ({ color }))), 'green');
  assert.equal(w.freeColour([{ color: 'blue' }, { color: 'purple' }]), 'green');
});

test('a station with no tags, no place and a name that is all clutter still adds — unhappy path', () => {
  const w = loadWithMedia();
  w.openSettings();
  w.renderBrowserResults([
    { name: 'FM - 1', url_resolved: 'https://bare.example/s' },
    { name: 'FM - 2', url_resolved: 'https://bare.example/t' },
  ]);
  w.addFromBrowser(0);
  const added = editorStation(w, 2);
  assert.equal(added.label, 'FM - 1');
  assert.equal(added.sub, '');
  assert.equal(added.emoji, '🎵');
  // The default icon is taken now, so the next bare station gets its look-alike.
  w.addFromBrowser(1);
  assert.equal(editorStation(w, 3).emoji, '🎶');
});

// ── Moods ───────────────────────────────────────────────────────────────

const moodChips = (w) => [...w.document.querySelectorAll('#sb-moods .sb-mood')];

test('mood chips replace the genre dropdown, as a radio group', () => {
  const w = loadApp();
  w.openStreamBrowser();
  assert.equal(w.document.getElementById('sb-tag'), null, 'no genre dropdown');
  assert.equal(w.document.getElementById('sb-moods').getAttribute('role'), 'radiogroup');
  assert.deepEqual(moodChips(w).map((c) => c.lastChild.textContent),
    ['Relaxing', 'Upbeat', 'Oldies', 'Classical', 'Jazz', 'Country', 'News & talk', 'Sports', 'Faith']);
  assert.ok(moodChips(w).every((c) => c.getAttribute('role') === 'radio' && c.getAttribute('aria-checked') === 'false'));
});

test('a mood searches its tags side by side, merged by popularity, with the country too', async () => {
  const w = loadApp();
  const queries = stubQueries(w, (params) => reply({
    jazz: [{ name: 'Big Jazz', url_resolved: 'https://a.example/1', clickcount: 50, tags: 'jazz' }],
    'smooth jazz': [{ name: 'Smooth', url_resolved: 'https://a.example/2', clickcount: 900, tags: 'smooth jazz' }],
    blues: [{ name: 'Blues Hall', url_resolved: 'https://a.example/3', clickcount: 70, tags: 'community' }],
  }[params.get('tag')]));
  w.openStreamBrowser();
  w.document.getElementById('sb-country').value = 'US';
  const jazz = moodChips(w).find((c) => c.dataset.mood === 'jazz');
  jazz.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(queries.map((q) => q.get('tag')).sort(), ['blues', 'jazz', 'smooth jazz']);
  assert.ok(queries.every((q) => q.get('countrycode') === 'US'));
  assert.equal(jazz.getAttribute('aria-checked'), 'true');
  assert.deepEqual(rowNames(w), ['Smooth', 'Blues Hall', 'Big Jazz']);
  // No jazz tag of its own: it gets the mood's icon on add.
  w.openSettings();
  w.addFromBrowser(1);
  assert.equal(editorStation(w, 2).emoji, '🎷');
});

test('tapping the chosen mood again clears it, back to the shelves when nothing else is set', async () => {
  const w = loadApp();
  stubQueries(w, () => reply([STATION]));
  w.openStreamBrowser();
  const news = moodChips(w).find((c) => c.dataset.mood === 'news');
  news.click();
  await new Promise((r) => setTimeout(r, 20));
  news.click();
  assert.equal(news.getAttribute('aria-checked'), 'false');
  assert.equal(w.document.querySelectorAll('.sb-shelf').length, 7);
});

test('a mood search with the directory down says the directory isn\'t responding — unhappy path', async () => {
  const w = loadApp();
  directoryDown(w);
  w.openStreamBrowser();
  w.selectMood('relaxing');
  await w.searchStations();
  assert.match(w.document.getElementById('sb-status').textContent, /directory isn't responding/);
});
