/**
 * Publish the hosted RadioGrid to radio.marshworks.dev (a Netlify site).
 *
 *   npm run deploy:netlify
 *
 * One deliberate command, never CI: Netlify tokens reach the whole Netlify
 * account and this repo is public, so the token stays in this Mac's Keychain
 * and no workflow holds one. Pushing main publishes nothing.
 *
 * In order, and nothing is uploaded unless every step passes:
 *  1. No uncommitted changes to anything the build reads (SHIPPED_INPUTS).
 *  2. The Keychain item exists (checked before the slow test run).
 *  3. npm test.
 *  4. Build the default profile and gather the hosted files (hosted-build.mjs).
 *  5. The build's own addresses are radio.marshworks.dev: the feedback QR,
 *     the address printed beside it, and no moved screen. A build made for
 *     marsh.city/radio can't land here.
 *  6. Zip the files and upload them as one deploy through Netlify's API, then
 *     wait until Netlify says it's live.
 *
 * The token is read with `security find-generic-password -w` (stdout, never
 * an argument), sent only in the Authorization header to api.netlify.com,
 * and never printed, not even in an error.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { hostedFiles, isMarkedMoved, SHIPPED_INPUTS, FEEDBACK_PAGE, ASSETLINKS_PATH } from './hosted-build.mjs'
import { feedbackQrSvg, FEEDBACK_URL } from './make-feedback-qr.mjs'

export const HOST = 'radio.marshworks.dev'
// Netlify's API takes a site's domain in place of its id.
export const NETLIFY_SITE = HOST
// The account's personal access token, the same one marshworks.dev deploys
// with. Netlify has no per-site tokens, so a second one would reach no less.
export const KEYCHAIN_SERVICE = 'netlify-site-marshworks.dev'
const API = 'https://api.netlify.com/api/v1'
// Per request, so a hung connection fails the deploy instead of stalling it.
const UPLOAD_TIMEOUT_MS = 60_000
const POLL_TIMEOUT_MS = 15_000

/** Plain-language reasons the files aren't a build for HOST; empty when they are. */
export function addressProblems(files) {
  const problems = []
  const byName = new Map(files.map((f) => [f.name, f.data]))
  const html = String(byName.get('index.html') ?? '')
  if (!html) return ['the build has no index.html.']
  if (new URL(FEEDBACK_URL).host !== HOST) problems.push(`the feedback address is ${FEEDBACK_URL}, not on ${HOST}. Change FEEDBACK_URL in make-feedback-qr.mjs and rerun it.`)
  else if (!html.includes(feedbackQrSvg())) problems.push(`the feedback QR in the build doesn't open ${FEEDBACK_URL}. Run node make-feedback-qr.mjs.`)
  const printed = html.match(/id="feedback-page-address">([^<]*(?:<wbr>[^<]*)*)</)?.[1]?.replaceAll('<wbr>', '')
  if (printed && printed !== `${HOST}/feedback`) problems.push(`settings prints the feedback address as ${printed}, not ${HOST}/feedback.`)
  if (isMarkedMoved(html)) problems.push('this is the moved build made for marsh.city/radio, which must never be served here.')
  if (!byName.has(FEEDBACK_PAGE)) problems.push(`the build has no ${FEEDBACK_PAGE}, so the QR would open a missing page.`)
  problems.push(...assetlinksProblems(byName.get(ASSETLINKS_PATH)))
  return problems
}

// The Android app's package (twa/twa-manifest.json; it can never change).
export const ANDROID_PACKAGE = 'dev.marshworks.radiogrid'
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

/** What's wrong with the assetlinks.json a deploy would serve. Without a
    good one the Android app still opens, but in Chrome with a URL bar. */
export function assetlinksProblems(data) {
  if (data === undefined) return [`the build has no ${ASSETLINKS_PATH}, so the Android app would open with a URL bar.`]
  let statements
  try { statements = JSON.parse(String(data)) } catch { return [`${ASSETLINKS_PATH} isn't valid JSON.`] }
  const ours = Array.isArray(statements) && statements.find((s) => s?.target?.package_name === ANDROID_PACKAGE)
  if (!ours) return [`${ASSETLINKS_PATH} doesn't name ${ANDROID_PACKAGE}.`]
  const problems = []
  if (!ours.relation?.includes('delegate_permission/common.handle_all_urls')) problems.push(`${ASSETLINKS_PATH} doesn't grant handle_all_urls.`)
  const prints = ours.target.sha256_cert_fingerprints
  if (!Array.isArray(prints) || !prints.length) problems.push(`${ASSETLINKS_PATH} lists no signing fingerprint.`)
  else if (!prints.every((p) => FINGERPRINT.test(p))) problems.push(`${ASSETLINKS_PATH} has a fingerprint that isn't 32 colon-separated hex bytes.`)
  return problems
}

/** Names of the files whose bytes contain the token: the last check before
    anything is uploaded, so a secret can never be published as site content. */
export function filesHoldingToken(files, token) {
  const needle = Buffer.from(token)
  return files.filter((f) => Buffer.from(f.data).includes(needle)).map((f) => f.name)
}

/** The token from the Keychain. `exec` is execFileSync, swapped in tests. */
export function readToken(exec = execFileSync) {
  let out
  try {
    out = exec('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    // security's own message can echo the query; this one says what to do.
    throw new Error(`no Keychain item "${KEYCHAIN_SERVICE}" on this Mac, so there's no Netlify token to deploy with. Add it with: security add-generic-password -s ${KEYCHAIN_SERVICE} -a netlify -w`)
  }
  const token = String(out).trim()
  if (!token) throw new Error(`the Keychain item "${KEYCHAIN_SERVICE}" is empty.`)
  return token
}

/** Upload `zip` as a new production deploy and wait for it to go live.
    `fetchFn` and `wait` are swapped in tests. Returns the deploy. */
export async function uploadDeploy(zip, token, { fetchFn = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  const auth = { Authorization: `Bearer ${token}` }
  const res = await fetchFn(`${API}/sites/${encodeURIComponent(NETLIFY_SITE)}/deploys`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: zip,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Netlify refused the upload: HTTP ${res.status}${res.status === 401 ? ' (the Keychain token is wrong or expired)' : res.status === 404 ? ` (no site ${NETLIFY_SITE} on this account)` : ''}.`)
  let deploy = await res.json()
  log(`• Uploaded deploy ${deploy.id}; waiting for Netlify to publish it`)
  for (let i = 0; i < 60 && deploy.state !== 'ready'; i++) {
    if (deploy.state === 'error') throw new Error(`Netlify failed the deploy: ${deploy.error_message || 'no reason given'}.`)
    await wait(2000)
    const poll = await fetchFn(`${API}/deploys/${encodeURIComponent(deploy.id)}`, { headers: auth, signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
    if (!poll.ok) throw new Error(`couldn't check the deploy: HTTP ${poll.status}.`)
    deploy = await poll.json()
  }
  if (deploy.state !== 'ready') throw new Error(`the deploy was still "${deploy.state}" after 2 minutes; check it on Netlify.`)
  return deploy
}

/** The files as one zip, built with the system zip in a throwaway folder. */
function zipFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-netlify-'))
  try {
    const site = join(dir, 'site')
    for (const { name, data } of files) {
      mkdirSync(dirname(join(site, name)), { recursive: true })
      writeFileSync(join(site, name), data)
    }
    execFileSync('zip', ['-q', '-r', '-X', join(dir, 'site.zip'), '.'], { cwd: site })
    return readFileSync(join(dir, 'site.zip'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const repo = dirname(fileURLToPath(import.meta.url))
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...SHIPPED_INPUTS, 'deploy-radio-to-netlify.mjs', 'make-feedback-qr.mjs'], { cwd: repo, encoding: 'utf8' }).trimEnd()
  if (dirty) throw new Error(`uncommitted changes the build would ship:\n${dirty}`)
  const token = readToken()

  console.log('• Running npm test')
  execFileSync('npm', ['test'], { cwd: repo, stdio: 'inherit' })
  console.log('• Building default profile → dist/RadioGridXL.html')
  execFileSync('node', ['build-profile.mjs', 'default'], { cwd: repo, stdio: 'inherit' })

  const files = await hostedFiles(repo)
  const problems = addressProblems(files)
  if (problems.length) throw new Error(`this build isn't for ${HOST}:\n${problems.map((p) => `  - ${p}`).join('\n')}`)

  const leaks = filesHoldingToken(files, token)
  if (leaks.length) throw new Error(`the Netlify token's text is inside ${leaks.join(', ')}; nothing was uploaded. Rotate the token on Netlify.`)

  const deploy = await uploadDeploy(zipFiles(files), token)
  console.log(`\n✓ Live at https://${HOST}/ (deploy ${deploy.id})`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`✗ Not deployed: ${err.message}`)
    process.exit(1)
  })
}
