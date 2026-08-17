import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { updateReadme } from '../scripts/update-readme.mjs';

test('README navigation links follow the current manifest paths', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'header-corpus-readme-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const observations = [];

  const browserRows = [
    ['chrome', 'windows-2025'],
    ['chrome', 'macos-15'],
    ['edge', 'windows-2025'],
    ['firefox', 'ubuntu-24.04'],
    ['safari', 'macos-15'],
  ];

  for (const [browser, os] of browserRows) {
    for (const protocol of ['http1', 'http2']) {
      observations.push({
        client: { name: browser },
        environment: { os },
        request: {
          protocol,
          raw_file: `raw/${browser}/1/${os}/${protocol}/navigation-get.txt`,
        },
        scenario: { id: 'navigation-get' },
      });
    }
  }

  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify({ schema_version: 1, observations }),
  );
  await writeFile(
    join(root, 'README.md'),
    'Before\n<!-- navigation-links:start -->\nold\n<!-- navigation-links:end -->\nAfter\n',
  );

  await updateReadme(root);
  const readme = await readFile(join(root, 'README.md'), 'utf8');

  assert.match(
    readme,
    /\[HTTP\/1\.1\]\(raw\/chrome\/1\/windows-2025\/http1\/navigation-get\.txt\)/,
  );
  assert.match(
    readme,
    /\[HTTP\/1\.1\]\(raw\/chrome\/1\/macos-15\/http1\/navigation-get\.txt\)/,
  );
  assert.match(readme, /\[HTTP\/2\]\(raw\/safari\/1\/macos-15\/http2\/navigation-get\.txt\)/);
  assert.match(readme, /^Before\n/);
  assert.match(readme, /\nAfter\n$/);
});
