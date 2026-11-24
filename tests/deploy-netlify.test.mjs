/**
 * deploy-radio-to-netlify.mjs: the checks that stand between a build and
 * radio.marshworks.dev, and the upload, with Keychain and Netlify faked.
 * Nothing here touches the network or the real Keychain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addressProblems, filesHoldingToken, readToken, uploadDeploy, HOST, KEYCHAIN_SERVICE } from '../deploy-radio-to-netlify.mjs';
import { hostedFiles, SHELL_FILES } from '../hosted-build.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'nfp_test-token-never-printed';

/** The hosted files for the default build, gathered from a throwaway copy
    so this repo's dist/ (which may hold a branded build) is never read. */
async function defaultBuild() {
  const dir = mkdtempSync(join(tmpdir(), 'rg-netlify-test-'));
  try {
    for (const f of [...SHELL_FILES, 'sw.js', 'feedback']) cpSync(join(repo, f), join(dir, f), { recursive: true });
    mkdirSync(join(dir, 'dist'));
    cpSync(join(repo, 'RadioGridXL.html'), join(dir, 'dist', 'RadioGridXL.html'));
    return await hostedFiles(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const withHtml = (files, edit) => files.map((f) => (f.name === 'index.html' ? { ...f, data: edit(String(f.data)) } : f));

// ── The address check ─────────────────────────────────────────────────────
test(`the default build is a build for ${HOST}`, async () => {
  assert.deepEqual(addressProblems(await defaultBuild()), []);
});

test('a build whose QR opens marsh.city/radio is refused — unhappy path', async () => {
  const old = withHtml(await defaultBuild(), (html) => html.replace(/<svg class="feedback-qr"[\s\S]*?<\/svg>/, '<svg class="feedback-qr" id="feedback-qr" aria-label="QR code: opens marsh.city/radio/feedback on your phone"></svg>'));
  assert.match(addressProblems(old).join('\n'), /QR in the build doesn't open/);
});

test('a build that prints the old feedback address is refused — unhappy path', async () => {
  const old = withHtml(await defaultBuild(), (html) => html.replace('radio.<wbr>marshworks.dev/<wbr>feedback', 'marsh.city/<wbr>radio/<wbr>feedback'));
  assert.match(addressProblems(old).join('\n'), /prints the feedback address as marsh\.city\/radio\/feedback/);
});

test('the moved build made for marsh.city/radio is refused — unhappy path', async () => {
  const moved = withHtml(await defaultBuild(), (html) => html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<meta name="radiogrid-moved" content="radio.marshworks.dev">'));
  assert.match(addressProblems(moved).join('\n'), /moved build/);
});

test('a build without the feedback page, or without index.html, is refused — unhappy path', async () => {
  const files = await defaultBuild();
  assert.match(addressProblems(files.filter((f) => f.name !== 'feedback/index.html')).join('\n'), /no feedback\/index\.html/);
  assert.match(addressProblems(files.filter((f) => f.name !== 'index.html')).join('\n'), /no index\.html/);
});

// ── The token ─────────────────────────────────────────────────────────────
test('the token is read from the Keychain item by name, from stdout, never as an argument', () => {
  let call;
  const token = readToken((cmd, args, opts) => { call = { cmd, args, opts }; return `${TOKEN}\n`; });
  assert.equal(token, TOKEN);
  assert.equal(call.cmd, 'security');
  assert.deepEqual(call.args, ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w']);
  assert.ok(!call.args.includes(TOKEN));
});

test('a missing or empty Keychain item stops with a plain message — unhappy path', () => {
  const missing = () => { const e = new Error('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.'); e.status = 44; throw e; };
  assert.throws(() => readToken(missing), (err) => err.message.startsWith(`no Keychain item "${KEYCHAIN_SERVICE}"`) && err.message.includes('security add-generic-password'));
  assert.throws(() => readToken(() => '  \n'), /is empty/);
});

test('a file holding the token is caught before upload; the real build holds none — unhappy path', async () => {
  const files = await defaultBuild();
  assert.deepEqual(filesHoldingToken(files, TOKEN), []);
  const leaked = files.map((f) => (f.name === 'sw.js' ? { ...f, data: `${f.data}\n// ${TOKEN}` } : f));
  assert.deepEqual(filesHoldingToken(leaked, TOKEN), ['sw.js']);
});

// ── The upload ────────────────────────────────────────────────────────────
function fakeNetlify(replies) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, ...opts });
    const r = replies.shift();
    return { ok: r.status < 300, status: r.status, json: async () => r.body };
  };
  return { calls, fetchFn };
}
const quiet = { wait: async () => {}, log: () => {} };

test('the zip goes to the site as one deploy with the token in the header only, then waits for ready', async () => {
  const { calls, fetchFn } = fakeNetlify([
    { status: 200, body: { id: 'd1', state: 'uploaded' } },
    { status: 200, body: { id: 'd1', state: 'processing' } },
    { status: 200, body: { id: 'd1', state: 'ready' } },
  ]);
  const zip = Buffer.from('PK fake');
  const deploy = await uploadDeploy(zip, TOKEN, { fetchFn, ...quiet });
  assert.equal(deploy.state, 'ready');
  assert.equal(calls[0].url, `https://api.netlify.com/api/v1/sites/${HOST}/deploys`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['Content-Type'], 'application/zip');
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].body, zip);
  assert.equal(calls[2].url, 'https://api.netlify.com/api/v1/deploys/d1');
  for (const c of calls) assert.ok(!c.url.includes(TOKEN), 'token never in a URL');
  for (const c of calls) assert.ok(c.signal instanceof AbortSignal, `${c.url} has a timeout, so a hung connection can't stall the deploy`);
});

test('a refused upload or a failed deploy stops with a reason, never the token — unhappy path', async () => {
  const bad = fakeNetlify([{ status: 401, body: {} }]);
  await assert.rejects(uploadDeploy(Buffer.from(''), TOKEN, { fetchFn: bad.fetchFn, ...quiet }), (err) => /HTTP 401.*wrong or expired/.test(err.message) && !err.message.includes(TOKEN));
  const failed = fakeNetlify([{ status: 200, body: { id: 'd2', state: 'error', error_message: 'bad zip' } }]);
  await assert.rejects(uploadDeploy(Buffer.from(''), TOKEN, { fetchFn: failed.fetchFn, ...quiet }), /failed the deploy: bad zip/);
});

test('a deploy that never goes live gives up after two minutes — unhappy path', async () => {
  const stuck = { fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ id: 'd3', state: 'processing' }) }) };
  await assert.rejects(uploadDeploy(Buffer.from(''), TOKEN, { ...stuck, ...quiet }), /still "processing" after 2 minutes/);
});
