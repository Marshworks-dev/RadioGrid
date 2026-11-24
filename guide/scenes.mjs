/**
 * Guide scenes — the steps behind every screenshot in guide/guide.md.
 *
 * Each scene starts from a fresh app (default profile, empty storage plus any
 * `seed`), replays `steps` the way a person would, then outlines `highlight`
 * and takes `shots/<id>.webp`. The same data drives two runners:
 *   - tests/guide.test.mjs replays every scene in jsdom on each `npm test`, so
 *     a UI change that breaks a step the guide describes fails the build;
 *   - guide/capture.mjs replays them in a real browser to retake screenshots.
 * Steps are plain data (not code) so both runners interpret them identically.
 *
 * Step vocabulary:
 *   { tapLogo: 5 }               tap the logo N times (opens settings while the Settings button is hidden)
 *   { pin: '1234' }              type a PIN on the PIN pad
 *   { click: '<selector>' }      tap an element
 *   { fill: '<selector>', value } type into a field (replaces its contents)
 */

export const GUIDE_PIN = '2468';

export const SCENES = [
  {
    id: 'home',
    title: 'The main screen',
    steps: [],
    highlight: '#settings-btn',
  },
  {
    id: 'settings-open',
    title: 'Settings, just opened',
    steps: [{ click: '#settings-btn' }],
    highlight: '#settings-header',
  },
  {
    id: 'pin-pad',
    title: 'The PIN pad',
    seed: { rgxl_pin: GUIDE_PIN },
    steps: [{ click: '#settings-btn' }],
    highlight: '#pin-pad',
  },
  {
    id: 'stream-url',
    title: 'A station\'s stream URL',
    steps: [{ click: '#settings-btn' }, { click: '#stream-editor .stream-entry:first-child .stream-row' }],
    highlight: '#stream-editor [data-field="url"][data-idx="0"]',
  },
  {
    id: 'station-look',
    title: 'A station\'s icon and color',
    steps: [{ click: '#settings-btn' }, { click: '#stream-editor .stream-entry:first-child .stream-row' }],
    highlight: '#stream-editor .stream-entry:first-child .color-chips',
  },
  {
    id: 'add-blank',
    title: 'A new blank station',
    steps: [
      { click: '#settings-btn' },
      { click: '#stream-add-btn' },
      { fill: '#stream-editor [data-field="label"][data-idx="2"]', value: 'My Station' },
      { fill: '#stream-editor [data-field="url"][data-idx="2"]', value: 'https://example.com/stream.mp3' },
    ],
    highlight: '#stream-editor .stream-entry:nth-child(3)',
  },
  {
    id: 'browse',
    title: 'The station browser',
    steps: [
      { click: '#settings-btn' },
      { click: '#stream-add-row .stream-browse-btn' },
    ],
    highlight: '#stream-browser-overlay .sb-shelves',
  },
  {
    id: 'reorder',
    title: 'Move and remove buttons',
    steps: [{ click: '#settings-btn' }, { click: '#stream-editor .stream-entry:nth-child(2) .stream-row' }],
    highlight: '#stream-editor .stream-entry:nth-child(2) .stream-entry-actions',
  },
  {
    id: 'theme',
    title: 'Theme',
    steps: [
      { click: '#settings-btn' },
      { click: '.theme-modes [data-mode="light"]' },
    ],
    highlight: '#theme-section',
  },
  {
    id: 'presets',
    title: 'Accessibility presets',
    steps: [{ click: '#settings-btn' }],
    highlight: '#preset-section',
  },
  {
    id: 'text-size',
    title: 'Text size',
    steps: [{ click: '#settings-btn' }],
    highlight: '#size-section',
  },
  {
    id: 'controls',
    title: 'Simple or Advanced controls',
    steps: [
      { click: '#settings-btn' },
      { click: '[data-group="advanced"][data-val="on"]' },
      { click: '#apply-btn' },
    ],
    highlight: '#adv-transport',
  },
  {
    id: 'set-pin',
    title: 'Setting a PIN',
    steps: [
      { click: '#settings-btn' },
      { fill: '#in-pin', value: GUIDE_PIN },
    ],
    highlight: '#pin-section',
  },
  {
    id: 'hide-practice',
    title: 'Practising the five taps before the button is hidden',
    steps: [
      { click: '#settings-btn' },
      { click: '#settings-panel .s-switch[data-switch="settingsButton"]' },
    ],
    highlight: '#hide-practice',
  },
  {
    id: 'hide-button',
    title: 'The Settings button, hidden',
    // A radio saved with the button hidden: the logo is the way in.
    seed: { rgxl_cfg: JSON.stringify({ settingsButton: 'off' }) },
    steps: [{ tapLogo: 5 }],
    highlight: '#settings-panel .s-switch-row:has([data-switch="settingsButton"])',
  },
  {
    id: 'backup',
    title: 'Backup and restore',
    steps: [{ click: '#settings-btn' }],
    highlight: '#backup-section',
  },
  {
    id: 'apply',
    title: 'Apply & Close',
    steps: [{ click: '#settings-btn' }],
    highlight: '#apply-btn',
  },
];

/**
 * Project-page shots — the pictures on marsh.city/projects/radiogridxl,
 * taken from the real app the same way as the guide's, so the page can't go
 * on showing an old look. Same step vocabulary; no outline. guide/capture.mjs
 * writes guide/page/<id>.webp and the sync copies them to the site, which
 * refuses to deploy while the project page points at a shot that isn't here.
 *
 * Desktop shots use the fill view at 800×600 unless `viewport` says
 * otherwise; `phone` shots use a phone's size and browser. A station's stream
 * is answered with silence, so a tap really plays: what shows is the app's
 * own playing state, not a mock-up.
 */
// Stations from across the country, all on the browser's shelves.
const station = (id, label, sub, url, emoji, color) => ({ id, label, sub, url, emoji, color });
const TWO = [
  station('mellow', 'Radio Paradise Mellow Mix', 'Soft rock and acoustic, no ads', 'https://stream.radioparadise.com/mellow-128', '🎸', 'green'),
  station('relax', 'YourClassical Relax', 'Quiet classical', 'https://relax.stream.publicradio.org/relax.mp3', '🎻', 'blue'),
];
const SIX = [
  ...TWO,
  station('jazz24', 'Jazz24', 'Jazz from Seattle', 'https://knkx-live-a.edge.audiocdn.com/6285_128k', '🎷', 'slate'),
  station('wwoz', 'WWOZ', 'Jazz and blues from New Orleans', 'https://wwoz-sc.streamguys1.com/wwoz-hi.mp3', '🎺', 'teal'),
  station('otr', 'Old Time Radio', 'Radio dramas and comedy, 1930s–50s', 'https://icecast.walmradio.com:8443/otr', '📻', 'rose'),
  station('kusc', 'Classical KUSC', 'Classical from Los Angeles', 'https://playerservices.streamtheworld.com/api/livestream-redirect/KUSCMP256.mp3', '🎼', 'purple'),
];
const cfgSeed = (cfg) => ({ rgxl_cfg: JSON.stringify({ fillview: 'on', settingsButton: 'on', ...cfg }) });

export const PAGE_SHOTS = [
  {
    id: 'grid',
    alt: 'RadioGrid: two large station buttons filling a dark screen',
    seed: cfgSeed({ theme: 'dark', streams: TWO }),
    steps: [],
    shows: '#buttons',
  },
  {
    id: 'grid-full',
    alt: 'Five stations in a grid, each with its own emoji and colour, the first spanning the top',
    // Five stations with names and descriptions, at a size with room for both.
    viewport: { width: 1024, height: 768 },
    seed: cfgSeed({ theme: 'dark', streams: SIX.slice(0, 5) }),
    steps: [],
    shows: '#buttons',
  },
  {
    id: 'phone',
    alt: 'RadioGrid on a phone: the same stations stacked to fill a narrow screen',
    phone: true,
    seed: cfgSeed({ theme: 'dark', streams: TWO }),
    steps: [],
    shows: '#buttons',
  },
  {
    id: 'now-playing',
    alt: 'A station playing: a yellow ring and speaker mark on its button, Advanced controls and a sleep timer counting down',
    seed: cfgSeed({ theme: 'dark', advanced: 'on', streams: TWO }),
    steps: [
      { live: true },
      { click: '.stream-btn' },
      { click: '.adv-sleep-btn' },
      { click: '.sleep-opt' },
    ],
    shows: '#adv-transport',
  },
  {
    id: 'settings',
    alt: 'The settings panel: presets, organisation name and themes',
    seed: cfgSeed({ theme: 'dark', streams: TWO }),
    steps: [{ click: '#settings-btn' }],
    shows: '#settings-panel',
  },
  {
    id: 'stream-browser',
    alt: 'The station browser: shelves of hand-picked stations, or a search of the Radio Browser directory',
    seed: cfgSeed({ theme: 'dark', streams: TWO }),
    steps: [
      { click: '#settings-btn' },
      { click: '#stream-add-row .stream-browse-btn' },
    ],
    shows: '#stream-browser-overlay',
  },
  {
    id: 'high-contrast',
    alt: 'High Contrast Dark at the largest text size: black buttons with white edges, the playing station solid yellow',
    seed: cfgSeed({ theme: 'contrast-dark', size: 'ultra', streams: SIX.slice(0, 4) }),
    steps: [{ click: '.stream-btn' }],
    shows: '#buttons',
  },
];
