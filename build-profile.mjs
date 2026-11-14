#!/usr/bin/env node

/**
 * build-profile.mjs — Patches RadioGridXL.html with a profile.
 *
 * Usage:
 *   node build-profile.mjs [profile-name | path/to/profile.json]
 *
 * Examples:
 *   node build-profile.mjs                       → patches with profiles/default.json
 *   node build-profile.mjs ~/private/acme.json   → patches with a profile kept outside the repo
 *
 * Only the default profile ships in the repo; an organisation's own profile
 * (its PIN, stations, name) stays wherever that organisation keeps it.
 *
 * Output: dist/RadioGridXL.html (ready for APK build or manual deployment)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const profileArg = process.argv[2] || 'default'
// A name means profiles/<name>.json; anything ending in .json is a path.
const profilePath = profileArg.endsWith('.json') ? resolve(profileArg) : join(__dirname, 'profiles', `${profileArg}.json`)
const profileName = basename(profilePath, '.json')
const htmlPath = join(__dirname, 'RadioGridXL.html')
const distDir = join(__dirname, 'dist')
const outPath = join(distDir, 'RadioGridXL.html')

const START_MARKER = '/* === PROFILE CONFIG — build-profile.mjs replaces this block === */'
const END_MARKER = '/* === END PROFILE CONFIG === */'

const PROFILE_KEYS = ['orgName', 'pin', 'logoSvg', 'logoViewBox', 'helpUrl', 'feedback', 'madeBy', 'orientation', 'streams']
const STREAM_KEYS = ['id', 'label', 'sub', 'url', 'emoji', 'color', 'gain']
const ORIENTATIONS = ['auto', 'landscape-cw', 'landscape-ccw']

/** The station colour ids in the app's PALETTE, read from the HTML so the
    list lives in one place. */
export function paletteIdsFrom(html) {
  const block = html.slice(html.indexOf('const PALETTE = ['), html.indexOf('];', html.indexOf('const PALETTE = [')))
  return [...block.matchAll(/\{ id: '([a-z]+)'/g)].map(m => m[1])
}

/**
 * Every problem with a profile, as plain sentences; empty when it's fine.
 * The app trusts PROFILE: the PIN becomes the device default and the streams
 * skip validateConfig(). So a typo here ships to every device on that build:
 * a numeric or 5-digit PIN can never be typed on the 4-digit pad, which locks
 * everyone out of settings.
 */
export function validateProfile(profile, paletteIds) {
  const problems = []
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return ['the profile is not a JSON object']
  for (const k of Object.keys(profile)) if (!PROFILE_KEYS.includes(k)) problems.push(`unknown key "${k}" (a typo? known keys: ${PROFILE_KEYS.join(', ')})`)

  if (typeof profile.orgName !== 'string' || !profile.orgName.trim()) problems.push('orgName must be a non-empty string')
  if (typeof profile.pin !== 'string' || !/^(\d{4})?$/.test(profile.pin)) problems.push('pin must be a string of exactly 4 digits, or "" for no PIN')
  if (profile.orientation !== undefined && !ORIENTATIONS.includes(profile.orientation)) problems.push(`orientation must be one of ${ORIENTATIONS.join(', ')}`)
  if (profile.helpUrl !== undefined && (typeof profile.helpUrl !== 'string' || !/^https:\/\//.test(profile.helpUrl))) problems.push('helpUrl must be an https:// URL')
  if (profile.feedback !== undefined && typeof profile.feedback !== 'boolean') problems.push('feedback must be true or false')
  if (profile.madeBy !== undefined && (typeof profile.madeBy !== 'string' || !profile.madeBy.trim())) problems.push('madeBy must be a non-empty string (leave it out for no credit line)')
  for (const k of ['logoSvg', 'logoViewBox']) if (profile[k] !== undefined && typeof profile[k] !== 'string') problems.push(`${k} must be a string`)

  const streams = profile.streams
  if (!Array.isArray(streams) || streams.length < 1 || streams.length > 8) {
    problems.push('streams must be a list of 1 to 8 stations')
  } else {
    const ids = new Set()
    streams.forEach((s, i) => {
      const at = `streams[${i}]`
      if (!s || typeof s !== 'object') { problems.push(`${at} is not an object`); return }
      for (const k of Object.keys(s)) if (!STREAM_KEYS.includes(k)) problems.push(`${at}: unknown key "${k}"`)
      if (typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.id)) problems.push(`${at}: id must be 1-64 letters, digits, - or _`)
      else if (ids.has(s.id)) problems.push(`${at}: id "${s.id}" is used twice`)
      else ids.add(s.id)
      if (typeof s.label !== 'string' || !s.label.trim()) problems.push(`${at}: label must be a non-empty string`)
      if (typeof s.url !== 'string' || !/^https?:\/\/\S+$/i.test(s.url)) problems.push(`${at}: url must be an http(s):// address`)
      for (const k of ['sub', 'emoji']) if (s[k] !== undefined && typeof s[k] !== 'string') problems.push(`${at}: ${k} must be a string`)
      if (s.color !== undefined && !paletteIds.includes(s.color)) problems.push(`${at}: color must be one of ${paletteIds.join(', ')}`)
      if (s.gain !== undefined && !(typeof s.gain === 'number' && s.gain >= 0.1 && s.gain <= 4)) problems.push(`${at}: gain must be a number from 0.1 to 4`)
    })
  }

  // The profile is spliced into the page's one inline <script>, where either
  // of these would end or derail it.
  const strings = JSON.stringify(profile)
  if (/<\/script/i.test(strings)) problems.push('a value contains "</script", which would end the app\'s script early')
  if (/<!--/.test(strings)) problems.push('a value contains "<!--", which changes how the browser reads the app\'s script')
  return problems
}

async function main() {
  // Load profile
  let profileJson
  try {
    profileJson = await readFile(profilePath, 'utf8')
  } catch (e) {
    console.error(`Profile not found: ${profilePath}`)
    console.error(`Available profiles:`)
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(join(__dirname, 'profiles'))
    for (const f of files) {
      if (f.endsWith('.json')) console.error(`  - ${f.replace('.json', '')}`)
    }
    process.exit(1)
  }

  const profile = JSON.parse(profileJson)

  // Load HTML
  const html = await readFile(htmlPath, 'utf8')

  const problems = validateProfile(profile, paletteIdsFrom(html))
  if (problems.length) {
    console.error(`✗ ${profilePath} has problems, so nothing was built:`)
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }

  // Find the profile block
  const startIdx = html.indexOf(START_MARKER)
  const endIdx = html.indexOf(END_MARKER)

  if (startIdx === -1 || endIdx === -1) {
    console.error('Could not find PROFILE CONFIG markers in RadioGridXL.html')
    process.exit(1)
  }

  // Build replacement block
  const profileBlock = `${START_MARKER}
const PROFILE = ${JSON.stringify(profile, null, 2)};
${END_MARKER}`

  // Splice it in
  const patched = html.slice(0, startIdx) + profileBlock + html.slice(endIdx + END_MARKER.length)

  // Write to dist/
  await mkdir(distDir, { recursive: true })
  await writeFile(outPath, patched, 'utf8')

  console.log(`Built dist/RadioGridXL.html with profile "${profileName}"`)
}

// Build only when run as a script (Gradle, the sync, by hand); tests import
// validateProfile without building. realpath, not resolve: Node gives
// import.meta.url the real path, so a script run through a symlinked path
// would otherwise skip the build and exit 0, leaving a stale dist/.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main()
