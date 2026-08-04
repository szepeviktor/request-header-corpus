import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRawHeaders } from '../collector/raw-headers.mjs';
import { loadManifest } from './lib/manifest.mjs';
import { normalizeObservation } from './lib/normalize.mjs';

export async function normalizeCorpus(root = resolve('.')) {
  const output = [];
  const manifest = await loadManifest(root);
  for (const observation of manifest.observations) {
    const { headers } = parseRawHeaders(
      await readFile(resolve(root, observation.request.raw_file), 'utf8'),
    );
    const raw = { http_version: observation.request.http_version, headers };
    const normalized = normalizeObservation(observation, raw);
    const outputPath = resolve(
      root,
      'normalized',
      relative(resolve(root, 'raw'), resolve(root, observation.request.raw_file))
        .replace(/\.txt$/, '.json'),
    );
    await mkdir(dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`);
    await rename(temporary, outputPath);
    output.push(outputPath);
  }
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  normalizeCorpus()
    .then((files) => process.stdout.write(`Normalized ${files.length} observations\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
