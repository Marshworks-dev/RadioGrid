/**
 * build-profile.mjs refuses a profile that would ship broken: the app trusts
 * PROFILE, so a bad PIN locks every device on that build out of settings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateProfile, paletteIdsFrom } from '../build-profile.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const PALETTE_IDS = paletteIdsFrom(readFileSync(join(repo, 'RadioGridXL.html'), 'utf-8'));
const profile = (name) => JSON.parse(readFileSync(join(repo, 'profiles', name), 'utf-8'));
const GOOD = profile('default.json');
const problemsWith = (change) => validateProfile({ ...structuredClone(GOOD), ...change }, PALETTE_IDS);

test('the palette ids are read from the app', () => {
  assert.deepEqual(PALETTE_IDS, ['blue', 'green', 'purple', 'teal', 'red', 'amber', 'slate', 'rose']);
});

test('every shipped profile passes', () => {
  for (const name of readdirSync(join(repo, 'profiles')).filter((f) => f.endsWith('.json'))) {
    assert.deepEqual(validateProfile(profile(name), PALETTE_IDS), [], name);
  }
});

test('a PIN the 4-digit pad can never match is refused — unhappy path', () => {
  for (const pin of [2580, '25800', '258', 'abcd', null]) {
    assert.match(problemsWith({ pin }).join('\n'), /pin must be/, String(pin));
  }
  assert.deepEqual(problemsWith({ pin: '2580' }), []);
});

test('broken streams are refused: none, too many, duplicate ids, bad URLs, unknown colours — unhappy path', () => {
  const s = GOOD.streams[0];
  assert.match(problemsWith({ streams: [] }).join(), /1 to 8/);
  assert.match(problemsWith({ streams: Array.from({ length: 9 }, (_, i) => ({ ...s, id: 's' + i })) }).join(), /1 to 8/);
  assert.match(problemsWith({ streams: [s, { ...s }] }).join(), /used twice/);
  assert.match(problemsWith({ streams: [{ ...s, url: 'javascript:alert(1)' }] }).join(), /url must be/);
  assert.match(problemsWith({ streams: [{ ...s, color: 'chartreuse' }] }).join(), /color must be/);
  assert.match(problemsWith({ streams: [{ ...s, id: 'a b"' }] }).join(), /id must be/);
});

test('a typo in a key, or text that would end the app\'s script, is refused — unhappy path', () => {
  assert.match(problemsWith({ pIn: '1234' }).join(), /unknown key "pIn"/);
  assert.match(problemsWith({ orgName: 'Acme</script><script>alert(1)' }).join(), /<\/script/);
  assert.match(problemsWith({ orientation: 'sideways' }).join(), /orientation/);
});

test('run through a symlinked path, the script still runs instead of exiting 0 having built nothing — unhappy path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rgxl-build-'));
  try {
    const link = join(dir, 'build-profile.mjs');
    symlinkSync(join(repo, 'build-profile.mjs'), link);
    // A profile that doesn't exist: main() refuses with exit 1 and writes nothing,
    // so a skipped main() (exit 0) can't pass for a refusal.
    const run = spawnSync(process.execPath, [link, 'no-such-profile'], { encoding: 'utf-8' });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /Available profiles/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a profile kept outside the repo is read from its path, and refused there like any other — unhappy path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rgxl-profile-'));
  try {
    const missing = spawnSync(process.execPath, [join(repo, 'build-profile.mjs'), join(dir, 'nope.json')], { encoding: 'utf-8' });
    assert.equal(missing.status, 1, missing.stderr);
    assert.ok(missing.stderr.includes(join(dir, 'nope.json')), 'names the path it looked at');
    // A numeric PIN: read from the path, then refused before anything is built.
    const bad = join(dir, 'my-org.json');
    writeFileSync(bad, JSON.stringify({ ...structuredClone(GOOD), pin: 1234 }));
    const run = spawnSync(process.execPath, [join(repo, 'build-profile.mjs'), bad], { encoding: 'utf-8' });
    assert.equal(run.status, 1, run.stderr);
    assert.ok(run.stderr.includes(`${bad} has problems`), run.stderr);
    assert.match(run.stderr, /pin must be/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('madeBy must be a non-empty string when present; leaving it out is fine — unhappy path', () => {
  for (const madeBy of ['', '   ', 42, true, null]) {
    assert.match(problemsWith({ madeBy }).join('\n'), /madeBy must be/, String(madeBy));
  }
  const { madeBy, ...without } = structuredClone(GOOD);
  assert.equal(madeBy, 'MarshWorks', 'the default build names the maker');
  assert.deepEqual(validateProfile(without, PALETTE_IDS), []);
});
