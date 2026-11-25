/**
 * Every copy says its license and carries its notices. Settings names the
 * GPL and the licenses page in every build, branded ones too, as plain text;
 * the licenses page is static and lists each component the store apps bundle,
 * with its full license text. A dependency added to the Android or iOS
 * project without a notice fails here. That the hosted build publishes the
 * page is held in deploy-netlify.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadApp } from './harness.mjs';
import { LICENSES_PAGE } from '../hosted-build.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf-8');
const page = read(LICENSES_PAGE);
const thirdParty = read('THIRD_PARTY.md');
// Gradle dependency lines that ship in the release app (compileOnly, kapt and
// debug-only ones don't), in either quote style, Groovy or Kotlin DSL.
// The version is captured too: a bump changes what the library pulls in, so it
// fails here until the list is regenerated.
const GRADLE_DEP = /\b(?:implementation|api|runtimeOnly|releaseImplementation|releaseRuntimeOnly)\s*\(?\s*['"]([\w.-]+):([\w.-]+):([\w.-]+)['"]/g;
const gradleDeps = (text) => [...text.matchAll(GRADLE_DEP)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);
// A shipping dependency line the pattern above can't read (a version in a
// variable, a range, a version catalog, platform()) would ship unlisted, so
// it fails instead. The template's fileTree(libs) line is checked separately.
// Any configuration that can ship (flavour and build-type ones too: playImplementation,
// releaseApi), and one coordinate per line, so a comma list can't hide a second.
const SHIPPING_LINE = /^\s*(?:\w*Implementation|\w*Api|\w*RuntimeOnly|implementation|api|runtimeOnly)\b.*$/gm;
const COORDINATE = /['"][^'"\s]+:[^'"\s]+:[^'"\s]*['"]/g;
const unreadableDeps = (text) => [...text.matchAll(SHIPPING_LINE)].map((m) => m[0].trim())
  .filter((line) => line !== "implementation fileTree(include: ['*.jar'], dir: 'libs')"
    && (gradleDeps(line).length !== 1 || (line.match(COORDINATE) ?? []).length !== 1));
// Swift packages, by GitHub address or by local path (Capacitor writes each
// plugin as .package(name:, path:)). Every .package( must be one of the two.
const SWIFT_PACKAGE = /\.package\(\s*(?:url:\s*"https:\/\/github\.com\/[\w.-]+\/([\w.-]+?)(?:\.git)?"|name:\s*"([^"]+)"\s*,\s*path:)/g;
const swiftPackages = (text) => [...text.matchAll(SWIFT_PACKAGE)].map((m) => m[1] ?? m[2]);
const swiftPackageCount = (text) => (text.match(/\.package\(/g) ?? []).length;
// Copyright holders named in the Android app's own source (the Bubblewrap
// template's files), other than MarshWorks.
const COPYRIGHT = /Copyright\s+(?:\([cC]\)\s*|©\s*)?\d{4}(?:\s*[-–,]\s*\d{4})*,?\s+([A-Z][^.\n*]*\.?)/g; // the holder runs to its first full stop: "Google Inc."
const holders = (text) => [...text.matchAll(COPYRIGHT)].map((m) => m[1].trim()).filter((h) => !/MarshWorks/.test(h));
// Third-party code pasted into the web app ships inside the iOS app: a licence
// banner, an SPDX tag or someone else's copyright line in the built page fails.
const foreignMarkers = (text) => [
  ...[...text.matchAll(/@license\b|SPDX-License-Identifier|\/\*!/g)].map((m) => m[0]),
  ...holders(text),
];
// Packages added in Xcode (File › Add Package Dependencies) land in the project
// file, not in Capacitor's Package.swift.
const remotePackages = (pbxproj) => [...pbxproj.matchAll(/isa = XCRemoteSwiftPackageReference;[^}]*?repositoryURL = "?([^";]+)/g)].map((m) => m[1]);
const filesUnder = (dir, only = /./) => readdirSync(new URL(dir, root), { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && only.test(d.name)).map((d) => readFileSync(`${d.parentPath}/${d.name}`, 'utf-8'));
const NOTICE = '© 2026 MarshWorks LLC. Free software under the GNU GPL v3, with no warranty.Source code and licenses: radio.marshworks.dev/licenses';

test('settings name the GPL and the licenses page, as text with nothing to tap', () => {
  const w = loadApp();
  w.openSettings();
  const el = w.document.getElementById('settings-license');
  assert.ok(el, 'the license line is in settings');
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, NOTICE);
  assert.equal(el.querySelector('a, button, [onclick], [href], [tabindex]'), null, 'never a link: the radio never opens a website');
});

test('a branded build keeps the license line: a profile cannot turn it off', () => {
  const profile = JSON.parse(read('tests/fixtures/example-org.json'));
  const w = loadApp({ profile });
  const el = w.document.getElementById('settings-license');
  assert.ok(el, 'the license line is in a branded build');
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, NOTICE);
});

test('the licenses page is static: no scripts, no forms, nothing loaded from elsewhere', () => {
  assert.doesNotMatch(page, /<script|<form|<iframe|<img|<link\b/i);
  assert.match(page, /http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/);
  assert.doesNotMatch(page, /\bsrc="/i, 'nothing loaded by address');
});

test('the licenses page states the license, copyright, source, name and logo carve-out, and stations', () => {
  assert.match(page, /GNU General Public License, version 3/);
  assert.match(page, /Copyright © 2026 MarshWorks LLC/);
  assert.match(page, /href="https:\/\/github\.com\/Marshworks-dev\/RadioGrid"/);
  assert.match(page, /names and logos are trademarks of MarshWorks LLC\. The GPL grants no rights to use them as trademarks \(section 7\(e\)\)/);
  assert.match(page, /isn't affiliated with or endorsed by any station/);
});

test('the full license texts and notices are on the page', () => {
  assert.match(page, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  assert.match(page, /END OF TERMS AND CONDITIONS/);
  assert.match(page, /Copyright \(c\) 2017-present Drifty Co\./);
  assert.match(page, /Permission is hereby granted, free of charge/);
  assert.match(page, /Apache Cordova\nCopyright 2012 The Apache Software Foundation/);
});

test('every Android dependency is on the licenses page and in THIRD_PARTY.md', () => {
  const gradle = read('twa/app/build.gradle');
  const direct = gradleDeps(gradle);
  assert.ok(direct.length >= 1, 'found the Gradle dependencies');
  assert.deepEqual(unreadableDeps(gradle), [], 'every shipping dependency line can be read');
  const libs = new URL('twa/app/libs/', root);
  const jars = existsSync(libs) ? readdirSync(libs).filter((f) => f.endsWith('.jar')) : [];
  assert.deepEqual(jars, [], 'no loose jar in twa/app/libs: list it as a Gradle dependency instead');
  for (const dep of direct) {
    assert.ok(page.includes(`<code>${dep}</code>`), `${dep}, at this version, is on the licenses page`);
    assert.ok(thirdParty.includes(`\`${dep}\``), `${dep}, at this version, is in THIRD_PARTY.md`);
  }
  // The page and THIRD_PARTY.md list the same resolved libraries.
  const listed = (text) => [...text.matchAll(/(?:<code>|`)([\w.-]+:[\w.-]+:[\w.-]+)(?:<\/code>|`)/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed(page), listed(thirdParty));
});

test('every copyright holder in the apps\' own source is on the licenses page and in THIRD_PARTY.md', () => {
  const found = new Set([...filesUnder('twa/app/src/'), ...filesUnder('ios/App/App/', /\.(swift|m|h)$/)].flatMap(holders));
  assert.ok(found.has('Google Inc.'), 'found the Bubblewrap template headers');
  for (const holder of found) {
    assert.ok(page.includes(holder), `${holder} is on the licenses page`);
    assert.ok(thirdParty.includes(holder), `${holder} is in THIRD_PARTY.md`);
  }
});

test('the web app carries no third-party code, so the iOS app bundles none through it', () => {
  assert.deepEqual(foreignMarkers(read('RadioGridXL.html')), []);
});

test('the Android build uses only the Android Gradle plugin: a plugin can add runtime code with no dependency line', () => {
  const app = read('twa/app/build.gradle');
  const block = app.match(/^plugins\s*\{([^}]*)\}/m)?.[1] ?? '';
  const plugins = [...[...block.matchAll(/\bid\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...app.matchAll(/\bapply\s*\(?\s*plugin\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])];
  assert.deepEqual(plugins, ['com.android.application'], 'a new Gradle plugin is reviewed for what it adds to the app, then listed here');
  const classpath = [...read('twa/build.gradle').matchAll(/^\s*classpath\s*\(?\s*['"]([^'"]+)['"]/gm)].map((m) => m[1].replace(/:[^:]+$/, ''));
  assert.deepEqual(classpath, ['com.android.tools.build:gradle']);
  assert.doesNotMatch(read('twa/build.gradle'), /^\s*(?:\w*Implementation|\w*Api|implementation|api|runtimeOnly)\b/m, 'no dependencies added from the root project');
});

test('every resolved Swift package, at its version, is on the licenses page and in THIRD_PARTY.md, and Xcode adds none of its own', () => {
  const resolved = JSON.parse(read('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'));
  assert.ok(resolved.pins.length >= 1, 'found the resolved packages');
  for (const { identity, state } of resolved.pins) {
    assert.ok(page.includes(`${identity} ${state.version}`), `${identity} ${state.version} is on the licenses page`);
    assert.ok(thirdParty.includes(`${identity} ${state.version}`), `${identity} ${state.version} is in THIRD_PARTY.md`);
  }
  const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.deepEqual(remotePackages(pbxproj), [], 'packages come through Capacitor\'s CapApp-SPM, which the checks above read');
});

test('every iOS package is on the licenses page and in THIRD_PARTY.md', () => {
  const swift = read('ios/App/CapApp-SPM/Package.swift');
  const packages = swiftPackages(swift);
  assert.ok(packages.length >= 1, 'found the Swift packages');
  assert.equal(packages.length, swiftPackageCount(swift), 'every .package( entry can be read');
  for (const name of packages) {
    assert.ok(page.includes(name), `${name} is on the licenses page`);
    assert.ok(thirdParty.includes(name), `${name} is in THIRD_PARTY.md`);
  }
});

test('an unlisted dependency fails the check, however it is written — unhappy path', () => {
  for (const line of ["implementation 'com.example.tracker:sdk:1.0.0'", 'implementation "com.example.tracker:sdk:1.0.0"',
    "api 'com.example.tracker:sdk:1.0.0'", 'implementation("com.example.tracker:sdk:1.0.0")',
    "runtimeOnly 'com.example.tracker:sdk:1.0.0'", "releaseImplementation 'com.example.tracker:sdk:1.0.0'"]) {
    assert.ok(gradleDeps(line).some((dep) => !page.includes(`<code>${dep}</code>`)), `caught: ${line}`);
  }
  const bumped = "implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.8.0'";
  assert.ok(gradleDeps(bumped).some((dep) => !page.includes(`<code>${dep}</code>`)), 'caught a version bump');
  for (const line of ['implementation "com.example.tracker:sdk:$trackerVersion"', "implementation 'com.example.tracker:sdk:1.+'",
    'implementation libs.tracker', "implementation platform('com.example:bom:1.0')", "implementation fileTree(dir: 'vendor', include: ['*.jar'])"]) {
    assert.deepEqual(unreadableDeps(line), [line], `refused as unreadable: ${line}`);
  }
  const plugin = '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.0"),\n.package(name: "CapacitorTracker", path: "../../../node_modules/capacitor-tracker")';
  assert.deepEqual(swiftPackages(plugin), ['capacitor-swift-pm', 'CapacitorTracker'], 'a Capacitor plugin is read by name');
  assert.ok(!page.includes('CapacitorTracker'), 'and an unlisted one is caught');
  assert.notEqual(swiftPackages('.package(id: "x.y", from: "1.0")').length, swiftPackageCount('.package(id: "x.y", from: "1.0")'), 'an unreadable .package( is caught');
  for (const line of ["playImplementation 'com.example.tracker:sdk:1.0.0'", "implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.7.4', 'com.example.tracker:sdk:1.0.0'"]) {
    assert.deepEqual(unreadableDeps(line), [line], `refused as unreadable: ${line}`);
  }
  for (const header of ['Copyright © 2020 Acme Corp.', 'Copyright (C) 2019 Acme Corp.', 'Copyright 2018, 2020 Acme Corp.']) {
    assert.deepEqual(holders(header), ['Acme Corp.'], `holder read from: ${header}`);
  }
  assert.ok(foreignMarkers('/*! NoSleep.js v0.12.0 - Rich Tibbett - MIT license */').length > 0, 'a pasted library banner is caught');
  assert.ok(foreignMarkers('// SPDX-License-Identifier: MIT').length > 0, 'an SPDX tag is caught');
  assert.deepEqual(remotePackages('A1 /* XCRemoteSwiftPackageReference "Alamofire" */ = {\n isa = XCRemoteSwiftPackageReference;\n repositoryURL = "https://github.com/Alamofire/Alamofire";\n };'),
    ['https://github.com/Alamofire/Alamofire'], 'a package added in Xcode is caught');
  assert.ok(holders('/* Copyright 2024 Example Corp. */').some((h) => !page.includes(h)), 'caught an unnamed copyright holder');
});
