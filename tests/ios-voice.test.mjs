/**
 * iPhone and iPad can't mix speech with a playing stream (one interrupts the
 * other), so with Voice announcements on, iOS speaks a starting line first:
 * the stream starts at the tap but muted, and its sound comes on when the line
 * ends (or after SPEECH_HOLD_MAX_MS if iOS never says it ended). Android and
 * desktop keep "Now playing" once the audio plays (tests/playback.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootPlayback, STREAMS, CONNECT_MS } from './playback-fakes.mjs';

const [S1, S2] = STREAMS;
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHIME_GAP_MS = 800;
const HOLD_MAX_MS = 6000;

/** An iPhone boot whose speech keeps each line, so a test can end it. */
function bootIPhone(cfg = { tts: 'on' }) {
  const t = bootPlayback({ cfg, beforeParse: (w) => {
    Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: UA_IPHONE });
  } });
  const lines = [];
  t.w.speechSynthesis = {
    cancel() {},
    speak(u) { lines.push(u); },
  };
  t.lines = lines;
  t.said = () => lines.map((u) => u.text);
  t.endLine = () => { const u = lines.at(-1); if (u.onend) u.onend(); };
  t.muted = () => t.w.document.getElementById('audio-player').muted;
  return t;
}

test('iPhone: a station tap says "Tuning to" first, with the stream muted until the line ends', async () => {
  const t = bootIPhone();
  t.w.playStream('s1');
  assert.equal(t.muted(), true, 'muted from the tap');
  assert.equal(t.audio.state.src, S1.url, 'the stream still starts loading at the tap');
  await t.clock.tick(CHIME_GAP_MS + CONNECT_MS);
  assert.deepEqual(t.said(), ['Tuning to ' + S1.label]);
  assert.equal(t.muted(), true, 'still muted while the line is spoken');
  t.endLine();
  assert.equal(t.muted(), false, 'sound comes on when the line ends');
  await t.clock.tick(3000);
  assert.deepEqual(t.said(), ['Tuning to ' + S1.label], 'no "Now playing" over the music');
});

// Found on a real iPhone 2026-11-07: speech pauses the stream even while it
// is muted, and that pause read as the listener's ("plays, then pauses, no
// music").
test('iPhone: iOS pausing the stream for our line is not a listener pause; the music plays when the line ends', async () => {
  const t = bootIPhone();
  t.w.playStream('s1');
  await t.clock.tick(CHIME_GAP_MS + CONNECT_MS);
  t.audio.externalPause(); // iOS, as the line starts
  await t.clock.tick(50);
  assert.equal(t.label('s1').startsWith('Paused'), false, 'not shown as paused');
  t.endLine();
  await t.clock.tick(CONNECT_MS + 50);
  assert.equal(t.audio.state.paused, false, 'playing again');
  assert.equal(t.muted(), false);
});

test('iPhone: the listener pausing during the line stays paused when the line ends', async () => {
  const t = bootIPhone();
  t.w.playStream('s1');
  await t.clock.tick(CHIME_GAP_MS + CONNECT_MS);
  t.audio.externalPause(); // iOS, as the line starts
  await t.clock.tick(50);
  t.w.softStop();          // the listener pauses (the lock screen)
  await t.clock.tick(50);
  t.lines.at(0).onend();   // the "Tuning to" line ends (cancelled by "Paused")
  await t.clock.tick(HOLD_MAX_MS + 1000);
  assert.equal(t.audio.state.paused, true, 'still silent');
  assert.equal(t.status('s1'), 'Tap to play');
});

test('iPhone: a line iOS never reports ending still lets the sound on after the cap', async () => {
  const t = bootIPhone();
  t.w.playStream('s1');
  await t.clock.tick(HOLD_MAX_MS - 100);
  assert.equal(t.muted(), true);
  await t.clock.tick(200);
  assert.equal(t.muted(), false);
});

test('iPhone: resuming says "Resuming" before the sound; pausing is said after it stops', async () => {
  const t = bootIPhone();
  t.w.playStream('s1');
  await t.clock.tick(CHIME_GAP_MS + CONNECT_MS);
  t.endLine();
  t.w.softStop(); // pause (the lock screen)
  await t.clock.tick(CHIME_GAP_MS + 100);
  assert.equal(t.said().at(-1), 'Paused');
  assert.equal(t.muted(), false, 'a pause holds nothing');
  t.w.playStream('s1'); // resume with a tap
  assert.equal(t.muted(), true);
  await t.clock.tick(CHIME_GAP_MS + CONNECT_MS);
  assert.equal(t.said().at(-1), 'Resuming');
  t.endLine();
  assert.equal(t.muted(), false);
});

test('iPhone: a quick switch names only the new station, and the old line ending lets nothing on early', async () => {
  const t = bootIPhone();
  t.w.playStream('s1');
  await t.clock.tick(CHIME_GAP_MS + CONNECT_MS);
  const first = t.lines.at(-1);
  t.w.playStream('s2');
  first.onend(); // cancelling the old line ends it
  assert.equal(t.muted(), true, 'still held for the new line');
  await t.clock.tick(CHIME_GAP_MS + CONNECT_MS);
  assert.equal(t.said().at(-1), 'Tuning to ' + S2.label);
  t.endLine();
  assert.equal(t.muted(), false);
});

test('iPhone: Stop during the line unmutes, so the next start is not left silent', async () => {
  const t = bootIPhone();
  t.w.playStream('s1');
  await t.clock.tick(300);
  t.w.userStop();
  assert.equal(t.muted(), false);
});

test('iPhone with Voice announcements off: nothing is held or said', async () => {
  const t = bootIPhone({ tts: 'off' });
  t.w.playStream('s1');
  assert.equal(t.muted(), false);
  await t.clock.tick(3000);
  assert.deepEqual(t.said(), []);
});

test('Android keeps "Now playing" once the audio plays, never muted', async () => {
  const t = bootPlayback({ cfg: { tts: 'on' } });
  t.w.playStream('s1');
  assert.equal(t.w.document.getElementById('audio-player').muted, false);
  await t.clock.tick(CONNECT_MS + 2000);
  assert.deepEqual(t.spoken, ['Now playing ' + S1.label]);
});
