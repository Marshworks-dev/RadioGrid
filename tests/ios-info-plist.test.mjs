// The Capacitor template ships armv7 as a required device capability;
// App Store builds are arm64 only, so a regenerated template must not
// bring it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');

test('iOS app requires arm64, never armv7', () => {
  const caps = plist.match(/<key>UIRequiredDeviceCapabilities<\/key>\s*<array>([\s\S]*?)<\/array>/);
  assert.ok(caps, 'UIRequiredDeviceCapabilities is present');
  assert.match(caps[1], /<string>arm64<\/string>/);
  assert.doesNotMatch(caps[1], /armv7/);
});
