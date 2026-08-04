import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOTS = ['artifacts', 'manifest-fragments', 'raw', 'normalized'];
const FILES = ['manifest.json'];
const PRIVATE_KEY_MARKER = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

export async function findPrivateKeys(root = resolve('.')) {
  const findings = [];
  async function visit(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (
        entry.name === 'rootCA-key.pem' ||
        entry.name.endsWith('.key') ||
        PRIVATE_KEY_MARKER.test(await readFile(child, 'utf8'))
      ) {
        findings.push(child);
      }
    }
  }
  for (const directory of ROOTS) await visit(resolve(root, directory));
  for (const file of FILES) {
    const path = resolve(root, file);
    try {
      if (PRIVATE_KEY_MARKER.test(await readFile(path, 'utf8'))) findings.push(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return findings.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  findPrivateKeys()
    .then((findings) => {
      if (findings.length) throw new Error(`Private key found in output:\n${findings.join('\n')}`);
      process.stdout.write('No private keys found in output\n');
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
