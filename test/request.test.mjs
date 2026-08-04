import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotRequest } from '../collector/request.mjs';

test('request snapshot preserves raw header order and duplicates', () => {
  const request = {
    method: 'POST',
    url: '/capture/ajax?token=abcdefghijklmnop',
    httpVersion: '2.0',
    headers: {
      host: 'app.test',
      cookie: 'session=secret',
      authorization: 'Bearer secret',
    },
    rawHeaders: [
      'Host',
      'app.test',
      'X-Duplicate',
      'first',
      'x-duplicate',
      'second',
      'Cookie',
      'session=secret',
      'Authorization',
      'Bearer secret',
    ],
    socket: { alpnProtocol: 'h2' },
  };

  const snapshot = snapshotRequest(request, 'abcdefghijklmnop', new Date('2026-08-04T00:00:00Z'));
  assert.deepEqual(snapshot.raw_headers.slice(0, 6), [
    'Host',
    'app.test',
    'X-Duplicate',
    'first',
    'x-duplicate',
    'second',
  ]);
  assert.equal(snapshot.headers.cookie, '[REDACTED]');
  assert.equal(snapshot.headers.authorization, '[REDACTED]');
  assert.equal(snapshot.raw_headers[7], '[REDACTED]');
  assert.equal(snapshot.raw_headers[9], '[REDACTED]');
});
