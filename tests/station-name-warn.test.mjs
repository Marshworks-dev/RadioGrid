/**
 * Station names a voice can tell apart (the rule: "Every control answers
 * to a name you can say"). Voice Control picks a station by its name, so the
 * stream editor warns, never blocks, when two stations share a name or one is
 * named like a button on the radio.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';

function appWith(labels) {
  const streams = labels.map((label, i) => ({ id: 's' + (i + 1), label, url: 'https://ice.example.com/' + i }));
  const w = loadApp({ seed: { rgxl_cfg: JSON.stringify({ streams }) } });
  w.openSettings();
  return w;
}
const warning = (w, i) => w.document.getElementById('name-warn-' + i);
const typeName = (w, i, value) => {
  const input = w.document.querySelector('#stream-editor .s-input[data-field="label"][data-idx="' + i + '"]');
  input.value = value;
  input.dispatchEvent(new w.Event('input'));
};

test('distinct names: no warning', () => {
  const w = appWith(['Jazz 88', 'Folk Alley']);
  assert.equal(warning(w, 0).hidden, true);
  assert.equal(warning(w, 1).hidden, true);
});

test('two stations with the same name both warn, whatever the case and punctuation', () => {
  const w = appWith(['Jazz 88', 'jazz-88!', 'Folk Alley']);
  assert.match(warning(w, 0).textContent, /Another station has this name too/);
  assert.equal(warning(w, 0).hidden, false);
  assert.equal(warning(w, 1).hidden, false);
  assert.equal(warning(w, 2).hidden, true);
});

test('a station named like a button on the radio warns', () => {
  for (const name of ['Stop', 'pause', 'Back 15', 'Skip 30', 'Close']) {
    const w = appWith([name, 'Folk Alley']);
    assert.match(warning(w, 0).textContent, /also has a .* button/, name);
  }
  const w = appWith(['Stop Making Sense Radio']);
  assert.equal(warning(w, 0).hidden, true, 'a name that only contains a control word is fine');
});

test('the warning follows typing: it appears and clears as the name changes', () => {
  const w = appWith(['Jazz 88', 'Folk Alley']);
  typeName(w, 1, 'Jazz 88');
  assert.equal(warning(w, 1).hidden, false);
  assert.equal(warning(w, 0).hidden, false, 'the other station of the pair warns too');
  typeName(w, 1, 'Jazz 89');
  assert.equal(warning(w, 0).hidden, true);
  assert.equal(warning(w, 1).hidden, true);
});

test('it is a warning, not a block: Apply saves duplicate names', () => {
  const w = appWith(['Jazz 88', 'Jazz 88']);
  w.applySettings();
  const saved = JSON.parse(w.localStorage.getItem('rgxl_cfg'));
  assert.deepEqual(saved.streams.map((s) => s.label), ['Jazz 88', 'Jazz 88']);
});

test('unhappy path: a name with markup in it is shown as text, never parsed', () => {
  const w = appWith(['<img src=x onerror="window.pwned=1">Stop', '<img src=x onerror="window.pwned=1">Stop']);
  const warn = warning(w, 0);
  assert.equal(warn.hidden, false);
  assert.equal(warn.querySelector('img'), null, 'no element built from the name');
  assert.equal(w.pwned, undefined);
});

test('the control names it warns about are the words the buttons actually show', () => {
  const w = appWith(['Folk Alley']);
  const shown = [...w.document.querySelectorAll('.adv-word, .close-word, .adv-text, #simple-stop-label')]
    .map((el) => w.spokenName(el.textContent)).filter(Boolean);
  assert.ok(shown.length >= 5, 'found the button words (a renamed class would leave nothing to compare)');
  for (const word of new Set(shown)) {
    assert.ok(w.eval('CONTROL_NAMES').includes(word), `"${word}" is on a button but not in CONTROL_NAMES`);
  }
});
