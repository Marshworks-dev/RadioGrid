/**
 * Sync the hosted RadioGridXL PWA into the marsh.city GitHub Pages repo.
 *
 * marsh.city/radio is a *copy* of this app's hosted build living in a separate
 * Astro/Pages repo (public/radio/). Pushing THIS repo does not update it — the
 * copy silently drifts (that's how v7.5.1's off-center icon stayed live after
 * the fix shipped here). This script is the single source of truth for that
 * copy: rebuild the default profile, then write the six hosted files across, plus the feedback page.
 * The hosted copy gets two extras on top of the build (hosted-build.mjs): a
 * CSP meta tag, and a content hash in sw.js's cache name so any change to the
 * shell reaches installed apps.
 * It also carries the how-to guide (guide/guide.md + guide/shots/) into the
 * site's `guides` collection, so the guide ships with the build it describes,
 * and the project page's screenshots (guide/page/). The project page's words
 * are written by hand in marsh.city, so it checks them instead: the page must
 * have an Updates entry for a minor or major version going out (patches
 * don't need one), and every screenshot it
 * shows must still be one the capture makes. The deploy commit carries the
 * page with the rest.
 *
 * Usage:
 *   node sync-radio-to-marshcity.mjs            # dry run: build into a temporary copy, show the diff
 *   node sync-radio-to-marshcity.mjs --deploy   # write into marsh.city, commit + push (triggers Pages deploy)
 *
 * The dry run changes nothing in marsh.city: it copies the synced paths to a
 * temporary folder, syncs into that, and has git compare the copy with what
 * marsh.city has committed. Only --deploy writes into marsh.city.
 *
 * --deploy refuses (a dry run warns) when the push would ship something
 * nobody reviewed: uncommitted changes here to anything the build reads,
 * failing tests, or marsh.city commits not yet pushed (or no upstream to
 * check for them); or when the project page has fallen behind the app.
 *
 * The marsh.city repo path defaults to a sibling of this repo; override with
 * MARSHCITY_REPO=/abs/path if your layout differs.
 */
import { execFileSync } from 'node:child_process'
import { copyFile, access, readFile, writeFile, readdir, mkdir, rm, cp, mkdtemp } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { injectCsp, stampCacheVersion, cacheVersionOf, appVersionOf, releaseNeedsUpdatesEntry } from './hosted-build.mjs'
import { readFileSync, readdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repo = __dirname
const marshRepo = process.env.MARSHCITY_REPO || join(repo, '..', 'marsh.city')
const radioDir = join(marshRepo, 'public', 'radio')
const deploy = process.argv.includes('--deploy')

// The guide: markdown into the site's content collection, screenshots into
// public/. Paths are relative to the marsh.city root (also the commit pathspec).
const GUIDE_MD = 'src/content/guides/radiogridxl.md'
const GUIDE_SHOTS = 'public/images/radiogridxl/guide'
const SHOTS_URL = '/images/radiogridxl/guide/'
// The project page, and the screenshots it shows (guide/page/ here).
const PROJECT_PAGE = 'src/content/projects/radiogridxl.md'
const PAGE_SHOTS = 'public/images/radiogridxl/page'
const PAGE_SHOTS_URL = /\/images\/radiogridxl\/page\/([a-z0-9-]+)\.webp/g
// The home page's featured projects, each with its card image.
const SHOWCASE = 'src/data/showcase.json'
const SYNCED_PATHS = ['public/radio', GUIDE_MD, GUIDE_SHOTS, PAGE_SHOTS, PROJECT_PAGE]

// Shell files mirrored by name. The built HTML lands at index.html and sw.js
// is written last, stamped with a hash of all the others.
const SHELL_FILES = ['manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png']

// The feedback page the settings QR opens: its own static page beside the
// app, never part of the cached shell (sw.js passes it through).
const FEEDBACK_PAGE = 'feedback/index.html'

// Everything in this repo the hosted copy is built from.
// src/ and build.mjs make RadioGridXL.html; npm test would catch a src/ edit
// that was never rebuilt, but this names the files instead.
const SHIPPED_INPUTS = ['RadioGridXL.html', 'src', 'build.mjs', 'profiles', 'sw.js', ...SHELL_FILES, 'feedback', 'guide', 'build-profile.mjs', 'hosted-build.mjs']

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
// maxBuffer: `git show` returns the whole built index.html, and the 1 MiB default would throw past that
const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd()  // keep porcelain's leading status column
const indent = (text) => text.split('\n').map(l => `      ${l}`).join('\n')

async function main() {
  // Fail loud if the Pages repo isn't where we expect — never half-sync.
  try {
    await access(radioDir)
  } catch {
    console.error(`✗ marsh.city radio dir not found: ${radioDir}`)
    console.error(`  Set MARSHCITY_REPO to the marsh.city repo root and retry.`)
    process.exit(1)
  }

  checkPreconditions()

  const before = committedVersions()

  console.log('• Building default profile → dist/RadioGridXL.html')
  run('node', ['build-profile.mjs', 'default'], repo)

  // Where the sync writes: marsh.city itself for a deploy, a temporary copy
  // of its synced paths for a dry run.
  const stage = deploy ? null : await stageMarshCity()
  try {
    await syncInto(stage ? stage.tree : marshRepo, before, stage)
  } finally {
    if (stage) await rm(stage.dir, { recursive: true, force: true })
  }
}

/** Sync into `root` and show what changed; on --deploy, commit and push it. */
async function syncInto(root, before, stage) {
  console.log(`• Writing the hosted shell → ${stage ? 'a temporary copy of marsh.city' : radioDir}`)
  await writeHostedShell(root)

  console.log('• Copying the how-to guide + screenshots')
  await syncGuide(root)
  console.log('• Copying the project-page screenshots')
  await mirrorShots(join(repo, 'guide', 'page'), join(root, PAGE_SHOTS))

  const after = await hostedVersions(root)
  // "none" when marsh.city has no radio copy committed yet (the first deploy).
  console.log(`\n• Version: ${before.app ? `v${before.app}` : 'none'} → v${after.app}`)
  console.log(`  Cache:   ${before.cache || 'none'} → ${after.cache}`)

  // A direct edit in marsh.city (anything but a sync) is about to be replaced.
  const last = git(['log', '-1', '--format=%h %s', '--', 'public/radio'], marshRepo)
  if (last && !/^\S+ radio: sync /.test(last)) {
    console.warn(`⚠ public/radio was last changed outside this script (${last}); this sync replaces that change.`)
  }

  console.log('\n• Changes in marsh.city (radio, guide, project page):')
  showChanges(root, stage)

  if (!deploy) {
    console.log('\nDry run complete. Review above, then run `npm run deploy:radio`')
    console.log('to commit + push (it re-runs these checks and the tests first).')
    return
  }

  run('git', ['-C', marshRepo, 'add', '--', ...SYNCED_PATHS], marshRepo)

  // Nothing changed in the synced paths → don't make an empty commit (or fail
  // on one). Pathspec-scoped so unrelated staged work in marsh.city is ignored.
  try {
    execFileSync('git', ['-C', marshRepo, 'diff', '--cached', '--quiet', '--', ...SYNCED_PATHS])
    console.log('\n✓ radio, guide and project page already up to date — nothing to commit or push.')
    return
  } catch (err) {
    if (err.status !== 1) throw err  // 1 = differences; anything else is a real error
  }

  console.log('\n• Committing + pushing (triggers GitHub Pages deploy)')
  // Commit only the synced paths, never whatever else happens to be staged
  // there. The message ties the live build to its RadioGridXL commit.
  const message = `radio: sync RadioGridXL v${after.app} (${git(['rev-parse', '--short', 'HEAD'], repo)})`
  run('git', ['-C', marshRepo, 'commit', '-m', message, '--', ...SYNCED_PATHS], marshRepo)
  run('git', ['-C', marshRepo, 'push'], marshRepo)
  console.log('\n✓ Pushed. Pages Action will build + deploy in ~1 min.')
}

/**
 * The runbook's preconditions, enforced: --deploy stops on any of them, a dry
 * run only warns. The build reads the working tree, so uncommitted changes
 * would go live untested; and the push is a plain `git push`, so marsh.city
 * commits waiting to go out (batched posts, drafts) would go with it. With no
 * upstream there's nothing to check those commits against, so that counts too.
 */
function checkPreconditions() {
  const problems = projectPageProblems()
  const dirty = git(['status', '--porcelain', '--', ...SHIPPED_INPUTS], repo)
  if (dirty) problems.push(`RadioGridXL has uncommitted changes the build would ship:\n${indent(dirty)}`)
  if (hasUpstream()) {
    const ahead = git(['log', '--oneline', '@{u}..HEAD'], marshRepo)
    if (ahead) problems.push(`marsh.city has commits not yet pushed, and the deploy's push would publish them:\n${indent(ahead)}`)
  } else {
    const branch = git(['branch', '--show-current'], marshRepo)  // empty on a detached HEAD
    problems.push(branch
      ? `marsh.city's branch ${branch} has no upstream, so the deploy can't check what its push would publish. Set one with: git -C ${marshRepo} branch --set-upstream-to=origin/${branch}`
      : `marsh.city isn't on a branch, so the deploy can't check what its push would publish. Switch to its branch and retry.`)
  }

  if (deploy && problems.length) {
    console.error('✗ Not deploying:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  for (const p of problems) console.warn(`⚠ ${p}`)

  if (deploy) {
    console.log('• Running npm test')
    run('npm', ['test'], repo)
  }
}

/**
 * What's out of date on the project page, which nothing else keeps current:
 * no Updates entry naming the minor or major version about to go live, or a
 * screenshot the capture no longer makes (or hasn't made yet), on the page or
 * on the home page's RadioGridXL card. Read from
 * marsh.city's working tree, since the deploy commit carries the page.
 */
function projectPageProblems() {
  const version = appVersionOf(readFileSync(join(repo, 'RadioGridXL.html'), 'utf8'))
  let page
  try {
    page = readFileSync(join(marshRepo, PROJECT_PAGE), 'utf8')
  } catch {
    return [`marsh.city has no project page at ${PROJECT_PAGE}, so nothing describes v${version}.`]
  }
  const problems = []
  const updates = page.split(/^## Updates\s*$/m)[1] || ''
  if (releaseNeedsUpdatesEntry(version) && !updates.includes(`v${version}`)) {
    problems.push(`the project page has no Updates entry for v${version}. Add one to ${PROJECT_PAGE} (the deploy commit carries it).`)
  }
  const captured = new Set(webpShots(join(repo, 'guide', 'page')).map(f => f.slice(0, -5)))
  if (!captured.size) {
    problems.push('guide/page/ has no screenshots, and syncing it would empty the site\'s. Run npm run guide:capture.')
    return problems
  }
  const missing = [...new Set([...page.matchAll(PAGE_SHOTS_URL)].map(m => m[1]))].filter(id => !captured.has(id))
  if (missing.length) {
    problems.push(`the project page shows screenshots the capture doesn't make: ${missing.join(', ')}. Add them to PAGE_SHOTS in guide/scenes.mjs, or take them off the page.`)
  }
  const showcase = showcaseImage()
  if (showcase && !captured.has(showcase.match(/^\/images\/radiogridxl\/page\/([a-z0-9-]+)\.webp$/)?.[1])) {
    problems.push(`the marsh.city home page shows RadioGridXL as ${showcase}, which no release retakes. Point its entry in ${SHOWCASE} at a shot in /images/radiogridxl/page/.`)
  }
  return problems
}

/** The image marsh.city's home page shows for RadioGridXL, or null when the
    home page doesn't feature it. */
function showcaseImage() {
  let entries
  try {
    entries = JSON.parse(readFileSync(join(marshRepo, SHOWCASE), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error(`${SHOWCASE} in marsh.city isn't readable JSON: ${error.message}`)
  }
  if (!Array.isArray(entries)) throw new Error(`${SHOWCASE} in marsh.city should be a list of cards.`)
  return entries.find(e => e?.collection === 'projects' && e.id === 'radiogridxl')?.image ?? null
}

/** Whether marsh.city's branch has an upstream to compare against. With
    --quiet, rev-parse exits 1 and prints nothing when @{u} doesn't resolve
    (no upstream set, its remote branch gone, or a detached HEAD); any other
    failure is a real error. */
function hasUpstream() {
  try {
    git(['rev-parse', '--verify', '--quiet', '@{u}'], marshRepo)
    return true
  } catch (err) {
    if (err.status !== 1) throw err
    return false
  }
}

/**
 * A temporary folder for a dry run: `tree` holds a copy of marsh.city's
 * synced paths as they are in its working tree (uncommitted edits to the
 * project page included), and `index` a copy of its git index. The root
 * .gitignore comes too, so git ignores the same files in the copy.
 */
async function stageMarshCity() {
  const dir = await mkdtemp(join(tmpdir(), 'rgxl-sync-dry-'))
  const tree = join(dir, 'tree')
  const copyIfThere = async (from, to) => {
    try {
      await mkdir(dirname(to), { recursive: true })
      await cp(from, to, { recursive: true })
    } catch (err) {
      if (err.code !== 'ENOENT') throw err  // not in marsh.city yet (a first deploy)
    }
  }
  for (const p of [...SYNCED_PATHS, '.gitignore']) await copyIfThere(join(marshRepo, p), join(tree, p))
  const gitDir = git(['rev-parse', '--absolute-git-dir'], marshRepo)
  await copyIfThere(join(gitDir, 'index'), join(dir, 'index'))
  return { dir, tree, index: join(dir, 'index'), gitDir }
}

/**
 * Print the changed files and the diff summary for the synced paths. On a dry
 * run git reads marsh.city's history but looks at the temporary copy, through
 * the copied index, so it writes nothing into marsh.city (a plain `git
 * status` there rewrites .git/index). fsmonitor and the untracked cache
 * describe marsh.city's own working tree, so they're off for the copy.
 */
function showChanges(root, stage) {
  const env = stage
    ? { ...process.env, GIT_DIR: stage.gitDir, GIT_WORK_TREE: stage.tree, GIT_INDEX_FILE: stage.index }
    : process.env
  const config = stage ? ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'] : []
  for (const args of [['status', '--short'], ['diff', '--stat']]) {
    execFileSync('git', [...config, ...args, '--', ...SYNCED_PATHS], { cwd: root, env, stdio: 'inherit' })
  }
}

/** Write the hosted shell into `root` (marsh.city, or a dry run's copy): the
    build as index.html with the CSP, the static files, then sw.js stamped
    with a hash of all of them. */
async function writeHostedShell(root) {
  const radioDir = join(root, 'public', 'radio')
  const shell = [{ name: 'index.html', data: injectCsp(await readFile(join(repo, 'dist', 'RadioGridXL.html'), 'utf8')) }]
  for (const name of SHELL_FILES) shell.push({ name, data: await readFile(join(repo, name)) })
  for (const { name, data } of shell) await writeFile(join(radioDir, name), data)
  await mkdir(dirname(join(radioDir, FEEDBACK_PAGE)), { recursive: true })
  await copyFile(join(repo, FEEDBACK_PAGE), join(radioDir, FEEDBACK_PAGE))
  const sw = stampCacheVersion(await readFile(join(repo, 'sw.js'), 'utf8'), shell)
  await writeFile(join(radioDir, 'sw.js'), sw)
}

/** The app version and cache name marsh.city has committed: what the last
    deploy shipped. Not the working tree, which can hold a copy nobody
    committed. A file not committed yet (the first deploy) gives null. */
function committedVersions() {
  const committed = git(['ls-tree', '--name-only', 'HEAD', '--', 'public/radio/index.html', 'public/radio/sw.js'], marshRepo).split('\n')
  const show = (f) => committed.includes(`public/radio/${f}`) ? git(['show', `HEAD:public/radio/${f}`], marshRepo) : ''
  return { app: appVersionOf(show('index.html')), cache: cacheVersionOf(show('sw.js')) }
}

/** The app version and cache name under `root`: what this sync just wrote. */
async function hostedVersions(root) {
  const read = async (f) => { try { return await readFile(join(root, 'public', 'radio', f), 'utf8') } catch { return '' } }
  return { app: appVersionOf(await read('index.html')), cache: cacheVersionOf(await read('sw.js')) }
}

/**
 * Mirror the guide: rewrite its relative screenshot links to the site's image
 * path, then mirror its shots.
 */
async function syncGuide(root) {
  const md = await readFile(join(repo, 'guide', 'guide.md'), 'utf8')
  await mkdir(dirname(join(root, GUIDE_MD)), { recursive: true })
  await writeFile(join(root, GUIDE_MD), md.replaceAll('](shots/', `](${SHOTS_URL}`))

  await mirrorShots(join(repo, 'guide', 'shots'), join(root, GUIDE_SHOTS))
}

/** The webp shots in `dir`, none if it doesn't exist. */
function webpShots(dir) {
  try {
    return readdirSync(dir).filter(f => f.endsWith('.webp'))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

/** Copy every webp shot across, and delete images on the site that no scene
    makes any more, including the .jpg shots were before they were webp.
    Refuses an empty source: that would delete every image on the site. */
async function mirrorShots(src, dest) {
  const shots = webpShots(src)
  if (!shots.length) throw new Error(`no screenshots in ${src}; run npm run guide:capture`)
  await mkdir(dest, { recursive: true })
  for (const f of shots) await copyFile(join(src, f), join(dest, f))
  for (const f of await readdir(dest)) {
    if (/\.(jpg|webp)$/.test(f) && !shots.includes(f)) await rm(join(dest, f))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
