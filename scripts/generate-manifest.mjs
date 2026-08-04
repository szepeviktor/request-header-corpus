import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifestFragments } from './lib/manifest.mjs';

export async function generateManifest(
  root = resolve('.'),
  output = resolve(root, 'manifest.json'),
) {
  const manifest = await loadManifestFragments(root);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temporary, output);
  await rm(resolve(root, 'manifest-fragments'), { recursive: true, force: true });
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateManifest()
    .then((manifest) => {
      process.stdout.write(`Generated manifest with ${manifest.observations.length} observations\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
