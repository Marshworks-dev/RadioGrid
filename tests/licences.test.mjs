/**
 * Every copy says its licence and carries its notices. Settings names the
 * GPL and the licences page in every build, branded ones too, as plain text;
 * the licences page is static and lists each component the store apps bundle,
 * with its full licence text. A dependency added to the Android or iOS
 * project without a notice fails here. That the hosted build publishes the
 * page is held in deploy-netlify.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp } from './harness.mjs';
import { LICENCES_PAGE } from '../hosted-build.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf-8');
const page = read(LICENCES_PAGE);
const thirdParty = read('THIRD_PARTY.md');
// Gradle dependency lines in either quote style, Groovy or Kotlin DSL, implementation or api.
const GRADLE_DEP = /\b(?:implementation|api)\s*\(?\s*['"]([\w.-]+):([\w.-]+):[\w.-]+['"]/g;
const gradleDeps = (text) => [...text.matchAll(GRADLE_DEP)].map((m) => `${m[1]}:${m[2]}`);
const NOTICE = 'Free software under the GNU GPL v3.Source code and licences: radio.marshworks.dev/licences';

test('settings name the GPL and the licences page, as text with nothing to tap', () => {
  const w = loadApp();
  w.openSettings();
  const el = w.document.getElementById('settings-licence');
  assert.ok(el, 'the licence line is in settings');
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, NOTICE);
  assert.equal(el.querySelector('a, button, [onclick], [href], [tabindex]'), null, 'never a link: the radio never opens a website');
});

test('a branded build keeps the licence line: a profile cannot turn it off', () => {
  const profile = JSON.parse(read('tests/fixtures/example-org.json'));
  const w = loadApp({ profile });
  const el = w.document.getElementById('settings-licence');
  assert.ok(el, 'the licence line is in a branded build');
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, NOTICE);
});

test('the licences page is static: no scripts, no forms, nothing loaded from elsewhere', () => {
  assert.doesNotMatch(page, /<script|<form|<iframe|<img|<link\b/i);
  assert.match(page, /http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/);
  assert.doesNotMatch(page, /\bsrc="/i, 'nothing loaded by address');
});

test('the licences page states the licence, copyright, source, name and logo carve-out, and stations', () => {
  assert.match(page, /GNU General Public License, version 3/);
  assert.match(page, /Copyright © 2026 MarshWorks LLC/);
  assert.match(page, /href="https:\/\/github\.com\/Marshworks-dev\/RadioGrid"/);
  assert.match(page, /names and logos are not covered by the license/);
  assert.match(page, /isn't affiliated with or endorsed by any station/);
});

test('the full license texts and notices are on the page', () => {
  assert.match(page, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  assert.match(page, /END OF TERMS AND CONDITIONS/);
  assert.match(page, /Copyright \(c\) 2017-present Drifty Co\./);
  assert.match(page, /Permission is hereby granted, free of charge/);
  assert.match(page, /Apache Cordova\nCopyright 2012 The Apache Software Foundation/);
});

test('every Android dependency is on the licences page and in THIRD_PARTY.md', () => {
  const gradle = read('twa/app/build.gradle');
  const direct = gradleDeps(gradle);
  assert.ok(direct.length >= 1, 'found the Gradle dependencies');
  for (const dep of direct) {
    assert.ok(page.includes(dep + ':'), `${dep} is on the licences page`);
    assert.ok(thirdParty.includes(dep + ':'), `${dep} is in THIRD_PARTY.md`);
  }
  // The page and THIRD_PARTY.md list the same resolved libraries.
  const listed = (text) => [...text.matchAll(/(?:<code>|`)([\w.-]+:[\w.-]+:[\w.-]+)(?:<\/code>|`)/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed(page), listed(thirdParty));
});

test('every iOS package is on the licences page and in THIRD_PARTY.md', () => {
  const swift = read('ios/App/CapApp-SPM/Package.swift');
  const packages = [...swift.matchAll(/\.package\(url:\s*"https:\/\/github\.com\/[\w.-]+\/([\w.-]+?)(?:\.git)?"/g)].map((m) => m[1]);
  assert.ok(packages.length >= 1, 'found the Swift packages');
  for (const name of packages) {
    assert.ok(page.includes(name), `${name} is on the licences page`);
    assert.ok(thirdParty.includes(name), `${name} is in THIRD_PARTY.md`);
  }
});

test('an unlisted dependency fails the check, however it is written — unhappy path', () => {
  for (const line of ["implementation 'com.example.tracker:sdk:1.0.0'", 'implementation "com.example.tracker:sdk:1.0.0"',
    "api 'com.example.tracker:sdk:1.0.0'", 'implementation("com.example.tracker:sdk:1.0.0")']) {
    assert.ok(gradleDeps(line).some((dep) => !page.includes(dep + ':')), `caught: ${line}`);
  }
});
