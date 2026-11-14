/**
 * Starter shelves: the data in RadioGridXL.html and the checker that plays
 * each station before a release (check-shelves.mjs). The checker's network
 * calls are stubbed here; `npm run check:shelves` makes the real ones.
 * Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readShelves, checkStream, checkShelves } from '../check-shelves.mjs';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'RadioGridXL.html'), 'utf-8');
const shelves = readShelves(html);

test('seven shelves, each a short list of https stations with a name and a plain line', () => {
  assert.deepEqual(shelves.map((s) => s.label), ['Calm & easy', 'Oldies', 'Classical', 'Jazz', 'Country & gospel', 'News & talk', 'Sleep']);
  const urls = new Set();
  for (const shelf of shelves) {
    assert.ok(shelf.stations.length >= 4 && shelf.stations.length <= 8, `${shelf.label}: ${shelf.stations.length} stations`);
    for (const st of shelf.stations) {
      assert.match(st.url, /^https:\/\//, `${st.name} is https`);
      assert.ok(st.name && st.name.length <= 40, `${st.name}: a name that fits a button`);
      assert.ok(st.sub, `${st.name}: a plain line`);
      assert.ok(!urls.has(st.url), `${st.name}: on one shelf only`);
      urls.add(st.url);
    }
  }
});

/** A fake fetch response: `chunks` byte counts arrive one read at a time. */
function audio({ status = 200, type = 'audio/mpeg', url = 'https://s.example/live', chunks = [8192, 8192, 8192] } = {}) {
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers(type ? { 'content-type': type } : {}),
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: new Uint8Array(chunks[i++]) } : { done: true }) }) },
  };
}

test('a station sending audio passes', async () => {
  assert.deepEqual(await checkStream('https://s.example/live', { fetch: async () => audio() }), { ok: true });
  assert.deepEqual(await checkStream('https://s.example/live', { fetch: async () => audio({ type: 'application/ogg' }) }), { ok: true });
});

test('a station that isn\'t audio over https fails, saying why — unhappy path', async () => {
  const cases = [
    ['http://s.example/live', async () => audio(), /not an https address/],
    ['https://s.example/live', async () => audio({ status: 404 }), /HTTP 404/],
    ['https://s.example/live', async () => audio({ type: 'text/html' }), /not audio \(text\/html\)/],
    ['https://s.example/live', async () => audio({ type: '' }), /no content type/],
    ['https://s.example/live', async () => audio({ url: 'http://s.example/live' }), /redirects to http:/],
    ['https://s.example/live', async () => audio({ chunks: [100] }), /ended after 100 bytes/],
    ['https://s.example/live', async () => { throw new TypeError('fetch failed'); }, /fetch failed/],
  ];
  for (const [url, fetch, reason] of cases) {
    const result = await checkStream(url, { fetch });
    assert.equal(result.ok, false, String(reason));
    assert.match(result.reason, reason);
  }
});

test('a station that never answers is given up on — unhappy path', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const result = await checkStream('https://s.example/live', { fetch: hang, timeoutMs: 20 });
  assert.deepEqual(result, { ok: false, reason: 'no audio within 0.02 s' });
});

test('the shelf check names each failing station and its shelf', async () => {
  const dead = shelves[3].stations[1].url;
  const failures = await checkShelves(shelves, { fetch: async (url) => (url === dead ? audio({ status: 503 }) : audio({ url })) });
  assert.deepEqual(failures, [{ shelf: 'Jazz', name: shelves[3].stations[1].name, url: dead, reason: 'HTTP 503' }]);
});

test('a station that drops one connection gets a second try', async () => {
  const flaky = shelves[1].stations[0].url;
  let tries = 0;
  const fetch = async (url) => {
    if (url === flaky && tries++ === 0) throw new TypeError('fetch failed');
    return audio({ url });
  };
  assert.deepEqual(await checkShelves(shelves, { fetch }), []);
  assert.equal(tries, 2);
});
