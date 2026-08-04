import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export function sortObservations(observations) {
  return [...observations].sort(
    (left, right) =>
      left.client.name.localeCompare(right.client.name) ||
      left.client.version.localeCompare(right.client.version) ||
      left.environment.os.localeCompare(right.environment.os) ||
      left.request.protocol.localeCompare(right.request.protocol) ||
      left.scenario.id.localeCompare(right.scenario.id),
  );
}

export function buildManifest(observations) {
  const sorted = sortObservations(observations);
  if (sorted.length === 0) throw new Error('Cannot generate an empty manifest');
  return {
    schema_version: 1,
    generated_at: sorted
      .map(({ observed_at: observedAt }) => observedAt)
      .sort()
      .at(-1),
    observations: sorted,
  };
}

export async function loadManifestFragments(root = resolve('.')) {
  const directory = resolve(root, 'manifest-fragments');
  const names = await readdir(directory);
  const observations = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    const fragment = JSON.parse(await readFile(join(directory, name), 'utf8'));
    observations.push(...fragment.observations);
  }
  return buildManifest(observations);
}

export async function loadManifest(root = resolve('.')) {
  try {
    return JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return loadManifestFragments(root);
  }
}
