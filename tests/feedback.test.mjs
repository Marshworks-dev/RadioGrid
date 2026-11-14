/**
 * The settings "Have feedback?" card and the static page its QR code opens.
 * The QR is decoded from the real SVG in the app with jsQR, a different
 * library from the one that drew it, so a wrong or broken code fails here.
 * Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import jsQR from 'jsqr'; // dev-only decoder: zero dependencies, raw RGBA pixels; last released 2021, stable rather than maintained, fine for a test
import { loadApp } from './harness.mjs';
import { FEEDBACK_URL, QR_START, QR_END, feedbackQrSvg } from '../make-feedback-qr.mjs';
import { validateProfile, paletteIdsFrom } from '../build-profile.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(repo, 'RadioGridXL.html'), 'utf-8');
const page = readFileSync(join(repo, 'feedback', 'index.html'), 'utf-8');
const storedSvg = html.slice(html.indexOf(QR_START) + QR_START.length, html.indexOf(QR_END));

/** Rasterise the stored QR (a white square plus one path of horizontal runs)
    to RGBA pixels at `scale` px per module, the way a screen would show it. */
function rasterise(svg, scale = 6) {
  const size = Number(svg.match(/viewBox="0 0 (\d+) \1"/)[1]);
  const px = size * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  const d = svg.match(/<path fill="#000000" d="([^"]+)"/)[1];
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let yy = Number(y) * scale; yy < (Number(y) + 1) * scale; yy++) {
      for (let xx = Number(x) * scale; xx < (Number(x) + Number(run)) * scale; xx++) {
        const i = (yy * px + xx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, px };
}

// ── The code ──────────────────────────────────────────────────────────────
test('the QR stored in the app decodes to exactly the feedback page', () => {
  const { data, px } = rasterise(storedSvg);
  const found = jsQR(data, px, px);
  assert.ok(found, 'jsQR could not read the code');
  assert.equal(found.data, 'https://marsh.city/radio/feedback/');
  assert.equal(found.data, FEEDBACK_URL);
});

test('the stored QR is what the generator draws now, so nobody hand-edited it', () => {
  assert.equal(storedSvg, feedbackQrSvg());
});

test('the QR keeps a 4-module light margin and holds no version or ID', () => {
  const size = Number(storedSvg.match(/viewBox="0 0 (\d+) \1"/)[1]);
  const d = storedSvg.match(/ d="([^"]+)"/)[1];
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    assert.ok(Number(x) >= 4 && Number(y) >= 4 && Number(x) + Number(run) <= size - 4 && Number(y) < size - 4, 'module inside the quiet zone');
  }
  const { data, px } = rasterise(storedSvg);
  assert.doesNotMatch(jsQR(data, px, px).data, /[?#]|v\d/);
});

test('a damaged copy fails to decode, so the decode test can actually fail — unhappy path', () => {
  const wiped = storedSvg.replace(/ d="[^"]+"/, ' d="M4 4h1v1h-1z"');
  const { data, px } = rasterise(wiped);
  assert.equal(jsQR(data, px, px), null);
});

// ── The card ──────────────────────────────────────────────────────────────
test('the default profile shows the card: the code, then the page address and email as plain text, never links', () => {
  const w = loadApp();
  const d = w.document;
  const section = d.getElementById('feedback-section');
  assert.equal(section.hidden, false);
  assert.ok(section.closest('.s-group').querySelector('#g-setup'), 'card sits in the Setup group');
  assert.ok(section.querySelector('svg.feedback-qr'));
  assert.match(d.getElementById('feedback-hint').textContent, /Scan with your phone/);
  assert.equal(d.getElementById('feedback-page-address').textContent, 'marsh.city/radio/feedback');
  assert.equal(d.getElementById('feedback-mail-address').textContent, 'radio@marsh.city');
  // A tap on the radio must not open a website or the mail app (PROMISES.md).
  assert.equal(section.querySelectorAll('a, [href], [target], [onclick]').length, 0);
  w.close();
});

test('a branded build and a profile without the key show no card — unhappy path', () => {
  for (const profile of ['example-org', { orgName: 'Test', pin: '', streams: [{ id: 'a', label: 'A', sub: '', url: 'https://example.com/a', emoji: '🎵', color: 'blue' }] }]) {
    const w = loadApp({ profile });
    const d = w.document;
    assert.equal(d.getElementById('feedback-section').hidden, true);
    w.close();
  }
});

test('file:// (the APK) shows no card — unhappy path', () => {
  const w = loadApp({ url: 'file:///android_asset/RadioGridXL.html' });
  assert.equal(w.document.getElementById('feedback-section').hidden, true);
  w.close();
});

test('build-profile refuses a feedback value that is not true or false — unhappy path', () => {
  const good = JSON.parse(readFileSync(join(repo, 'profiles', 'default.json'), 'utf-8'));
  const ids = paletteIdsFrom(html);
  assert.deepEqual(validateProfile(good, ids), []);
  assert.deepEqual(validateProfile({ ...good, feedback: false }, ids), []);
  assert.ok(validateProfile({ ...good, feedback: 'yes' }, ids).includes('feedback must be true or false'));
});

// ── Every theme ───────────────────────────────────────────────────────────
const THEMES = ['dark', 'light', 'mono-dark', 'mono-light', 'contrast-dark', 'contrast-light', 'night'];
const COLOUR_PROPS = ['fill', 'stroke', 'opacity', 'filter', 'mix-blend-mode', 'color'];

/** Every style rule in the page's stylesheets, media rules included. */
function styleRules(d) {
  const out = [];
  const walk = (rules) => { for (const r of rules) { if (r.cssRules) walk(r.cssRules); if (r.selectorText) out.push(r); } };
  for (const sheet of d.styleSheets) walk(sheet.cssRules);
  return out;
}

test('in every theme, no style rule recolours, fades or filters the code or anything around it', () => {
  const w = loadApp();
  const d = w.document;
  const qr = d.getElementById('feedback-qr');
  assert.equal(qr.querySelector('rect').getAttribute('fill'), '#ffffff');
  assert.equal(qr.querySelector('path').getAttribute('fill'), '#000000');
  const ancestors = [];
  for (let el = qr.parentElement; el; el = el.parentElement) ancestors.push(el);
  const rules = styleRules(d);
  for (const theme of THEMES) {
    d.documentElement.className = 'theme-' + theme;
    for (const rule of rules) {
      for (const sel of rule.selectorText.split(',')) {
        let hits;
        try { hits = [qr, ...qr.children].some((el) => el.matches(sel)); } catch { continue; }
        if (hits) for (const p of COLOUR_PROPS) assert.equal(rule.style.getPropertyValue(p), '', `${theme}: "${sel}" sets ${p} on the code`);
        let around;
        try { around = ancestors.some((el) => el.matches(sel)); } catch { continue; }
        if (around) for (const p of ['filter', 'opacity', 'mix-blend-mode']) assert.equal(rule.style.getPropertyValue(p), '', `${theme}: "${sel}" sets ${p} around the code`);
      }
    }
  }
  w.close();
});

// ── Screen readers ────────────────────────────────────────────────────────
test('screen readers get a labelled group, a named image, and the address and email read as text, for anyone without a camera', () => {
  const w = loadApp();
  const d = w.document;
  const section = d.getElementById('feedback-section');
  assert.equal(section.getAttribute('role'), 'group');
  assert.equal(d.getElementById(section.getAttribute('aria-labelledby')).textContent, 'Have feedback?');
  const qr = d.getElementById('feedback-qr');
  assert.equal(qr.getAttribute('role'), 'img');
  assert.match(qr.getAttribute('aria-label'), /marsh\.city\/radio\/feedback/);
  assert.match(section.textContent, /marsh\.city\/radio\/feedback[\s\S]*radio@marsh\.city/);
  w.close();
});

// ── The page ──────────────────────────────────────────────────────────────
test('the feedback page is static: no scripts, no forms, nothing loaded from elsewhere', () => {
  assert.doesNotMatch(page, /<script|<form|<iframe|<img|<link\b/i);
  assert.match(page, /http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/);
  assert.doesNotMatch(page, /(src|href)="https?:\/\//);
});

test('the feedback page holds the thanks, the email button, the tips and the privacy note', () => {
  assert.match(page, /<h1>Thanks/);
  assert.match(page, /<a class="email" href="mailto:radio@marsh\.city\?subject=RadioGridXL%20feedback">Email us<\/a>/);
  assert.match(page, /version/i);
  assert.match(page, /sends nothing/);
  assert.match(page, /never posted publicly/);
  assert.match(page, /deleted once/);
});
