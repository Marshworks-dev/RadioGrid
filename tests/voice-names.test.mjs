/**
 * Say what you see (the rule: "Every control answers to a name you can say").
 *
 * Voice Control, Voice Access and Dragon press a button when someone says its
 * accessible name, and people say what they see. So every visible button's
 * name has to start with its visible text: "Tap Sleep" must find the button
 * showing "Sleep". A station button is held to its title alone: its
 * description is the button's description, not part of its name, so
 * "Tap SomaFM Groove Salad" finds it in every state.
 *
 * A real Chromium run walks every screen (walkEverything in
 * browser-harness.mjs) and reads each button's name from Chromium's own
 * accessibility tree, not from attributes, so aria-labelledby, aria-label and
 * text content all resolve the way assistive tech sees them.
 *
 * Visible text is the button's rendered text, aria-hidden included (the eye
 * can't tell), minus pictures (a station's icon, a size chip's "Aa"), with
 * symbols and emoji dropped (nobody says "💾"). Words are compared, not
 * characters, so punctuation in the name ("Groove Salad, paused") is fine.
 * A button with no visible words (a switch, a colour chip, a compact station
 * showing only its emoji) has nothing to say and is skipped here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openApp, walkEverything } from './browser-harness.mjs';

const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);

/** Each visible button's visible text, tagged so CDP can find it. */
async function visibleButtons(page) {
  return page.evaluate(() => {
    const out = [];
    let i = 0;
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      if (el.closest('[inert]')) continue;
      let text = '';
      // A station is said by its title; its description line isn't its name.
      const walk = document.createTreeWalker(el.classList.contains('stream-btn') ? el.querySelector('.btn-label') || el : el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const parent = n.parentElement;
        // What the eye sees counts, aria-hidden or not ("Stop" under the
        // square is aria-hidden but on screen). Pictures aren't words to say:
        // a station's icon (its emoji, or the initial standing in for one)
        // and the size chips' "Aa" sample of each text size.
        if (parent.closest('.btn-emoji, .size-aa')) continue;
        if (!parent.checkVisibility({ visibilityProperty: true })) continue;
        text += ' ' + n.textContent;
      }
      el.setAttribute('data-vn', String(i));
      out.push({ i, id: el.id || el.className || el.tagName, text: text.trim(), station: el.classList.contains('stream-btn') });
      i++;
    }
    return out;
  });
}

/** Chromium's computed accessible name for each tagged button. */
async function computedNames(page, cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-vn]' });
  const names = {};
  for (const nodeId of nodeIds) {
    let attributes, nodes;
    try {
      ({ attributes } = await cdp.send('DOM.getAttributes', { nodeId }));
      ({ nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false }));
    } catch (e) {
      // A re-render (the grid redraws on a status change) can drop a button
      // between listing and reading it. Gone means not on screen: skip it.
      // Anything else is a real failure.
      if (/Could not find node/.test(e.message)) continue;
      throw e;
    }
    const idx = attributes[attributes.indexOf('data-vn') + 1];
    // Ignored: outside the accessibility tree (a closing panel already
    // aria-hidden), so no voice or screen reader can reach it anyway.
    if (!nodes[0] || nodes[0].ignored) continue;
    names[idx] = (nodes[0].name && nodes[0].name.value) || '';
  }
  return names;
}

/** "name starts with visible text", word by word. Exported for the unit test below. */
export function startsWithVisible(name, visible) {
  const v = words(visible);
  const n = words(name);
  return v.every((w, k) => n[k] === w);
}

test('startsWithVisible: words in order from the start, punctuation ignored', () => {
  assert.ok(startsWithVisible('Groove Salad, paused, tap to resume', 'Groove Salad'));
  assert.ok(startsWithVisible('Export Backup', '💾 Export Backup'));
  assert.ok(!startsWithVisible('Play Groove Salad, ambient beats', 'Groove Salad ambient beats'), 'a verb in front breaks it');
  assert.ok(!startsWithVisible('Now playing: Groove Salad', 'Groove Salad'));
  assert.ok(!startsWithVisible('Groove', 'Groove Salad'), 'a name shorter than the label');
});

// Skip shows only for recordings, so the walk (live fixtures) never sees it:
// these are read from the markup instead.
test('icon controls show a word to say, and their name starts with it', () => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'RadioGridXL.html'), 'utf-8');
  const expect = {
    'id="adv-skip-back"': 'Back 15',
    'id="adv-skip-fwd"': 'Skip 30',
    'class="adv-sleep-btn"': 'Sleep',
    'id="settings-close"': 'Close',
    'id="help-close"': 'Close',
  };
  for (const [hook, word] of Object.entries(expect)) {
    const button = html.match(new RegExp('<button[^>]*' + hook + '[^>]*>[\\s\\S]*?</button>'));
    assert.ok(button, hook + ' is in the markup');
    assert.match(button[0], new RegExp('class="(adv|close)-word"[^>]*>' + word + '<'), hook + ' shows "' + word + '"');
    const label = button[0].match(/aria-label="([^"]*)"/)[1];
    assert.ok(startsWithVisible(label, word), `${hook}: "${label}" starts with "${word}"`);
  }
});

const failures = new Set();

test('every visible button on every screen is named by what it shows', { timeout: 240_000 }, async () => {
  const { page, context, close } = await openApp();
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  try {
    await walkEverything(page, context, async (step) => {
      const buttons = await visibleButtons(page);
      const names = await computedNames(page, cdp);
      for (const b of buttons) {
        if (!words(b.text).length || !(b.i in names)) continue;
        const name = names[b.i];
        if (!startsWithVisible(name, b.text)) failures.add(`${step}: [${b.id}] shows "${b.text}" but is named "${name}"`);
      }
      await page.evaluate(() => document.querySelectorAll('[data-vn]').forEach((el) => el.removeAttribute('data-vn')));
    });
  } finally {
    await close();
  }
  assert.deepEqual([...failures], [], 'buttons whose name does not start with what they show');
});
