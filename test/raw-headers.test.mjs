import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRawHeaders, parseRawHeaders } from '../collector/raw-headers.mjs';

test('raw header text preserves HPACK-decoded order and duplicates', () => {
  const rawHeaders = [
    ':method', 'GET',
    'x-first', 'one',
    'x-duplicate', 'alpha',
    'x-duplicate', 'beta',
    'accept', 'text/html',
  ];

  const text = formatRawHeaders(rawHeaders);
  assert.equal(
    text,
    ':method: GET\n' +
      'x-first: one\n' +
      'x-duplicate: alpha\n' +
      'x-duplicate: beta\n' +
      'accept: text/html\n',
  );

  const parsed = parseRawHeaders(text);
  assert.deepEqual(parsed.pairs, [
    [':method', 'GET'],
    ['x-first', 'one'],
    ['x-duplicate', 'alpha'],
    ['x-duplicate', 'beta'],
    ['accept', 'text/html'],
  ]);
  assert.deepEqual(parsed.headers['x-duplicate'], ['alpha', 'beta']);
});
