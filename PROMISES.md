# Promises

What RadioGridXL promises the people who use it, for as long as it exists. Only Jason changes this file. Format and rules: ~/JasonsWorkspace/.claude/rules/promises.md.

- Nothing about you, your stations or your listening leaves the device. The only outside requests are the stream you play, station searches the setter-up runs on Radio Browser, and the how-to guide when someone opens it · why: families and listeners trust a radio not to report on them · check: test:tests/promise-no-egress.test.mjs
- Paused or stopped audio never restarts on its own · why: a radio paused at bedtime must stay silent · check: test:tests/playback.test.mjs
- With Reduce Motion on, nothing moves · why: motion can make some listeners unwell or lose their place · check: test:tests/promise-reduced-motion.test.mjs
- Works with no internet for everything except playing streams, searching and the how-to guide: no outside script, style or font · why: the radio has to start without the web · check: test:smoke-test.mjs
- The radio never opens a website, another app or a new window; the how-to guide opens inside it · why: a listener who taps the wrong thing still has a radio in front of them · check: test:tests/promise-stays-radio.test.mjs
- Text meets WCAG AA in every theme and 7:1 in High Contrast · why: low-vision listeners · check: test:tests/contrast.test.mjs
