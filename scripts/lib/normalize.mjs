function valueToArray(value) {
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

export function normalizedHeaders(headers) {
  const combined = new Map();
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    const values = combined.get(lowerName) || [];
    values.push(...valueToArray(value));
    combined.set(lowerName, values);
  }
  return Object.fromEntries(
    [...combined.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, values]) => [name, values]),
  );
}

export function normalizeObservation(observation, raw) {
  return {
    schema_version: 1,
    client: observation.client,
    environment: observation.environment,
    tls: observation.tls,
    scenario: observation.scenario,
    request: {
      http_version: raw.http_version,
      headers: normalizedHeaders(raw.headers),
    },
  };
}
