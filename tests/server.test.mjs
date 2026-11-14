/**
 * server.js (Docker host) — boots the real server on a spare port and checks
 * it survives malformed input and sends security headers.
 * Run with: npm run test:dom
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 39000 + Math.floor(Math.random() * 900);
let proc;

before(async () => {
  proc = spawn(process.execPath, [join(repo, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait for the listen log line rather than sleeping a fixed time.
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('serving on')) resolve(); });
    proc.on('exit', (code) => reject(new Error('server exited early: ' + code)));
  });
});

after(() => proc && proc.kill());

/** Raw GET — node's fetch would reject/normalize a malformed path client-side. */
function get(path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('malformed percent-escape gets 400 and does not crash the server (unhappy path)', async () => {
  // REGRESSION: decodeURIComponent threw inside the async handler → unhandled
  // rejection → process exit. One request could knock the server over.
  const bad = await get('/%E0%A4%A');
  assert.equal(bad.status, 400);
  assert.equal(proc.exitCode, null, 'server still running');

  const ok = await get('/');
  assert.equal(ok.status, 200, 'next request is served');
});

test('responses carry security headers', async () => {
  const res = await get('/');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(res.headers['content-security-policy'], /frame-src https:\/\/marsh\.city(;|$)/, 'guide overlay can frame only marsh.city');
  assert.match(res.headers['content-type'], /text\/html/);
});

test('sw.js is served no-cache with headers', async () => {
  const res = await get('/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-cache/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('sw.js carries a hash of the shell in its cache name, so an edited HTML reaches installed apps', async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const res = await get('/sw.js');
  const plain = readFileSync(join(repo, 'sw.js'), 'utf8').match(/const CACHE_VERSION = '([^']+)'/)[1];
  const hash = createHash('sha256');
  for (const name of ['RadioGridXL.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png']) {
    hash.update(name).update('\0').update(readFileSync(join(repo, name))).update('\0');
  }
  assert.ok(res.body.includes(`const CACHE_VERSION = '${plain}-${hash.digest('hex').slice(0, 8)}';`), 'stamped with the shell hash');
  assert.ok(!res.body.includes(`const CACHE_VERSION = '${plain}';`), 'not the bare version, which a same-version edit would never roll');
});
