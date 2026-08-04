import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseRawHeaders } from '../collector/raw-headers.mjs';
import { isSecretHeader } from '../collector/request.mjs';
import { listFiles, listJsonFiles, readJson } from './lib/files.mjs';

function formatErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function assertRedacted(pairs, path) {
  for (const [name, value] of pairs) {
    if (isSecretHeader(name) && value !== '[REDACTED]') {
      throw new Error(`${path}: ${name} is not redacted`);
    }
  }
}

function assertScenarioMatches(observation, headers, path) {
  const decodedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const contentType = String(decodedHeaders['content-type'] || '');
  const fetchMode = String(decodedHeaders['sec-fetch-mode'] || '').toLowerCase();
  const fetchDestination = String(decodedHeaders['sec-fetch-dest'] || '').toLowerCase();

  if (observation.scenario.id === 'form-post' &&
      !contentType.startsWith('application/x-www-form-urlencoded')) {
    throw new Error(`${path}: form POST has an unexpected content-type`);
  }
  if (observation.scenario.id === 'ajax-post' && !contentType.startsWith('application/json')) {
    throw new Error(`${path}: AJAX POST has an unexpected content-type`);
  }
  if (observation.scenario.id === 'ajax-post') {
    if (!['cors', 'same-origin'].includes(fetchMode) || fetchDestination !== 'empty') {
      throw new Error(`${path}: AJAX Fetch Metadata headers are unexpected`);
    }
    if ('sec-fetch-user' in decodedHeaders) {
      throw new Error(`${path}: AJAX request must not contain Sec-Fetch-User`);
    }
  } else if (fetchMode !== 'navigate' || fetchDestination !== 'document') {
    throw new Error(`${path}: navigation Fetch Metadata headers are unexpected`);
  }
}

export async function validateCorpus(root = resolve('.'), expectedBrowsers = []) {
  const observationSchema = JSON.parse(
    await readFile(resolve(root, 'schema/observation.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateObservation = ajv.compile(observationSchema);
  const observationPaths = await listJsonFiles(resolve(root, 'observations'));
  const scenariosByBrowser = new Map();
  const referencedRawPaths = new Set();

  for (const path of observationPaths) {
    const observation = await readJson(path);
    if (!validateObservation(observation)) {
      throw new Error(`${path}: ${formatErrors(validateObservation.errors)}`);
    }
    const rawPath = resolve(root, observation.request.raw_file);
    if (!observation.request.raw_file.includes(`/${observation.request.protocol}/`)) {
      throw new Error(`${path}: raw file path does not match the protocol`);
    }
    const expectedOrigin = observation.request.protocol === 'http2'
      ? 'https://app.test'
      : 'https://http1.app.test:444';
    if (new URL(observation.scenario.url).origin !== expectedOrigin) {
      throw new Error(`${path}: scenario URL does not match the protocol`);
    }
    referencedRawPaths.add(rawPath);
    const rawText = await readFile(rawPath, 'utf8');
    if (!rawText.endsWith('\n')) {
      throw new Error(`${rawPath}: raw header file must end with a newline`);
    }
    const { pairs, headers } = parseRawHeaders(rawText);
    if (pairs.length === 0) throw new Error(`${rawPath}: raw header file is empty`);
    const expectedProtocol = observation.request.protocol === 'http2'
      ? { version: '2.0', alpn: 'h2' }
      : { version: '1.1', alpn: 'http/1.1' };
    if (observation.request.http_version !== expectedProtocol.version ||
        observation.tls.alpn !== expectedProtocol.alpn) {
      throw new Error(`${path}: HTTP version or ALPN does not match the protocol`);
    }
    assertRedacted(pairs, rawPath);
    assertScenarioMatches(observation, headers, path);

    const corpusKey = `${observation.client.name}/${observation.request.protocol}`;
    const scenarios = scenariosByBrowser.get(corpusKey) || new Set();
    scenarios.add(observation.scenario.id);
    scenariosByBrowser.set(corpusKey, scenarios);
  }

  const rawPaths = await listFiles(resolve(root, 'raw'));
  for (const rawPath of rawPaths) {
    if (!rawPath.endsWith('.txt')) {
      throw new Error(`${rawPath}: raw directory may contain only decoded .txt header files`);
    }
    if (!referencedRawPaths.has(rawPath)) {
      throw new Error(`${rawPath}: raw header file is not referenced by an observation`);
    }
  }
  if (rawPaths.length !== referencedRawPaths.size) {
    throw new Error('One or more observations reference a missing raw header file');
  }

  const requiredScenarios = ['navigation-get', 'form-post', 'ajax-post'];
  for (const browser of expectedBrowsers) {
    for (const protocol of ['http1', 'http2']) {
      const corpusKey = `${browser}/${protocol}`;
      const scenarios = scenariosByBrowser.get(corpusKey) || new Set();
      const missing = requiredScenarios.filter((scenario) => !scenarios.has(scenario));
      if (missing.length) {
        throw new Error(`${corpusKey}: missing scenarios: ${missing.join(', ')}`);
      }
    }
  }
  return observationPaths.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const expected = (process.env.EXPECTED_BROWSERS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  validateCorpus(resolve('.'), expected)
    .then((count) => process.stdout.write(`Validated ${count} observations\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
