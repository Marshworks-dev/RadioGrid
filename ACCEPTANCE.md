# Tiles play, Stop stops

Status: draft

Intent: Each control has one job. A station tile plays that station; the bottom bar stops it. Today a second tap on the playing tile pauses it, which is the tap this audience makes most by mistake: a tremor, or a second try while the station takes a few seconds to start. On live radio that "pause" was a stop underneath anyway (the connection drops, and resume reconnects at the live point, so some stations sound like they restart), and the Simple bar turned into "Resume <station>", a second job for the bar. After this change the screen shows a station as on or off, nothing in between, and the rule a caregiver tells the listener holds for every station: "Tap a station to play. Tap Stop to stop."

## Done when: a tile only plays

- [test] Tapping an idle tile plays it, as today.
- [test] Tapping the playing tile leaves the audio alone: no reload, no chime, no voice, no pause. The tile flashes, and the Stop bar (Simple) or the Stop button (Advanced) shows a still highlight for about two seconds, pointing at where "off" lives. Nothing moves, with or without Reduce Motion.
- [test] Unhappy path: three quick taps on a station while it is still starting load it once, and it goes on to play. Five taps on a playing station cause no reload and no silence.
- [test] A tap on a tile that reads "Reconnecting…" tries again at once, and a tile that reads "Not available" tries again, as today. A tap on a different tile switches station, as today.
- [test] A tile that is starting reads "Starting…" where its description goes, until sound arrives.
- [test] A playing tile shows a still "playing" mark (a speaker) in place of ▮▮, and no tile shows ▮▮, ■ or ▶. The mark meets 3:1 against the tile in every colour and theme (`tests/contrast.test.mjs`) and shows when descriptions are hidden.
- [test] Screen readers: the playing tile is marked as the current station (`aria-current`), not as a toggle (`aria-pressed`), and its name stays the station's own name, so Voice Control "Tap <station>" still presses it. `/a11y-smoke` passes and its saved transcript is updated.

## Done when: Stop only stops

- [test] The Simple bar always reads Stop and always stops. It never reads "Resume …". It looks idle when nothing is playing.
- [test] In Advanced mode a live station shows Stop and no Pause button. A recording shows Pause, Back 15 and Skip 30, and its Pause and Resume work as today.

## Done when: interruptions read as off

- [test] A pause the phone makes (a call, Siri, another app taking the audio, the lock-screen pause) or a launch whose auto-resume the browser blocked: the tile is unlit and reads "Tap to play", no tile shows a dashed ring, and the Simple bar looks idle. One tap on the tile plays it; the lock screen's Play plays it; Stop clears it to off.
- [test] The promise holds: paused or stopped audio never restarts on its own (`tests/playback.test.mjs` and its PROMISES.md breaker).

## Done when: recordings keep their place

- [test] Stopping a recording in Simple mode (Stop, or switching station) and tapping it again carries on from where it stopped, as long as the app stays open. A recording that reached its end starts over. Live radio is unaffected.

## Done when: the guide and the project page say so

- [test] `guide/guide.md` describes the new rule (tap to play, Stop to stop; a station cut off by a call reads "Tap to play"), its Voice Control lines match, and no line says a tap pauses. `tests/guide.test.mjs` passes, and `npm run guide:capture` retakes the guide and project-page shots with the new playing mark.
- [test] The marsh.city project page (`src/content/projects/radiogridxl.md`) gets an Updates entry for this version, written for a caregiver, and its description of the controls matches.
- [smoke] After the deploy, radio.marshworks.dev on a phone: play a live station, tap it again (it keeps playing and Stop lights up), press Stop (it stops).
- [manual] Jason: the playing mark and the Stop highlight read right on the phone, in a light and a dark theme.
- [manual] Jason: on an iPhone, lock-screen pause, wait a minute, lock-screen play, in Safari and the home-screen app: the controls are still there and the station plays.

Ships as a minor.

Decided 2026-11-24, after an expert panel (all seven picked this): tiles only play, Stop only stops, no settings switch for now. Build the switch ("Tap the playing station to stop it", off by default, behind the PIN, a real stop, never a pause) only when a named listener can't reach or scan to Stop or can't relearn within two weeks, or a facility asks for it by name.

## Out of scope
- The settings switch above, until its trigger happens.
- A new voice line on the second tap: on iOS the app's own voice pauses the stream, which would cause the silence this removes.
- Time-shifted pause on live radio. iOS stops downloading a paused stream, and most stations don't allow the cross-site access the app would need to hold the audio.
- Remembering a recording's place across app launches. The place lives only while the app is open, so no saved key changes.
- Changing how the app tells live radio from a recording (`noteLiveness()`).
- Changing lock-screen pause itself. If the iPhone check above finds the controls disappear, that's a separate fix.
- `PROMISES.md`. Only Jason changes that file, and this work needs no change to it.
