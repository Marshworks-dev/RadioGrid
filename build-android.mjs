/**
 * Builds the signed Android app (twa/): a release APK to sideload onto a
 * tablet and an AAB for Play.
 *
 *   npm run build:android        (sandbox off: Keychain, Gradle, the SDK)
 *
 * The upload key stays outside the repo (~/.android-keys/radiogrid-upload.jks,
 * or RADIOGRID_KEYSTORE). Its password comes from the macOS Keychain item
 * `radiogrid-upload-keystore` and reaches Bubblewrap only through its
 * environment, never argv, a file or the log. The build refuses to run when
 * the key's fingerprint isn't in twa/assetlinks.json: an app signed by a key
 * the site doesn't vouch for opens with a URL bar.
 *
 * Bubblewrap (GoogleChromeLabs) is run by exact version through npx and
 * isn't a dependency of the repo: it only generates and builds twa/.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ASSETLINKS } from './hosted-build.mjs'

export const BUBBLEWRAP = '@bubblewrap/cli@1.27.0'
export const KEYCHAIN_SERVICE = 'radiogrid-upload-keystore'
export const KEY_ALIAS = 'upload'
const KEYSTORE = process.env.RADIOGRID_KEYSTORE || join(homedir(), '.android-keys', 'radiogrid-upload.jks')

/** The SHA-256 fingerprint from `keytool -list -v` output, or null. */
export function fingerprintFrom(keytoolOutput) {
  return keytoolOutput.match(/SHA256:\s*((?:[0-9A-F]{2}:){31}[0-9A-F]{2})/)?.[1] ?? null
}

/** Whether assetlinks.json vouches for this fingerprint. */
export function fingerprintListed(assetlinksText, fingerprint) {
  const statements = JSON.parse(assetlinksText)
  return statements.some((s) => s?.target?.sha256_cert_fingerprints?.includes(fingerprint))
}

function keytool() {
  const config = JSON.parse(readFileSync(join(homedir(), '.bubblewrap', 'config.json'), 'utf8'))
  // On macOS Bubblewrap's jdkPath is the .jdk bundle; the tools sit in Contents/Home.
  const macTool = join(config.jdkPath, 'Contents', 'Home', 'bin', 'keytool')
  return existsSync(macTool) ? macTool : join(config.jdkPath, 'bin', 'keytool')
}

function main() {
  const repo = dirname(fileURLToPath(import.meta.url))
  if (!existsSync(KEYSTORE)) throw new Error(`no upload key at ${KEYSTORE}. Restore it from Bitwarden ("RadioGrid Android upload key").`)

  let password
  try {
    password = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    throw new Error(`no Keychain item "${KEYCHAIN_SERVICE}". Restore the password from Bitwarden with: security add-generic-password -s ${KEYCHAIN_SERVICE} -a radiogrid -w`)
  }
  const env = { ...process.env, RG_PW: password, BUBBLEWRAP_KEYSTORE_PASSWORD: password, BUBBLEWRAP_KEY_PASSWORD: password }

  const listing = execFileSync(keytool(), ['-list', '-v', '-keystore', KEYSTORE, '-alias', KEY_ALIAS, '-storepass:env', 'RG_PW'], { encoding: 'utf8', env })
  const fingerprint = fingerprintFrom(listing)
  if (!fingerprint) throw new Error('keytool printed no SHA-256 fingerprint for the upload key.')
  console.log(`• Upload key SHA-256: ${fingerprint}`)
  if (!fingerprintListed(readFileSync(join(repo, ASSETLINKS), 'utf8'), fingerprint)) {
    throw new Error(`${ASSETLINKS} doesn't list this key's fingerprint, so the app would open with a URL bar. Add it, commit, and deploy:netlify first.`)
  }

  console.log('• Building the signed APK and AAB with Bubblewrap')
  execFileSync('npx', ['-y', BUBBLEWRAP, 'build', '--skipPwaValidation', `--signingKeyPath=${KEYSTORE}`, `--signingKeyAlias=${KEY_ALIAS}`], { cwd: join(repo, 'twa'), stdio: 'inherit', env })
  console.log(`\n✓ twa/app-release-signed.apk (sideload) and twa/app-release-bundle.aab (Play)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (err) {
    console.error(`✗ Not built: ${err.message}`)
    process.exit(1)
  }
}
