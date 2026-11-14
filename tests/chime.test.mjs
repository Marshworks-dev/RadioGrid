/**
 * The start/pause chime. A listener who can't see the screen tells Start from
 * Pause by ear, so Start must rise and Pause must fall, and a chime that
 * fails must never take the tap down with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootPlayback, CONNECT_MS } from './playback-fakes.mjs';

const pitches = (notes) => notes.map((n) => n.freq);

test('Start rises and Pause falls, one note after the other', async () => {
  const t = bootPlayback();
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  const start = t.chime.notes.slice();
  assert.equal(start.length, 2, 'a two-note chime on Start');
  assert.ok(start[1].freq > start[0].freq, `Start rises: ${pitches(start)}`);
  assert.ok(start[1].at > start[0].at, 'the notes are struck in turn');

  t.w.playStream('s1');
  await t.clock.tick(0);
  const pause = t.chime.notes.slice(2);
  assert.equal(pause.length, 2, 'a two-note chime on Pause');
  assert.ok(pause[1].freq < pause[0].freq, `Pause falls: ${pitches(pause)}`);
});

test('chime off: a tap makes no tone', async () => {
  const t = bootPlayback({ cfg: { chime: 'off' } });
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.chime.chimes, 0);
});

test('a broken AudioContext is warned about and the station still plays (unhappy path)', async () => {
  const t = bootPlayback();
  const warnings = [];
  t.w.console.warn = (...a) => warnings.push(a.join(' '));
  t.w.AudioContext = class { constructor() { throw new Error('no audio device'); } };
  t.w.playStream('s1');
  await t.clock.tick(CONNECT_MS);
  assert.equal(t.audio.state.paused, false, 'the stream plays');
  assert.ok(warnings.some((w) => w.includes('chime failed')), 'the failure is logged, not swallowed');
});
