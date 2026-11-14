/**
 * RadioGridXL.html is built from src/ (build.mjs) and committed. This keeps
 * the two in step: a hand edit to the built file, or a src/ edit without a
 * rebuild, fails here and in CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, appendFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = (cwd) => spawnSync(process.execPath, [join(cwd, 'build.mjs'), '--check'], { encoding: 'utf-8' });

/** A throwaway copy of build.mjs, src/ and the built file to break. */
function withCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rgxl-build-sync-'));
  try {
    cpSync(join(repo, 'build.mjs'), join(dir, 'build.mjs'));
    cpSync(join(repo, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(repo, 'RadioGridXL.html'), join(dir, 'RadioGridXL.html'));
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the committed RadioGridXL.html matches a fresh build of src/', () => {
  const run = check(repo);
  assert.equal(run.status, 0, run.stderr || 'edit src/, not RadioGridXL.html, then run: npm run build');
  assert.match(run.stdout, /matches src\//, 'the check ran (a skipped main guard also exits 0)');
});

test('a hand edit to RadioGridXL.html fails the check and says to edit src/', () => {
  withCopy((dir) => {
    const built = join(dir, 'RadioGridXL.html');
    writeFileSync(built, readFileSync(built, 'utf-8').replace('</body>', '<!-- hand edit --></body>'));
    const run = check(dir);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Edit src\/, not RadioGridXL\.html, then run: npm run build/);
  });
});

test('a src/ edit without a rebuild fails the check', () => {
  withCopy((dir) => {
    const first = readdirSync(join(dir, 'src', 'app')).filter((n) => n.endsWith('.js')).sort()[0];
    appendFileSync(join(dir, 'src', 'app', first), '// unbuilt edit\n');
    assert.equal(check(dir).status, 1);
  });
});
