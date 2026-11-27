/**
 * The Android app (twa/): a Trusted Web Activity around radio.marshworks.dev.
 * Its Bubblewrap manifest has to match the PWA's own manifest, and the site
 * has to vouch for the app's signing key in assetlinks.json, or Chrome opens
 * the app with a URL bar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostedFiles, SHELL_FILES, SHIPPED_INPUTS, ASSETLINKS, ASSETLINKS_PATH } from '../hosted-build.mjs';
import { assetlinksProblems, ANDROID_PACKAGE, HOST } from '../deploy-radio-to-netlify.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(join(repo, f), 'utf-8'));
const twa = readJson('twa/twa-manifest.json');
const web = readJson('manifest.json');
const links = readFileSync(join(repo, ASSETLINKS), 'utf-8');

test('the app is dev.marshworks.radiogrid, opening radio.marshworks.dev', () => {
  assert.equal(twa.packageId, ANDROID_PACKAGE);
  assert.equal(twa.host, HOST);
  assert.equal(twa.startUrl, '/');
  assert.equal(twa.fullScopeUrl, `https://${HOST}/`);
  assert.equal(twa.webManifestUrl, `https://${HOST}/manifest.json`);
});

test('the app has a version name and code (Bubblewrap reads "appVersion"; a wrong key builds with a blank name)', () => {
  assert.match(twa.appVersion ?? '', /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isInteger(twa.appVersionCode) && twa.appVersionCode >= 1);
  assert.equal(twa.appVersionName, undefined, 'appVersionName is ignored by Bubblewrap');
  assert.match(readFileSync(join(repo, 'twa/app/build.gradle'), 'utf-8'), new RegExp(`versionName "${twa.appVersion.replaceAll('.', '\\.')}"`), 'the generated project carries it: rerun bubblewrap update');
  assert.ok(twa.minSdkVersion >= 24, 'androidbrowserhelper needs API 24');
});

test('the app\'s name, colours and icon match the PWA manifest', () => {
  assert.equal(twa.name, web.name);
  assert.equal(twa.launcherName, web.short_name);
  for (const key of ['themeColor', 'themeColorDark', 'navigationColor', 'navigationColorDark']) {
    assert.equal(twa[key].toLowerCase(), web.theme_color.toLowerCase(), key);
  }
  assert.equal(twa.backgroundColor.toLowerCase(), web.background_color.toLowerCase());
  const icon512 = web.icons.find((i) => i.sizes === '512x512');
  assert.equal(twa.iconUrl, `https://${HOST}/${icon512.src}`);
  assert.equal(twa.maskableIconUrl, `https://${HOST}/${icon512.src}`);
  assert.match(icon512.purpose, /maskable/, 'the icon used as maskable is declared maskable');
});

test('the site-settings shortcut stays on: with it off the app crashes at launch', () => {
  // androidbrowserhelper 2.7.4 toggles ManageDataLauncherActivity on every
  // launch, but Bubblewrap leaves that activity out of the manifest when the
  // shortcut is off, so LauncherActivity throws "Component class ... does not
  // exist" (seen on droidrig, 2026-11-24). The cost: a long press on the icon
  // offers Chrome's site settings for radio.marshworks.dev.
  assert.equal(twa.enableSiteSettingsShortcut, true);
  assert.match(readFileSync(join(repo, 'twa/app/src/main/AndroidManifest.xml'), 'utf-8'), /ManageDataLauncherActivity/, 'the generated manifest declares it: rerun bubblewrap update');
});

test('the app asks for nothing extra: no notifications, no signing secrets in the repo', () => {
  assert.equal(twa.enableNotifications, false);
  assert.equal(twa.features && Object.keys(twa.features).length, 0);
  // The real keystore path and passwords come from build-android.mjs at
  // build time; the committed manifest only holds a placeholder.
  assert.doesNotMatch(JSON.stringify(twa.signingKey), /\/Users\/|password/i);
  const ignore = readFileSync(join(repo, '.gitignore'), 'utf-8');
  for (const pattern of ['*.jks', '*.keystore', '*.apk', '*.aab']) assert.ok(ignore.split('\n').includes(pattern), pattern);
});

test('the committed assetlinks.json passes the deploy check', () => {
  assert.deepEqual(assetlinksProblems(links), []);
  assert.ok(SHIPPED_INPUTS.includes(ASSETLINKS), 'a deploy refuses to run while it has uncommitted changes');
});

// Both keys stay listed: Google Play signs the copies it delivers with its
// own app signing key, and the APK installed over USB on a kiosk tablet is
// signed with the upload key. Drop either and that copy opens with a URL bar.
const UPLOAD_KEY = '4C:3F:0B:FE:AF:CB:CC:F8:6D:41:05:B1:56:16:E5:61:DC:22:BD:11:6B:87:77:BB:E5:F8:5E:57:AC:3C:97:36';
const PLAY_SIGNING_KEY = '4A:C0:5C:C2:F3:BC:B6:1C:14:B4:D7:B5:A0:7E:C8:EB:66:23:AC:60:C4:E1:E9:50:FA:17:48:33:E3:93:D3:26';

test('assetlinks.json vouches for both the Play signing key and the upload key', () => {
  const ours = JSON.parse(links).find((s) => s.target.package_name === ANDROID_PACKAGE);
  const prints = ours.target.sha256_cert_fingerprints;
  assert.ok(prints.includes(PLAY_SIGNING_KEY), 'the copy installed from Google Play would open with a URL bar');
  assert.ok(prints.includes(UPLOAD_KEY), 'the APK installed over USB would open with a URL bar');
  // Any other key listed here could open radio.marshworks.dev as if it were this app.
  assert.deepEqual([...prints].sort(), [PLAY_SIGNING_KEY, UPLOAD_KEY].sort(), 'assetlinks.json lists a key that is neither ours nor Play\'s');
});

test('assetlinks problems are caught — unhappy path', () => {
  const statement = JSON.parse(links);
  const edit = (fn) => { const copy = structuredClone(statement); fn(copy[0]); return JSON.stringify(copy); };
  assert.match(assetlinksProblems(undefined).join(), /no \.well-known\/assetlinks\.json/);
  assert.match(assetlinksProblems('{not json').join(), /isn't valid JSON/);
  assert.match(assetlinksProblems(edit((s) => { s.target.package_name = 'com.radiogridxl.app'; })).join(), /doesn't name dev\.marshworks\.radiogrid/);
  assert.match(assetlinksProblems(edit((s) => { s.target.sha256_cert_fingerprints = []; })).join(), /no signing fingerprint/);
  assert.match(assetlinksProblems(edit((s) => { s.target.sha256_cert_fingerprints = ['4C:3F:0B']; })).join(), /isn't 32 colon-separated hex bytes/);
  assert.match(assetlinksProblems(edit((s) => { s.relation = []; })).join(), /handle_all_urls/);
});

/** Hosted files from a throwaway copy of the repo's inputs. */
async function build(opts) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-twa-test-'));
  try {
    for (const f of [...SHELL_FILES, 'sw.js', 'feedback', 'licenses', 'privacy', ASSETLINKS]) cpSync(join(repo, f), join(dir, f), { recursive: true });
    mkdirSync(join(dir, 'dist'));
    cpSync(join(repo, 'RadioGridXL.html'), join(dir, 'dist', 'RadioGridXL.html'));
    return await hostedFiles(dir, opts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('radio.marshworks.dev serves assetlinks.json at /.well-known/; the moved build at marsh.city/radio doesn\'t', async () => {
  const hosted = await build();
  const served = hosted.find((f) => f.name === ASSETLINKS_PATH);
  assert.ok(served, 'the Netlify build carries it');
  assert.equal(String(served.data), links);
  const moved = await build({ moved: true });
  assert.ok(!moved.some((f) => f.name === ASSETLINKS_PATH), 'marsh.city/radio is no app\'s home');
});

// ── build-android.mjs ──────────────────────────────────────────────────────
import { fingerprintFrom, fingerprintListed, BUBBLEWRAP } from '../build-android.mjs';

test('the build reads the key\'s fingerprint from keytool and checks it against assetlinks.json', () => {
  const listed = JSON.parse(links)[0].target.sha256_cert_fingerprints[0];
  const keytoolOut = `Alias name: upload\nCertificate fingerprints:\n\t SHA1: AA:BB\n\t SHA256: ${listed}\nSignature algorithm name: SHA384withRSA`;
  assert.equal(fingerprintFrom(keytoolOut), listed);
  assert.ok(fingerprintListed(links, listed));
});

test('a key the site doesn\'t vouch for stops the build — unhappy path', () => {
  const stranger = Array(32).fill('AB').join(':');
  assert.equal(fingerprintListed(links, stranger), false);
  assert.equal(fingerprintFrom('keytool error: java.io.IOException: keystore password was incorrect'), null);
});

test('Bubblewrap runs at an exact version', () => {
  assert.match(BUBBLEWRAP, /^@bubblewrap\/cli@\d+\.\d+\.\d+$/);
});
