import assert from 'node:assert/strict';
import test from 'node:test';
import { createLaunchSpec } from '../collector/launch-browser.mjs';

test('Chromium browsers launch directly without a WebDriver', () => {
  const previous = process.env.CHROME_BINARY;
  process.env.CHROME_BINARY = '/browser/chrome';
  try {
    const spec = createLaunchSpec('chrome', 'https://app.test/run', '/tmp/profile');
    assert.equal(spec.command, '/browser/chrome');
    assert.ok(spec.args.includes('--headless=new'));
    assert.ok(spec.args.includes('--user-data-dir=/tmp/profile'));
    assert.equal(spec.args.at(-1), 'https://app.test/run');
    assert.doesNotMatch(spec.args.join(' '), /driver|selenium/i);
  } finally {
    if (previous === undefined) delete process.env.CHROME_BINARY;
    else process.env.CHROME_BINARY = previous;
  }
});

test('Safari launches through macOS without safaridriver', () => {
  const spec = createLaunchSpec('safari', 'https://app.test/run', '/tmp/profile');
  assert.equal(spec.command, '/usr/bin/open');
  assert.deepEqual(spec.args.slice(0, 5), ['-W', '-n', '-a', 'Safari', 'https://app.test/run']);
});
