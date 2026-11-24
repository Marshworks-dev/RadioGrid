/**
 * The meta-test for the promise checks. It fails when:
 *   - a breaker in tests/promise-breakers.mjs names a check file that doesn't exist;
 *   - with the private promise list (PROMISES.md) on disk: a line is malformed,
 *     its `test:` check is missing, or it has no breaker. A public checkout has
 *     no PROMISES.md, so those two tests skip there; the breakers still run;
 *   - a breaker's `find` text isn't in its file exactly once (the code moved,
 *     so the breaker would silently break nothing);
 *   - a check fails on an untouched copy of the repo (so its failures below
 *     would mean nothing);
 *   - a check PASSES with a breaker applied: the promise could be broken and
 *     nobody would know.
 * Each run copies the repo (minus .git, node_modules, android, dist) to a
 * temp dir, links node_modules, applies one breaker and runs the check there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, cpSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { BREAKERS } from './promise-breakers.mjs';
import { shardJobs } from './promise-shard.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules', 'android', 'dist', '.claude']);

// The promise list is kept privately; the checks and breakers are public.
const PROMISES_FILE = join(repo, 'PROMISES.md');
const listOpts = { skip: !existsSync(PROMISES_FILE) && 'no PROMISES.md in this checkout' };

/** PROMISES.md lines as { text, check } with check 'judge' or a path. */
function promises() {
  const lines = readFileSync(PROMISES_FILE, 'utf-8').split('\n').filter((l) => l.startsWith('- '));
  return lines.map((line) => {
    const m = line.match(/^- (.+?) · why: (.+?) · check: (test:(\S+)|judge)\s*$/);
    assert.ok(m, `malformed promise line: ${line}`);
    return { text: m[1], check: m[4] || 'judge' };
  });
}

/** How to run a check: smoke-test.mjs is a script, the rest are node:test files. */
const commandFor = (check) => (check.endsWith('.test.mjs') ? ['--test', '--test-timeout=600000', check] : [check]);

/** A breaker's changes as a list of { find, replace }. */
const editsOf = (b) => b.edits || [{ find: b.find, replace: b.replace }];

/** A throwaway copy of the repo with `breaker` applied (or none). */
function copyRepo(breaker) {
  const dir = mkdtempSync(join(tmpdir(), 'rgxl-promise-'));
  cpSync(repo, dir, { recursive: true, filter: (src) => !SKIP.has(relative(repo, src).split('/')[0]) });
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
  if (breaker) {
    const path = join(dir, breaker.file);
    let text = readFileSync(path, 'utf-8');
    for (const e of editsOf(breaker)) text = text.replace(e.find, () => e.replace);
    writeFileSync(path, text);
  }
  return dir;
}

/** Run a check in `dir`; resolves to its exit code and the tail of its output. */
function run(dir, check) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, commandFor(check), { cwd: dir, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, tail: out.slice(-1500) }));
  });
}

test('every breaker names a check file that exists', () => {
  for (const b of BREAKERS) assert.ok(existsSync(join(repo, b.check)), `breaker "${b.name}" names ${b.check}, which does not exist`);
});

test('every promise line is well formed and every test: check exists', listOpts, () => {
  const list = promises();
  assert.ok(list.length >= 1);
  for (const p of list) if (p.check !== 'judge') assert.ok(existsSync(join(repo, p.check)), `${p.check} (for "${p.text}") does not exist`);
});

test('every test: promise has at least one breaker, and every breaker belongs to a promise', listOpts, () => {
  const checks = new Set(promises().filter((p) => p.check !== 'judge').map((p) => p.check));
  for (const c of checks) assert.ok(BREAKERS.some((b) => b.check === c), `no breaker for ${c}`);
  for (const b of BREAKERS) assert.ok(checks.has(b.check), `breaker "${b.name}" names ${b.check}, which no promise uses`);
});

test('every breaker\'s find text appears exactly once in its file', () => {
  for (const b of BREAKERS) {
    const text = readFileSync(join(repo, b.file), 'utf-8');
    for (const e of editsOf(b)) {
      const count = text.split(e.find).length - 1;
      assert.equal(count, 1, `breaker "${b.name}": find text appears ${count} times in ${b.file}`);
    }
  }
});

// CI splits this test across jobs (PROMISE_SHARD="k/n", see ci.yml) and skips
// it in the job that runs everything else (SKIP_PROMISE_BREAKERS=1). Local
// runs set neither and run it whole.
const breakerTestOpts = { timeout: 1800000, skip: process.env.SKIP_PROMISE_BREAKERS === '1' && 'runs in the CI breaker shards' };

test('each check passes on an untouched copy, then fails with each of its breakers', breakerTestOpts, async () => {
  const checks = [...new Set(BREAKERS.map((b) => b.check))];
  const jobs = shardJobs([
    ...checks.map((check) => ({ check, breaker: null })),
    ...BREAKERS.map((b) => ({ check: b.check, breaker: b })),
  ], process.env.PROMISE_SHARD);
  const results = [];
  // A few at a time: the browser checks each start Chromium.
  for (let i = 0; i < jobs.length; i += 4) {
    results.push(...await Promise.all(jobs.slice(i, i + 4).map(async (job) => {
      const dir = copyRepo(job.breaker);
      try { return { ...job, ...await run(dir, job.check) }; } finally { rmSync(dir, { recursive: true, force: true }); }
    })));
  }
  const problems = [];
  for (const r of results) {
    if (!r.breaker && r.code !== 0) problems.push(`${r.check} fails on an untouched copy:\n${r.tail}`);
    if (r.breaker && r.code === 0) problems.push(`${r.check} still passes with breaker "${r.breaker.name}"`);
  }
  assert.deepEqual(problems, []);
});
