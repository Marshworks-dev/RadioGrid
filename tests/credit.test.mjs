/**
 * Settings say who made the radio (ACCEPTANCE): the default build shows the
 * MarshWorks brand kit's "made by" block under the version, the words above
 * the logo, with nothing to tap. MonoRadio and High Contrast, and a profile
 * that names another maker, show a plain text line. A branded build with no maker
 * names no one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp } from './harness.mjs';
import { BLOCK_FILE, SHELL, STYLES, STYLE_FILE, withBrand } from '../sync-brand.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf-8');
const credit = (w) => w.document.getElementById('settings-credit');
const block = (w) => w.document.getElementById('settings-made-by');
const kitBlock = read(`brand/${BLOCK_FILE}`).trim();
const kitStyle = read(`brand/${STYLE_FILE}`).trim();

test('the default build shows the kit\'s "made by" block under the version, with nothing to tap', () => {
  const w = loadApp();
  w.openSettings();
  const el = block(w);
  assert.equal(el.hidden, false);
  assert.equal(el.querySelector('a, button, [onclick], [href], [tabindex]'), null, 'nothing to tap: the radio never opens a website');
  assert.equal(el.querySelector('span').textContent, 'Made by', 'the words are text');
  assert.ok(el.querySelector('svg path'), 'the logo is drawn in the page, not loaded');
  assert.equal(el.previousElementSibling.id, 'settings-credit');
  assert.equal(credit(w).previousElementSibling.id, 'settings-version', 'right under the version line');
  assert.equal(credit(w).hidden, true, 'the text line steps aside for the block');
});

test('a screen reader reads the credit once, as "Made by MarshWorks"', () => {
  const w = loadApp();
  w.openSettings();
  const named = block(w).querySelectorAll('[aria-label]');
  assert.equal(named.length, 1);
  assert.equal(named[0].getAttribute('aria-label'), 'Made by MarshWorks');
  assert.equal(named[0].getAttribute('role'), 'img', 'one stop, not the words and then the logo');
  assert.equal(block(w).querySelector('svg').getAttribute('aria-hidden'), 'true');
  for (const id of ['settings-version', 'settings-made-by']) {
    assert.equal(w.document.getElementById(id).closest('[aria-hidden="true"]'), null, id);
  }
});

test('the block is the kit\'s file, unchanged: src/ matches the copy in brand/', () => {
  const { shell, styles } = withBrand();
  assert.equal(read(SHELL), shell, 'src/shell.html differs from brand/: run node sync-brand.mjs ../marshworks-brand');
  assert.equal(read(STYLES), styles, 'the stylesheet differs from brand/: run node sync-brand.mjs ../marshworks-brand');
  // And the built file carries both, whole.
  const built = read('RadioGridXL.html');
  assert.ok(built.includes(kitBlock));
  assert.ok(built.includes(kitStyle));
});

test('the kit copy is the plain block: no link, no script, no address but the SVG namespace', () => {
  assert.doesNotMatch(kitBlock, /<a[\s>]|href|<script|\son[a-z]+\s*=|style\s*=|javascript:|data:|url\(/i);
  assert.doesNotMatch(kitBlock.replaceAll('xmlns="http://www.w3.org/2000/svg"', ''), /https?:|\/\//i);
  assert.doesNotMatch(kitStyle.replace(/\/\*[\s\S]*?\*\//g, ''), /@import|url\(|https?:|\/\/|animation|transition|@keyframes/i);
});

test('MonoRadio and High Contrast show the plain text line and no logo', () => {
  const w = loadApp();
  w.openSettings();
  for (const family of ['mono', 'contrast']) {
    w.selectThemeFamily(family);
    assert.match(w.document.documentElement.className, new RegExp(`theme-${family}`));
    assert.equal(block(w).hidden, true, family);
    assert.equal(credit(w).hidden, false, family);
    assert.equal(credit(w).textContent, 'Made by MarshWorks');
    assert.equal(credit(w).querySelector('a, button'), null);
  }
  // Back in a colour theme, the block returns.
  for (const family of ['night', 'default']) {
    w.selectThemeFamily(family);
    assert.equal(block(w).hidden, false, family);
    assert.equal(credit(w).hidden, true, family);
  }
});

test('no build says "MarshWorks LLC" in the credit', () => {
  const w = loadApp();
  w.openSettings();
  assert.equal(credit(w).textContent, 'Made by MarshWorks');
  assert.doesNotMatch(block(w).innerHTML, /LLC/);
  assert.equal(JSON.parse(read('profiles/default.json')).madeBy, 'MarshWorks');
});

test('a branded build with no maker shows no credit: no line and no logo', () => {
  const w = loadApp({ profile: 'example-org' });
  w.openSettings();
  assert.equal(credit(w).hidden, true);
  assert.equal(credit(w).textContent, '');
  assert.equal(block(w).hidden, true);
});

test('a profile that names another maker shows a plain text line and no logo', () => {
  const base = JSON.parse(read('profiles/default.json'));
  const w = loadApp({ profile: { ...base, madeBy: 'Acme Radio' } });
  w.openSettings();
  assert.equal(credit(w).hidden, false);
  assert.equal(credit(w).textContent, 'Made by Acme Radio');
  assert.equal(block(w).hidden, true, 'the MarshWorks logo credits only MarshWorks');
});

test('unhappy path: markup in madeBy is shown as text, never parsed', () => {
  const base = JSON.parse(read('profiles/default.json'));
  const w = loadApp({ profile: { ...base, madeBy: '<img src=x onerror="window.pwned=1">Acme' } });
  w.openSettings();
  assert.equal(credit(w).textContent, 'Made by <img src=x onerror="window.pwned=1">Acme');
  assert.equal(credit(w).querySelector('img'), null);
  assert.equal(block(w).hidden, true);
  assert.equal(w.pwned, undefined);
});
