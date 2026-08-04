import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJsonFiles, readJson } from './lib/files.mjs';
import { normalizedHeaders } from './lib/normalize.mjs';

const WATCHED = new Set([
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user',
  'origin',
  'content-type',
  'user-agent',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
]);

function compareHeaders(current, previous) {
  const currentNames = new Set(Object.keys(current));
  const previousNames = new Set(Object.keys(previous || {}));
  const added = [...currentNames].filter((name) => !previousNames.has(name)).sort();
  const removed = [...previousNames].filter((name) => !currentNames.has(name)).sort();
  const changed = [...currentNames]
    .filter(
      (name) =>
        previousNames.has(name) &&
        JSON.stringify(current[name]) !== JSON.stringify(previous[name]),
    )
    .sort();
  return { added, removed, changed, current, previous: previous || {} };
}

function displayChanges(diff) {
  const format = (names) =>
    names.length
      ? names.map((name) => (WATCHED.has(name) ? `**${name}**` : name)).join(', ')
      : '—';
  const changed = diff.changed.length
    ? diff.changed
        .map((name) => {
          const label = WATCHED.has(name) ? `**${name}**` : name;
          const before = JSON.stringify(diff.previous[name]);
          const after = JSON.stringify(diff.current[name]);
          return `${label}: ${before} → ${after}`;
        })
        .join('<br>')
        .replaceAll('|', '\\|')
    : '—';
  return {
    added: format(diff.added),
    removed: format(diff.removed),
    changed,
  };
}

export async function renderReport(root = resolve('.')) {
  const entries = [];
  for (const path of await listJsonFiles(resolve(root, 'observations'))) {
    const observation = await readJson(path);
    const raw = await readJson(resolve(root, observation.request.raw_file));
    entries.push({
      observation,
      raw,
      normalized: normalizedHeaders(raw.headers),
    });
  }

  entries.sort(
    (left, right) =>
      left.observation.client.name.localeCompare(right.observation.client.name) ||
      left.observation.scenario.id.localeCompare(right.observation.scenario.id) ||
      left.observation.observed_at.localeCompare(right.observation.observed_at),
  );

  const lines = [
    '# Latest browser header observations',
    '',
    `Generated from ${entries.length} validated observation(s).`,
    '',
    '| Browser | Version | OS | Scenario | HTTP | ALPN | Header names | Added | Removed | Changed |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  const history = new Map();
  for (const entry of entries) {
    const { observation, raw, normalized } = entry;
    const key = [
      observation.client.name,
      observation.environment.os,
      observation.scenario.id,
    ].join('/');
    const previous = history.get(key);
    const diff = displayChanges(compareHeaders(normalized, previous?.normalized));
    history.set(key, entry);
    const names = Object.keys(normalized).join(', ');
    lines.push(
      `| ${observation.client.name} | ${observation.client.version} | ${observation.environment.os} | ` +
        `${observation.scenario.id} | ${raw.http_version} | ${raw.alpn || '—'} | ${names || '—'} | ` +
        `${diff.added} | ${diff.removed} | ${diff.changed} |`,
    );
  }
  lines.push('', 'Watched security/context headers are shown in **bold** when changed.', '');
  return lines.join('\n');
}

export async function generateReport(root = resolve('.'), output = resolve(root, 'reports/latest.md')) {
  const report = await renderReport(root);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, report);
  await rename(temporary, output);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateReport()
    .then((path) => process.stdout.write(`Generated ${path}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
