/**
 * The hosted copy's extras (hosted-build.mjs): the CSP meta tag and the
 * content-hashed cache name in sw.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HOSTED_CSP, injectCsp, stampCacheVersion, cacheVersionOf, appVersionOf, releaseNeedsUpdatesEntry } from '../hosted-build.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(repo, f), 'utf-8');
const HTML = read('RadioGridXL.html');
const SW = read('sw.js');
const shell = (index = 'index') => [
  { name: 'index.html', data: index },
  { name: 'manifest.json', data: read('manifest.json') },
];

test('the CSP goes right after the charset, ahead of every style and script', () => {
  const out = injectCsp(HTML);
  const at = out.indexOf('http-equiv="Content-Security-Policy"');
  assert.ok(at > 0 && at < out.indexOf('<style') && at < out.indexOf('<script'));
  assert.equal(out.match(/http-equiv="Content-Security-Policy"/g).length, 1);
  assert.ok(out.includes(`content="${HOSTED_CSP}"`));
});

test('the hosted CSP is server.js\'s policy without frame-ancestors', () => {
  const block = read('server.js').match(/'Content-Security-Policy': \[([\s\S]*?)\]\.join/)[1];
  // One quoted directive per line: "default-src 'self'", or 'media-src http: ...',
  const server = block.split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean).map((l) => l.slice(1, -1));
  assert.ok(server.length >= 9, 'parsed the server policy');
  assert.deepEqual(HOSTED_CSP.split('; '), server.filter((d) => !d.startsWith('frame-ancestors')));
});

test('both policies refuse <object>/<embed> with object-src \'none\'', () => {
  // Without it, object-src falls back to default-src 'self'. Each policy is
  // checked on its own, not only through the equality test above.
  const block = read('server.js').match(/'Content-Security-Policy': \[([\s\S]*?)\]\.join/)[1];
  assert.match(block, /^\s*"object-src 'none'",$/m, 'server.js sends it');
  assert.ok(HOSTED_CSP.split('; ').includes("object-src 'none'"), 'the hosted meta tag carries it');
});

test('a build without the expected charset, or with a CSP already, fails loudly — unhappy path', () => {
  assert.throws(() => injectCsp(HTML.replace('<meta charset="UTF-8">', '<meta charset="utf-8">')), /charset/);
  assert.throws(() => injectCsp(injectCsp(HTML)), /already has a CSP/);
});

test('the stamped cache name keeps the version and the rgxl-shell- prefix', () => {
  const version = cacheVersionOf(SW);
  const stamped = cacheVersionOf(stampCacheVersion(SW, shell()));
  assert.match(stamped, new RegExp(`^${version.replace(/\./g, '\\.')}-[0-9a-f]{8}$`));
  assert.ok(stamped.startsWith('rgxl-shell-'));
});

test('any change to a shell file changes the stamp, and the same files give the same stamp', () => {
  const a = cacheVersionOf(stampCacheVersion(SW, shell('index')));
  assert.equal(cacheVersionOf(stampCacheVersion(SW, shell('index'))), a);
  assert.notEqual(cacheVersionOf(stampCacheVersion(SW, shell('index, one byte different'))), a);
});

test('a sw.js without the expected cache line fails loudly — unhappy path', () => {
  assert.throws(() => stampCacheVersion(SW.replace(/const CACHE_VERSION = '[^']+';/, "const CACHE_VERSION = 'v1';"), shell()), /CACHE_VERSION/);
  assert.throws(() => stampCacheVersion(stampCacheVersion(SW, shell()), shell()), /CACHE_VERSION/, 'stamping twice');
});

test('the version helpers read the footer and the cache name', () => {
  assert.match(appVersionOf(HTML), /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(cacheVersionOf(SW), `rgxl-shell-${appVersionOf(HTML)}`);
  assert.equal(appVersionOf('<p>no footer</p>'), null);
});

test('the app version reads from builds before and after the v7.24.0 rename', () => {
  assert.equal(appVersionOf('<div id="settings-version">RadioGrid v7.24.0</div>'), '7.24.0');
  assert.equal(appVersionOf('<div id="settings-version">RadioGridXL v7.23.8</div>'), '7.23.8', 'marsh.city holds this until the deploy');
  assert.equal(appVersionOf('<div id="settings-version">SomeRadio v7.24.0</div>'), null);
});

test('minor and major releases need a project-page Updates entry; patches ride on their minor', () => {
  assert.equal(releaseNeedsUpdatesEntry('7.18.0'), true);
  assert.equal(releaseNeedsUpdatesEntry('8.0.0'), true);
  assert.equal(releaseNeedsUpdatesEntry('7.17.1'), false);
  assert.equal(releaseNeedsUpdatesEntry('7.15.10'), false);
});

test('a version that does not parse still needs an Updates entry, so the guard fails closed — unhappy path', () => {
  for (const v of [null, undefined, '', '7.17', '7.17.1-beta', 'v7.17.1', '7.17.x']) {
    assert.equal(releaseNeedsUpdatesEntry(v), true, String(v));
  }
});
