import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from './lib/manifest.mjs';

const START = '<!-- navigation-links:start -->';
const END = '<!-- navigation-links:end -->';
const BROWSERS = [
  ['chrome', 'Google Chrome stable', 'windows-2025', 'ChromeDriver'],
  ['edge', 'Microsoft Edge stable', 'windows-2025', 'MSEdgeDriver'],
  ['firefox', 'Mozilla Firefox stable', 'ubuntu-24.04', 'GeckoDriver'],
  ['safari', 'System Safari', 'macos-15', 'SafariDriver'],
];

export async function updateReadme(root = resolve('.')) {
  const manifest = await loadManifest(root);
  const readmePath = resolve(root, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);

  if (start === -1 || end === -1 || end < start) {
    throw new Error('README navigation-link markers are missing or invalid');
  }

  const lines = [
    START,
    '| Browser | Runner | Driver | Raw `navigation-get` |',
    '|---|---|---|---|',
  ];

  for (const [browser, label, runner, driver] of BROWSERS) {
    const links = ['http1', 'http2'].map((protocol) => {
      const observation = manifest.observations.find(
        (item) =>
          item.client.name === browser
          && item.request.protocol === protocol
          && item.scenario.id === 'navigation-get',
      );

      if (observation === undefined) {
        throw new Error(`Missing ${browser}/${protocol}/navigation-get observation`);
      }

      const linkLabel = protocol === 'http1' ? 'HTTP/1.1' : 'HTTP/2';
      return `[${linkLabel}](${observation.request.raw_file})`;
    });

    lines.push(`| ${label} | \`${runner}\` | ${driver} | ${links.join(' · ')} |`);
  }

  lines.push(END);
  const replacement = lines.join('\n');
  const updated = readme.slice(0, start) + replacement + readme.slice(end + END.length);
  await writeFile(readmePath, updated);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateReadme().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
