import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeObservation, normalizedHeaders } from '../scripts/lib/normalize.mjs';

test('normalization is deterministic and sorts case-insensitive header names', () => {
  const headers = {
    'X-Zeta': 'last',
    accept: 'text/html',
    'Sec-Fetch-Mode': 'navigate',
  };
  const first = normalizedHeaders(headers);
  const second = normalizedHeaders({ ...headers });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(Object.keys(first), ['accept', 'sec-fetch-mode', 'x-zeta']);

  const observation = {
    client: { name: 'chrome' },
    environment: { os: 'ubuntu-24.04' },
    tls: { trusted_by_browser: true },
    scenario: { id: 'navigation-get' },
    request: { protocol: 'http2' },
  };
  assert.deepEqual(
    normalizeObservation(observation, { http_version: '2.0', headers }),
    normalizeObservation(observation, { http_version: '2.0', headers }),
  );
});
