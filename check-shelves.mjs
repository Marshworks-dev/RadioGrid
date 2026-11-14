#!/usr/bin/env node
/**
 * Plays the start of every starter-shelf station (SHELVES in RadioGridXL.html)
 * and fails, naming the station, when one doesn't answer as audio over https.
 * Shelf stations are hand-picked and shown before any search, so a dead one
 * would greet every technician who opens the browser. Needs the network, so
 * it runs on demand and before a release, not in `npm test`.
 * Run with: npm run check:shelves
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const START = '/* === SHELVES — check-shelves.mjs reads this block === */';
const END = '/* === END SHELVES === */';

/** The SHELVES array from the app's HTML. The block holds plain JSON so it
    can be read here without running the app. */
export function readShelves(html) {
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s < 0 || e < s) throw new Error('no SHELVES block in RadioGridXL.html');
  const body = html.slice(s + START.length, e).trim();
  const m = body.match(/^const SHELVES = ([\s\S]*);$/);
  if (!m) throw new Error('SHELVES block is not `const SHELVES = [...];`');
  return JSON.parse(m[1]);
}

// About two seconds of a 64 kbps stream: enough to show audio is flowing,
// short enough that a whole shelf checks in seconds.
const MIN_BYTES = 16 * 1024;
const TIMEOUT_MS = 10000;
const AUDIO_TYPE = /^(audio\/|application\/ogg)/i;

/** Fetch the start of one stream. Resolves { ok, reason }; never throws. */
export async function checkStream(url, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!/^https:\/\//i.test(url)) return { ok: false, reason: 'not an https address' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctl.signal, headers: { 'Icy-MetaData': '0' } });
    if (!resp.ok) return { ok: false, reason: 'HTTP ' + resp.status };
    // A redirect to http:// is blocked on the hosted (https) app, like an
    // http:// address would be.
    if (resp.url && !/^https:\/\//i.test(resp.url)) return { ok: false, reason: 'redirects to ' + resp.url };
    const type = resp.headers.get('content-type') || '';
    if (!AUDIO_TYPE.test(type)) return { ok: false, reason: 'not audio (' + (type || 'no content type') + ')' };
    let bytes = 0;
    const reader = resp.body.getReader();
    while (bytes < MIN_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
    }
    if (bytes < MIN_BYTES) return { ok: false, reason: 'stream ended after ' + bytes + ' bytes' };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: ctl.signal.aborted ? 'no audio within ' + timeoutMs / 1000 + ' s' : (err && err.message) || String(err) };
  } finally {
    clearTimeout(timer);
    ctl.abort(); // a live stream never ends; stop downloading it
  }
}

/** Check every station, a few at a time. Resolves the failures. */
export async function checkShelves(shelves, opts) {
  const jobs = shelves.flatMap((shelf) => shelf.stations.map((station) => ({ shelf, station })));
  const failures = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { shelf, station } = jobs[next++];
      // One retry: a live stream can drop a single connection, and a blip
      // shouldn't fail a release.
      let result = await checkStream(station.url, opts);
      if (!result.ok) result = await checkStream(station.url, opts);
      if (!result.ok) failures.push({ shelf: shelf.label, name: station.name, url: station.url, reason: result.reason });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'RadioGridXL.html'), 'utf-8');
  const shelves = readShelves(html);
  const count = shelves.reduce((n, s) => n + s.stations.length, 0);
  const failures = await checkShelves(shelves);
  for (const f of failures) console.error(`FAIL  ${f.shelf} / ${f.name}: ${f.reason}\n      ${f.url}`);
  console.log(`${count - failures.length} of ${count} shelf stations play.`);
  process.exit(failures.length ? 1 : 0);
}
