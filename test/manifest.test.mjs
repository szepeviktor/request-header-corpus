import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateManifest } from '../scripts/generate-manifest.mjs';

function observation(browser, protocol, observedAt) {
  return {
    client: { name: browser, version: '1' },
    environment: { os: 'test' },
    request: { protocol },
    scenario: { id: 'navigation-get' },
    observed_at: observedAt,
  };
}

test('browser fragments are merged into one deterministic central manifest', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'header-corpus-manifest-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fragments = join(root, 'manifest-fragments');
  await mkdir(fragments);
  await writeFile(
    join(fragments, 'firefox.json'),
    JSON.stringify({
      observations: [observation('firefox', 'http2', '2026-08-04T02:00:00.000Z')],
    }),
  );
  await writeFile(
    join(fragments, 'chrome.json'),
    JSON.stringify({
      observations: [observation('chrome', 'http1', '2026-08-04T01:00:00.000Z')],
    }),
  );

  const manifest = await generateManifest(root);
  assert.equal(manifest.generated_at, '2026-08-04T02:00:00.000Z');
  assert.deepEqual(manifest.observations.map(({ client }) => client.name), ['chrome', 'firefox']);
  assert.deepEqual(
    JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')),
    manifest,
  );
  await assert.rejects(readFile(join(fragments, 'chrome.json')), { code: 'ENOENT' });
});
