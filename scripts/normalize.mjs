import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJsonFiles, readJson } from './lib/files.mjs';
import { normalizeObservation } from './lib/normalize.mjs';

export async function normalizeCorpus(root = resolve('.')) {
  const observationsDirectory = resolve(root, 'observations');
  const output = [];
  for (const observationPath of await listJsonFiles(observationsDirectory)) {
    const observation = await readJson(observationPath);
    const raw = await readJson(resolve(root, observation.request.raw_file));
    const normalized = normalizeObservation(observation, raw);
    const outputPath = resolve(
      root,
      'normalized',
      relative(observationsDirectory, observationPath),
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
