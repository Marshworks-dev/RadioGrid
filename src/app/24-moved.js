/* ================================================================
   MOVED (the last build at marsh.city/radio only)
   That build carries a radiogrid-moved meta tag naming the new host, which
   the marsh.city sync injects (hosted-build.mjs markMoved) and no other build has (the Netlify
   deploy refuses a build with it). There the radio stops being a radio: the
   grid gives way to one line saying where it went, nothing plays, and
   settings opens with the steps to move it, Export Backup included, so
   nothing saved is lost. Saved keys are never touched.
   A station already playing when this build arrives is never cut off: the
   silent update only reloads while nothing plays (APP UPDATES).
   Function declarations only: init() runs before this file's top level.
   ================================================================ */

/** The new address when this is the moved build served over http(s), else ''.
    file:// (the APK) and the iOS shell never count, whatever the page holds. */
function movedTo() {
  if (!/^https?:$/.test(location.protocol)) return '';
  var meta = document.querySelector('meta[name="radiogrid-moved"]');
  var host = meta ? (meta.getAttribute('content') || '') : '';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : '';
}

/** The moved screen in place of the stations. Plain text: not a link, not a
    live region, and nothing takes focus, so it's read once in swipe order. */
function renderMoved(host) {
  document.documentElement.classList.add('is-moved');
  var main = document.getElementById('buttons');
  main.setAttribute('aria-label', 'This radio has moved');
  var line = document.createElement('p');
  line.id = 'moved-screen';
  var where = document.createElement('span');
  where.textContent = 'This radio has moved to ' + host + '.';
  var ask = document.createElement('span');
  ask.textContent = ' Please ask the person who set it up to change it.';
  line.append(where, ask);
  main.replaceChildren(line);
}

/** The card at the top of settings: the new address and the steps. */
function showMovedCard(host) {
  document.getElementById('moved-card').hidden = false;
  document.getElementById('moved-card-address').textContent = host;
  document.getElementById('moved-card-open').textContent = 'On this device, open ' + host + ' in the web browser.';
}
