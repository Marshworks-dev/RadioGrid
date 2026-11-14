/**
 * The logo, favicon and home-screen icons: the shapes a browser or launcher
 * gets, read from the files themselves. How they look per theme is measured in
 * tests/contrast.test.mjs.
 * Run with: npm run test:dom
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadApp } from './harness.mjs';
import { PNG_ICONS, iconTiles } from '../make-icons.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(repo, f), 'utf-8');
const html = read('RadioGridXL.html');
const defaultProfile = JSON.parse(read('profiles/default.json'));

const BLUE = '#58c6f8'; // the mark's one colour on a dark ground
const GROUND = '#0d0d1a';

/** The pixel at (x, y) of an 8-bit RGB PNG with no interlacing, as #rrggbb. */
function pngPixel(png, x, y) {
  assert.equal(png[24], 8, 'bit depth');
  assert.equal(png[28], 0, 'not interlaced');
  const width = png.readUInt32BE(16), stride = width * 3 + 1;
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + len));
    at += len + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  // Undo each row's filter in place, down to the row asked for.
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let row = 0; row <= y; row++) {
    const start = row * stride + 1, filter = raw[start - 1];
    for (let i = 0; i < width * 3; i++) {
      const left = i >= 3 ? raw[start + i - 3] : 0, up = row ? raw[start + i - stride] : 0, upLeft = row && i >= 3 ? raw[start + i - stride - 3] : 0;
      const add = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      raw[start + i] = (raw[start + i] + add) & 255;
    }
  }
  const at = y * stride + 1 + x * 3;
  return '#' + raw.subarray(at, at + 3).toString('hex');
}

test('the default build\'s header shows the tile R alone: ten tiles and no other shape', () => {
  const w = loadApp();
  const svg = w.document.getElementById('logo-svg');
  assert.equal(svg.querySelectorAll('rect.logo-tile').length, 10);
  assert.equal(svg.children.length, 10, 'nothing but the tiles');
  for (const tile of svg.children) assert.equal(tile.getAttribute('class'), 'logo-tile', 'no ramp class');
});

test('the header mark is framed tight to the R, and the hide-the-button dialog copies it', () => {
  const w = loadApp();
  const svg = w.document.getElementById('logo-svg');
  assert.equal(svg.getAttribute('viewBox'), '25 25 50 50');
  assert.equal(defaultProfile.logoViewBox, '25 25 50 50');
  // The R spans 42.5 of the frame's 50 units, and the mark is 38px wide: about 32px.
  const xs = [...svg.children].flatMap((t) => [Number(t.getAttribute('x')), Number(t.getAttribute('x')) + Number(t.getAttribute('width'))]);
  assert.equal(Math.max(...xs) - Math.min(...xs), 42.5);
  w.openHidePractice();
  const copy = w.document.getElementById('hide-practice-logo');
  assert.equal(copy.getAttribute('viewBox'), '25 25 50 50');
  assert.equal(copy.innerHTML, svg.innerHTML);
});

test('no wave or ramp is left in the source', () => {
  const sources = ['src/shell.html', ...['src/app', 'src/styles'].flatMap((dir) => readdirSync(join(repo, dir)).filter((f) => /\.(js|css)$/.test(f)).map((f) => `${dir}/${f}`))];
  for (const file of sources) assert.doesNotMatch(read(file), /logo-wave|logo-r\d/, file);
});

test('the inline default profile and profiles/default.json carry the same logo', () => {
  const inline = html.match(/ {2}logoSvg: '([^']*)',/)[1];
  assert.equal(inline, defaultProfile.logoSvg);
});

test('the lock-screen artwork is the R alone and carries its own colour (it gets no stylesheet)', () => {
  const art = loadApp().mediaArtwork();
  const svg = decodeURIComponent(art[0].src.replace('data:image/svg+xml,', ''));
  const shapes = svg.match(/<(rect|path|circle)\b[^>]*>/g);
  assert.equal(shapes.length, 10);
  for (const el of shapes) assert.match(el, new RegExp(`^<rect [^>]*fill="${BLUE}"`), el);
});

test('the tab icon is the plain R on whole pixels, one blue for a light tab and one for a dark tab', () => {
  const href = html.match(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)">/)[1];
  assert.match(href, /^data:image\/svg\+xml,/, 'inline, so no extra file or route');
  const svg = decodeURIComponent(href.slice('data:image/svg+xml,'.length));
  assert.match(svg, /viewBox="0 0 16 16"/);
  const rects = [...svg.matchAll(/<rect class="t" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)];
  assert.equal(rects.length, 10);
  assert.equal(svg.match(/<rect /g).length, 10, 'every tile takes the one class');
  for (const [, x, y, wd, ht] of rects) {
    assert.ok(Number(x) + Number(wd) <= 16 && Number(y) + Number(ht) <= 16, 'inside the 16px square');
  }
  assert.deepEqual(svg.match(/fill:#[0-9a-f]{6}/g), ['fill:#1367a8', `fill:${BLUE}`], 'a light-tab colour, then the dark-tab one');
  assert.match(svg, new RegExp(`@media \\(prefers-color-scheme:dark\\)\\{\\.t\\{fill:${BLUE}\\}\\}`));
});

/** How far the tiles' corners reach from (cx, cy). */
function tileReach(tiles, cx, cy) {
  let reach = 0;
  for (const t of tiles) for (const x of [t.x, t.x + t.w]) for (const y of [t.y, t.y + t.h]) reach = Math.max(reach, Math.hypot(x - cx, y - cy));
  return reach;
}

test('the home-screen icon is the R alone in one blue, larger than the old mark, inside the maskable safe zone (radius 40 of 100)', () => {
  const svg = read('icon.svg');
  assert.match(svg, /<rect width="100" height="100" fill="#0d0d1a"\/>/, 'opaque background');
  const tiles = iconTiles(svg);
  assert.equal(tiles.length, 10);
  assert.equal(svg.match(/<(rect|path|circle)\b/g).length, 11, 'the ground and ten tiles, nothing else');
  for (const t of tiles) assert.equal(t.fill, BLUE);
  const scale = Number(svg.match(/translate\(50 50\) scale\(([\d.]+)\) translate\(-50 -50\)/)[1]);
  assert.ok(scale > 0.78, 'drawn larger than the mark with waves was (0.78)');
  const reach = tileReach(tiles, 50, 50) * scale;
  assert.ok(reach <= 40, `mark reaches ${reach.toFixed(1)} from the centre`);
});

test('every PNG icon is its stated size, has no alpha channel, and was drawn from today\'s icon.svg', () => {
  const svg = read('icon.svg');
  const scale = Number(svg.match(/translate\(50 50\) scale\(([\d.]+)\)/)[1]);
  const [first] = iconTiles(svg);
  // Where the first tile's middle lands, and a spot left of the R where the old mark's wave ran.
  const tileMiddle = 50 + (first.x + first.w / 2 - 50) * scale;
  assert.deepEqual(PNG_ICONS.map((i) => [i.file, i.size]), [
    ['icon-192.png', 192], ['icon-512.png', 512], ['ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024],
  ]);
  for (const { file, size } of PNG_ICONS) {
    const png = readFileSync(join(repo, file));
    assert.equal(png.readUInt32BE(16), size, `${file} width`);
    assert.equal(png.readUInt32BE(20), size, `${file} height`);
    assert.equal(png[25], 2, `${file} is plain RGB: no alpha channel (the App Store refuses one)`);
    const px = (u) => Math.floor(u * size / 100);
    assert.equal(pngPixel(png, px(tileMiddle), px(tileMiddle)), BLUE, `${file}: a tile where icon.svg puts one`);
    assert.equal(pngPixel(png, px(14), px(50)), GROUND, `${file}: nothing beside the R`);
    assert.equal(pngPixel(png, 0, 0), GROUND, `${file}: the ground reaches the corner`);
  }
});

test('unhappy path: a profile with no logo boots with an empty header mark and no lock-screen artwork', () => {
  const { logoSvg, ...noLogo } = defaultProfile;
  const w = loadApp({ profile: noLogo });
  assert.equal(w.document.getElementById('logo-svg').innerHTML, '');
  assert.equal(w.mediaArtwork().length, 0);
  assert.equal(w.__bootErrors.length, 0);
});
