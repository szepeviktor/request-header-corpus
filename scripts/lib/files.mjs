import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function listJsonFiles(directory) {
  const files = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
    }
  }
  await visit(directory);
  return files.sort();
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
