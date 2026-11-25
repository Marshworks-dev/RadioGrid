/**
 * sync-radio-to-marshcity.mjs, run for real against throwaway repos: a copy
 * of this repo's build inputs, and a marsh.city cloned the way the real
 * checkout is, so its branch tracks origin/main. The build lands in the
 * copy's dist/, never this repo's (which may hold a profile someone is about
 * to install by hand). A --deploy that gets past its checks runs the copy's
 * stand-in `npm test`, then commits and pushes to the throwaway origin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync, appendFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appVersionOf, isMarkedMoved } from '../hosted-build.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_VERSION = appVersionOf(readFileSync(join(repo, 'RadioGridXL.html'), 'utf-8'));

// What the sync reads from this repo. The guide is a stand-in written below:
// only its shape matters here.
const BUILD_INPUTS = ['sync-radio-to-marshcity.mjs', 'hosted-build.mjs', 'build-profile.mjs', 'build.mjs', 'src', 'RadioGridXL.html', 'profiles', 'sw.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'feedback', 'licences'];

// What the last deploy left committed in marsh.city: an older version.
const OLD_RADIO = {
  'public/radio/index.html': '<p id="settings-version">RadioGridXL v7.5.0</p>\n',
  'public/radio/sw.js': "const CACHE_VERSION = 'rgxl-shell-7.5.0-0badcafe';\n",
};

// A project page that's kept up: an Updates entry for the version going out,
// showing a screenshot the capture makes.
const PAGE_PATH = 'src/content/projects/radiogridxl.md';
const currentPage = (version = APP_VERSION) =>
  `# RadioGridXL\n\n![The grid](/images/radiogridxl/page/grid.webp)\n\n## Updates\n\n### 2026-10-26\nReleased v${version}.\n`;

// git here ignores this machine's config: CI has no identity, and a global
// hook or commit signing has no business in a throwaway repo.
const GIT_ENV = {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
};
// Run from a git hook, these would point every git call here at that hook's
// repo instead of the throwaway one.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete GIT_ENV[name];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf-8', stdio: 'pipe' }).trim();

const STACK_TRACE = /^\s+at /m;

/** Every file and folder under `dir`, .git included: path → content hash. */
function snapshot(dir) {
  const entries = {};
  for (const p of readdirSync(dir, { recursive: true }).map(String).sort()) {
    const full = join(dir, p);
    entries[p] = statSync(full).isDirectory() ? 'dir' : createHash('sha256').update(readFileSync(full)).digest('hex');
  }
  return entries;
}

/** The changed-files list and diff summary a run printed. */
const changesIn = (stdout) => stdout.match(/• Changes in marsh\.city[^\n]*\n([\s\S]*?)\n\n/)[1];

/** Write `files` ({ path: text }) into `dir`, then commit all of `dir` as a new repo. */
function commitRepo(dir, files, message) {
  for (const [path, data] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), data);
  }
  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', message);
}

/**
 * The build inputs, committed (so the sync sees no uncommitted changes), and
 * a marsh.city clone whose origin has `radio` committed. public/radio is in
 * the clone either way, since the sync refuses without it; with nothing
 * committed there, that's the first deploy.
 */
function throwaway(radio, page = { [PAGE_PATH]: currentPage() }, { version } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rgxl-sync-'));
  const rgxl = join(dir, 'RadioGridXL');
  mkdirSync(rgxl);
  for (const f of BUILD_INPUTS) cpSync(join(repo, f), join(rgxl, f), { recursive: true });
  // Not a build input: a stand-in, so a test can prove the sync never publishes it.
  writeFileSync(join(rgxl, 'PROMISES.md'), '# Promises\n\n- stand-in\n');
  // A test about the release rule pins its own version, so it doesn't flip
  // with the repo's (a patch release needs no Updates entry).
  if (version) {
    const html = join(rgxl, 'RadioGridXL.html');
    writeFileSync(html, readFileSync(html, 'utf-8').replace(`RadioGrid v${APP_VERSION}<`, `RadioGrid v${version}<`));
  }
  commitRepo(rgxl, {
    'guide/guide.md': '# Guide\n\n![A shot](shots/one.webp)\n', 'guide/shots/one.webp': 'not really a webp',
    'guide/page/grid.webp': 'not really a webp either',
    // The tests --deploy runs first: a stand-in, since the real ones are these.
    'package.json': '{ "private": true, "scripts": { "test": "node -e 0" } }\n',
  }, 'build inputs');
  const site = join(dir, 'site');
  commitRepo(site, { 'README.md': 'The site.\n', ...radio, ...page }, 'radio: sync RadioGridXL v7.5.0 (0000000)');
  // The origin has main checked out; let a deploy's push land on it anyway.
  git(site, 'config', 'receive.denyCurrentBranch', 'ignore');
  const marsh = join(dir, 'marsh');
  git(dir, 'clone', '--quiet', join(dir, 'site'), marsh);
  mkdirSync(join(marsh, 'public', 'radio'), { recursive: true });
  const sync = (...args) => spawnSync(process.execPath, [join(rgxl, 'sync-radio-to-marshcity.mjs'), ...args], {
    encoding: 'utf-8', env: { ...GIT_ENV, MARSHCITY_REPO: marsh },
  });
  return { rgxl, marsh, site, sync, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a dry run changes no file in marsh.city, .git included, and still prints the changes', () => {
  const { marsh, sync, cleanup } = throwaway({ ...OLD_RADIO, 'public/images/radiogridxl/guide/one.jpg': 'the shot before it was webp' });
  try {
    // What a real checkout can hold when the dry run starts: the project page
    // edited for the release and not committed, a file staged, a stray file.
    appendFileSync(join(marsh, PAGE_PATH), '\nA line for the release, not committed.\n');
    writeFileSync(join(marsh, 'staged.md'), 'Staged, nothing to do with the radio.\n');
    git(marsh, 'add', 'staged.md');
    writeFileSync(join(marsh, 'public', 'radio', 'stray.txt'), 'Left here by hand.\n');
    const before = snapshot(marsh);
    const run = sync();
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(snapshot(marsh), before);
    const changes = changesIn(run.stdout);
    for (const line of [' M public/radio/index.html', ' M public/radio/sw.js', ` M ${PAGE_PATH}`,
      ' D public/images/radiogridxl/guide/one.jpg', '?? public/radio/stray.txt', '?? public/radio/manifest.json', '?? src/content/guides/radiogridxl.md']) {
      assert.ok(changes.includes(`${line}\n`), `${line} in:\n${changes}`);
    }
    assert.doesNotMatch(changes, /staged\.md/, 'only the synced paths');
    assert.match(changes, /^ public\/radio\/index\.html +\| +\d+ /m, 'the diff summary');
    assert.match(changes, /\d+ files changed, \d+ insertions/);
  } finally {
    cleanup();
  }
});

test('a dry run prints the same changes the deploy then makes', () => {
  const { marsh, sync, cleanup } = throwaway({ ...OLD_RADIO, 'public/images/radiogridxl/page/gone.webp': 'a shot no scene makes' });
  try {
    appendFileSync(join(marsh, PAGE_PATH), '\nA line for the release, not committed.\n');
    const dry = sync();
    assert.equal(dry.status, 0, dry.stderr);
    const run = sync('--deploy');
    assert.equal(run.status, 0, run.stderr);
    assert.equal(changesIn(dry.stdout), changesIn(run.stdout));
  } finally {
    cleanup();
  }
});

test('--deploy writes into marsh.city, commits only the synced paths and pushes', () => {
  const { marsh, site, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    appendFileSync(join(marsh, PAGE_PATH), '\nA line for the release, not committed.\n');
    writeFileSync(join(marsh, 'staged.md'), 'Staged, nothing to do with the radio.\n');
    git(marsh, 'add', 'staged.md');
    const run = sync('--deploy');
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /• Running npm test\n/);
    assert.match(git(marsh, 'log', '-1', '--format=%s'), new RegExp(`^radio: sync RadioGridXL v${APP_VERSION.replace(/\./g, '\\.')} \\([0-9a-f]{7,}\\)$`));
    const committed = git(marsh, 'show', '--name-only', '--format=', 'HEAD').split('\n');
    assert.ok(committed.includes('public/radio/index.html') && committed.includes(PAGE_PATH) && committed.includes('src/content/guides/radiogridxl.md'), committed.join(' '));
    assert.ok(!committed.includes('staged.md'), 'a file staged for something else stays out of the commit');
    assert.equal(git(marsh, 'status', '--porcelain'), 'A  staged.md', 'and stays staged');
    assert.equal(git(site, 'rev-parse', 'main'), git(marsh, 'rev-parse', 'HEAD'), 'pushed');
    assert.ok(git(marsh, 'show', 'HEAD:public/radio/index.html').includes(`RadioGrid v${APP_VERSION}<`));
    assert.ok(git(marsh, 'show', 'HEAD:public/radio/index.html').includes('http-equiv="Content-Security-Policy"'));
    // marsh.city/radio is the old address: it only ever gets the moved build.
    assert.ok(isMarkedMoved(git(marsh, 'show', 'HEAD:public/radio/index.html')), 'marsh.city gets the moved build');
  } finally {
    cleanup();
  }
});

test('a second --deploy with nothing new makes no commit', () => {
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    assert.equal(sync('--deploy').status, 0);
    const head = git(marsh, 'rev-parse', 'HEAD');
    const run = sync('--deploy');
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /already up to date/);
    assert.equal(git(marsh, 'rev-parse', 'HEAD'), head);
  } finally {
    cleanup();
  }
});

test('the old version shown is the one marsh.city has committed, not a copy left in its working tree', () => {
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    // A newer build sitting uncommitted in marsh.city (a deploy stopped
    // partway, a hand copy). The run must still say what it changes.
    writeFileSync(join(marsh, 'public', 'radio', 'index.html'), '<p id="settings-version">RadioGridXL v7.6.0</p>\n');
    writeFileSync(join(marsh, 'public', 'radio', 'sw.js'), "const CACHE_VERSION = 'rgxl-shell-7.6.0-0badf00d';\n");
    const run = sync();
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(`• Version: v7.5.0 → v${APP_VERSION}\n`), run.stdout);
    assert.match(run.stdout, /Cache: +rgxl-shell-7\.5\.0-0badcafe → rgxl-shell-\S+-[0-9a-f]{8}\n/);
  } finally {
    cleanup();
  }
});

test('on the first deploy, with no radio copy committed yet, the old version shows as none', () => {
  const { sync, cleanup } = throwaway({});
  try {
    const run = sync();
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(`• Version: none → v${APP_VERSION}\n`), run.stdout);
    assert.match(run.stdout, /Cache: +none → rgxl-shell-/);
  } finally {
    cleanup();
  }
});

test('with no upstream, a dry run warns in one line and still completes — unhappy path', () => {
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    git(marsh, 'branch', '--unset-upstream');
    const run = sync();
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /^⚠ marsh\.city's branch main has no upstream, .* branch --set-upstream-to=origin\/main$/m);
    assert.doesNotMatch(run.stderr, STACK_TRACE);
    assert.match(run.stdout, /Dry run complete/);
  } finally {
    cleanup();
  }
});

test('with no upstream, --deploy refuses in one plain line before it tests, commits or pushes — unhappy path', () => {
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    git(marsh, 'branch', '--unset-upstream');
    const head = git(marsh, 'rev-parse', 'HEAD');
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /^✗ Not deploying:\n {2}- marsh\.city's branch main has no upstream, .* branch --set-upstream-to=origin\/main$/m);
    assert.doesNotMatch(run.stderr, STACK_TRACE);
    assert.doesNotMatch(run.stdout, /Running npm test|Building/);
    // Refused before the build, so marsh.city is exactly as it was.
    assert.equal(git(marsh, 'rev-parse', 'HEAD'), head);
    assert.equal(git(marsh, 'status', '--porcelain'), '');
  } finally {
    cleanup();
  }
});

test('on a detached HEAD, --deploy refuses and says to switch to the branch — unhappy path', () => {
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    git(marsh, 'checkout', '--quiet', '--detach');
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /^ {2}- marsh\.city isn't on a branch, .* Switch to its branch and retry\.$/m);
    assert.doesNotMatch(run.stderr, STACK_TRACE);
  } finally {
    cleanup();
  }
});

test('with an upstream, marsh.city commits not yet pushed still stop --deploy, listed by name — unhappy path', () => {
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    writeFileSync(join(marsh, 'draft.md'), 'A post not ready yet.\n');
    git(marsh, 'add', 'draft.md');
    git(marsh, 'commit', '--quiet', '-m', 'draft: a post not ready yet');
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /commits not yet pushed, and the deploy's push would publish them:\n {6}\S+ draft: a post not ready yet/);
    assert.doesNotMatch(run.stderr, /no upstream/);
  } finally {
    cleanup();
  }
});

test('an uncommitted src/ edit stops --deploy and is listed by name — unhappy path', () => {
  const { rgxl, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    appendFileSync(join(rgxl, 'src', 'shell.html'), '<!-- not committed -->\n');
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /uncommitted changes the build would ship:\n +M src\/shell\.html/);
  } finally {
    cleanup();
  }
});

test('a project page with no Updates entry for a minor version stops --deploy, and a dry run says so — unhappy path', () => {
  const MINOR = APP_VERSION.replace(/\.\d+$/, '.0');
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO, { [PAGE_PATH]: currentPage('7.5.0') }, { version: MINOR });
  try {
    const dry = sync();
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(dry.stderr.includes(`⚠ the project page has no Updates entry for v${MINOR}.`), dry.stderr);
    const head = git(marsh, 'rev-parse', 'HEAD');
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.ok(run.stderr.includes(`  - the project page has no Updates entry for v${MINOR}. Add one to ${PAGE_PATH}`), run.stderr);
    assert.doesNotMatch(run.stderr, STACK_TRACE);
    assert.equal(git(marsh, 'rev-parse', 'HEAD'), head, 'nothing committed');
  } finally {
    cleanup();
  }
});

test('a patch release needs no Updates entry: the dry run raises no warning for it', () => {
  const PATCH = APP_VERSION.replace(/\.\d+$/, '.1');
  const { sync, cleanup } = throwaway(OLD_RADIO, { [PAGE_PATH]: currentPage('7.5.0') }, { version: PATCH });
  try {
    const dry = sync();
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!dry.stderr.includes('no Updates entry'), dry.stderr);
  } finally {
    cleanup();
  }
});

test('a project page showing a screenshot the capture doesn\'t make is named — unhappy path', () => {
  const page = currentPage() + '\n![Old](/images/radiogridxl/page/grid-mono.webp)\n';
  const { sync, cleanup } = throwaway(OLD_RADIO, { [PAGE_PATH]: page });
  try {
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /screenshots the capture doesn't make: grid-mono\./);
    assert.doesNotMatch(run.stderr, /grid[,.] /, 'a shot the capture makes is not listed');
  } finally {
    cleanup();
  }
});

const SHOWCASE_PATH = 'src/data/showcase.json';
const showcaseWith = (image) => JSON.stringify([{ collection: 'projects', id: 'radiogridxl', image }]);

test('a home-page card no release retakes stops --deploy — unhappy path', () => {
  const { sync, cleanup } = throwaway(OLD_RADIO, { [PAGE_PATH]: currentPage(), [SHOWCASE_PATH]: showcaseWith('/images/radiogridxl/grid-dark.webp') });
  try {
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /home page shows RadioGridXL as \/images\/radiogridxl\/grid-dark\.webp, which no release retakes/);
  } finally {
    cleanup();
  }
});

test('a showcase file that isn\'t a list is named, not a crash — unhappy path', () => {
  const { sync, cleanup } = throwaway(OLD_RADIO, { [PAGE_PATH]: currentPage(), [SHOWCASE_PATH]: '{}' });
  try {
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /showcase\.json in marsh\.city should be a list of cards/);
    assert.doesNotMatch(run.stderr, /TypeError/);
  } finally {
    cleanup();
  }
});

test('a home-page card on a shot the release retakes raises nothing', () => {
  const { sync, cleanup } = throwaway(OLD_RADIO, { [PAGE_PATH]: currentPage(), [SHOWCASE_PATH]: showcaseWith('/images/radiogridxl/page/grid.webp') });
  try {
    const dry = sync();
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!dry.stderr.includes('home page shows'), dry.stderr);
  } finally {
    cleanup();
  }
});

test('no project page at all stops --deploy instead of crashing — unhappy path', () => {
  const { sync, cleanup } = throwaway(OLD_RADIO, {});
  try {
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.ok(run.stderr.includes(`marsh.city has no project page at ${PAGE_PATH}`), run.stderr);
    assert.doesNotMatch(run.stderr, STACK_TRACE);
  } finally {
    cleanup();
  }
});

test('the deploy publishes the feedback page beside the app, byte for byte', () => {
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    const run = sync('--deploy');
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(marsh, 'public', 'radio', 'feedback', 'index.html'), 'utf-8'),
      readFileSync(join(repo, 'feedback', 'index.html'), 'utf-8'));
    assert.equal(git(marsh, 'status', '--porcelain'), '', 'committed with the rest');
  } finally {
    cleanup();
  }
});

test('PROMISES.md, a working file, is never published to marsh.city', () => {
  const { marsh, sync, cleanup } = throwaway(OLD_RADIO);
  try {
    const run = sync('--deploy');
    assert.equal(run.status, 0, run.stderr);
    const found = readdirSync(marsh, { recursive: true }).filter((p) => String(p).endsWith('PROMISES.md'));
    assert.deepEqual(found, []);
  } finally {
    cleanup();
  }
});

test('the deploy mirrors the page and guide shots, and drops site images no scene makes (old .jpg shots too)', () => {
  const { marsh, sync, cleanup } = throwaway({
    ...OLD_RADIO,
    'public/images/radiogridxl/guide/one.jpg': 'the shot before it was webp',
    'public/images/radiogridxl/page/gone.webp': 'a shot no scene makes',
  });
  try {
    const run = sync('--deploy');
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stderr, /project page/, 'an up-to-date page raises nothing');
    const ls = (d) => readdirSync(join(marsh, d)).sort();
    assert.deepEqual(ls('public/images/radiogridxl/guide'), ['one.webp']);
    assert.deepEqual(ls('public/images/radiogridxl/page'), ['grid.webp']);
  } finally {
    cleanup();
  }
});

test('with no page screenshots captured, --deploy refuses rather than emptying the site\'s — unhappy path', () => {
  const { marsh, sync, cleanup } = throwaway({ ...OLD_RADIO, 'public/images/radiogridxl/page/grid.webp': 'live shot' });
  try {
    const rgxl = join(marsh, '..', 'RadioGridXL');
    git(rgxl, 'rm', '--quiet', 'guide/page/grid.webp');
    git(rgxl, 'commit', '--quiet', '-m', 'no page shots');
    const run = sync('--deploy');
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /guide\/page\/ has no screenshots/);
    assert.doesNotMatch(run.stderr, STACK_TRACE);
    assert.ok(readdirSync(join(marsh, 'public/images/radiogridxl/page')).includes('grid.webp'), 'the site keeps its shot');
  } finally {
    cleanup();
  }
});
