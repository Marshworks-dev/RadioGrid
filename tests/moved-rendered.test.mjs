/**
 * The moved card and screen as Chromium paints them. jsdom applies no CSS,
 * so it saw the card's `hidden` attribute and passed while `.s-group
 * { display: flex }` showed an empty card at the top of every radio's
 * settings. Needs the sandbox off, like the other Chromium checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, APP_ORIGIN } from './browser-harness.mjs';

test('a normal radio never paints the moved card or screen; the old address paints both and no Stop — unhappy path first', async () => {
  const { page, close } = await openApp({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  try {
    assert.equal(await page.isVisible('.stream-btn >> nth=0'), true);
    assert.equal(await page.isVisible('#simple-stop'), true);
    assert.equal(await page.isVisible('#moved-screen'), false);
    await page.evaluate(() => window.openSettings());
    // Painted, not just opening: a panel mid-transition reads as invisible,
    // which would let the "no card" check pass for the wrong reason.
    await page.waitForSelector('#g-stations', { state: 'visible' });
    assert.equal(await page.isVisible('#moved-card'), false, 'no moved card in a normal radio\'s settings');
    await page.evaluate(() => window.closeSettings());

    await page.goto(APP_ORIGIN + '/?moved');
    await page.waitForSelector('#moved-screen');
    assert.equal(await page.isVisible('#moved-screen'), true);
    assert.equal(await page.isVisible('#simple-stop'), false, 'no Stop where nothing can play');
    assert.equal(await page.isVisible('#adv-transport'), false);
    await page.evaluate(() => window.openSettings());
    // Painted, not just opening: a panel mid-transition reads as invisible,
    // which would let the "no card" check pass for the wrong reason.
    await page.waitForSelector('#g-stations', { state: 'visible' });
    assert.equal(await page.isVisible('#moved-card'), true);
    assert.equal(await page.textContent('#moved-card-address'), 'radio.marshworks.dev');
    // The station browser lists stations, with no preview buttons to press.
    await page.evaluate(() => window.openStreamBrowser());
    await page.evaluate(() => window.openShelf(document.querySelector('.sb-shelf').dataset.shelf));
    await page.waitForSelector('#sb-results .sb-result-add');
    assert.equal(await page.isVisible('#sb-results .sb-result-play >> nth=0'), false, 'no preview button at the old address');
  } finally {
    await close();
  }
});
