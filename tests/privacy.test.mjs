/**
 * The privacy policy says only what the app does. The page is static like the
 * licenses page, and every outside place the hosted app may contact (the
 * hosted CSP, which promise-no-egress holds to the real requests) is named on
 * it. The page names no other site, so a new outside request can't ship while
 * the policy still reads as before. That the hosted build publishes the page
 * is held in deploy-netlify.test.mjs, and that sw.js never caches it in sw.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { HOSTED_CSP, PRIVACY_PAGE } from '../hosted-build.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf-8');
const page = read(PRIVACY_PAGE);
// The page's words as a reader sees them, parsed rather than pattern-stripped.
const text = new JSDOM(page).window.document.body.textContent.replace(/\s+/g, ' ');

/** Hosts the hosted CSP lets the app reach beyond its own origin, as named on
    the page: *.api.radio-browser.info is the directory radio-browser.info. */
function outsideHosts() {
  const directives = Object.fromEntries(HOSTED_CSP.split(';').map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map(([k, ...v]) => [k, v]));
  return [...directives['connect-src'], ...directives['frame-src']]
    .filter((s) => /^https:\/\//.test(s))
    .map((s) => new URL(s.replace('*.', 'wildcard.')).host.replace(/^wildcard\.(api\.)?/, ''));
}

// Every site the page may name, and why it's there.
const NAMED_SITES = new Set([
  'radio.marshworks.dev', // where the app is served from
  'marshworks.dev', // the contact address's domain
  'marsh.city', // the how-to guide frame
  'radio-browser.info', // station searches
]);

test('the privacy page is static: no scripts, no forms, nothing loaded from elsewhere', () => {
  assert.doesNotMatch(page, /<script|<form|<iframe|<img|<link\b/i);
  assert.match(page, /http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/);
  assert.doesNotMatch(page, /\bsrc="/i, 'nothing loaded by address');
});

test('the page names who is responsible, a working contact and its effective date', () => {
  assert.match(text, /made by MarshWorks LLC/);
  const feedbackAddress = read('feedback/index.html').match(/mailto:([^?"]+)/)[1];
  assert.match(page, new RegExp(`href="mailto:${feedbackAddress.replaceAll('.', '\\.')}"`), 'the same address as the feedback page');
  assert.match(text, /Effective (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 20\d\d/);
});

test('every outside place the hosted app may contact is named on the page', () => {
  const hosts = outsideHosts();
  assert.deepEqual(hosts.sort(), ['marsh.city', 'radio-browser.info'], 'the CSP changed: say on the privacy page where the new requests go, then update this list');
  for (const host of hosts) assert.ok(text.includes(host), `the page names ${host}`);
  assert.match(text, /station's own server/, 'streams go to each station');
});

test('the page names no site the app has no reason to — unhappy path', () => {
  const named = new Set(text.match(/\b(?:[a-z0-9-]+\.)+(?:dev|city|info|com|org|net|io|app)\b/gi) ?? []);
  for (const site of named) assert.ok(NAMED_SITES.has(site.toLowerCase()), `${site} is on the privacy page but not on its list`);
  // The check itself catches a stray name.
  const stray = 'Searches also go to stats.example.com.'.match(/\b(?:[a-z0-9-]+\.)+(?:dev|city|info|com|org|net|io|app)\b/gi);
  assert.ok(stray.some((s) => !NAMED_SITES.has(s)), 'a site off the list is caught');
});

test('the hosts the page credits are the ones the deploys use', () => {
  assert.match(text, /hosted by Netlify/);
  assert.match(read('deploy-radio-to-netlify.mjs'), /api\.netlify\.com/);
  assert.match(text, /hosted by GitHub Pages/);
  assert.equal(new URL(JSON.parse(read('profiles/default.json')).helpUrl).host, 'marsh.city', 'the guide opens from marsh.city');
});
