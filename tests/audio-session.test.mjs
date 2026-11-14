/**
 * iOS Safari (16.4+) puts speech and Web Audio on the "ambient" audio session
 * unless the page asks for 'playback': muted by the silent switch, and speech
 * pauses the stream as if another app took the audio. The app asks for
 * 'playback' at load (usePlaybackAudioSession in RadioGridXL.html).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

test('the page asks iOS for the playback audio session at load', () => {
  let session;
  loadApp({ beforeParse: (w) => {
    session = { type: 'auto' };
    Object.defineProperty(w.navigator, 'audioSession', { configurable: true, value: session });
  } });
  assert.equal(session.type, 'playback');
});

test('no audioSession (Android, desktop, older iOS): the app loads as before', () => {
  const w = loadApp();
  assert.equal('audioSession' in w.navigator, false);
  assert.ok(w.document.getElementById('btn-' + w.eval('cfg.streams[0].id')), 'stations rendered');
});

test('a browser that refuses the type is warned about, not fatal', () => {
  const warnings = [];
  const w = loadApp({ beforeParse: (win) => {
    const session = {};
    Object.defineProperty(session, 'type', { get: () => 'auto', set: () => { throw new TypeError('not allowed'); } });
    Object.defineProperty(win.navigator, 'audioSession', { configurable: true, value: session });
    win.console.warn = (...a) => warnings.push(a.join(' '));
  } });
  assert.ok(w.document.getElementById('btn-' + w.eval('cfg.streams[0].id')), 'stations rendered');
  assert.ok(warnings.some((m) => m.includes('audioSession')), 'the refusal was logged');
});
