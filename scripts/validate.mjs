import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { isSecretHeader } from '../collector/request.mjs';
import { listJsonFiles, readJson } from './lib/files.mjs';

function formatErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function assertRedacted(raw, path) {
  for (const [name, value] of Object.entries(raw.headers)) {
    if (isSecretHeader(name) && value !== '[REDACTED]') {
      throw new Error(`${path}: ${name} is not redacted`);
    }
  }
  if (raw.raw_headers.length % 2 !== 0) {
    throw new Error(`${path}: raw_headers must contain name/value pairs`);
  }
  for (let index = 0; index < raw.raw_headers.length; index += 2) {
    if (isSecretHeader(raw.raw_headers[index]) && raw.raw_headers[index + 1] !== '[REDACTED]') {
      throw new Error(`${path}: raw ${raw.raw_headers[index]} is not redacted`);
    }
  }
}

function assertScenarioMatches(observation, raw, path) {
  if (raw.method !== observation.scenario.method) {
    throw new Error(`${path}: captured method does not match scenario`);
  }
  const capturedPath = new URL(raw.url, 'https://app.test').pathname;
  if (capturedPath !== new URL(observation.scenario.url).pathname) {
    throw new Error(`${path}: captured URL does not match scenario`);
  }

  const headers = Object.fromEntries(
    Object.entries(raw.headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const contentType = String(headers['content-type'] || '');
  const fetchMode = String(headers['sec-fetch-mode'] || '').toLowerCase();
  const fetchDestination = String(headers['sec-fetch-dest'] || '').toLowerCase();

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
    if ('sec-fetch-user' in headers) {
      throw new Error(`${path}: AJAX request must not contain Sec-Fetch-User`);
    }
  } else if (fetchMode !== 'navigate' || fetchDestination !== 'document') {
    throw new Error(`${path}: navigation Fetch Metadata headers are unexpected`);
  }
}

async function assertWireCapture(root, observation, raw, path) {
  if (raw.http_version !== '2.0' || raw.alpn !== 'h2') {
    throw new Error(`${path}: byte-exact capture requires HTTP/2 over ALPN h2`);
  }
  if (observation.request.wire_file !== raw.wire_capture.file) {
    throw new Error(`${path}: wire capture references do not match`);
  }

  const wirePath = resolve(root, observation.request.wire_file);
  const bytes = await readFile(wirePath);
  if (bytes.length !== raw.wire_capture.byte_length) {
    throw new Error(`${wirePath}: byte length does not match metadata`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== raw.wire_capture.sha256) {
    throw new Error(`${wirePath}: SHA-256 does not match metadata`);
  }
  if (!bytes.subarray(0, 24).equals(Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'))) {
    throw new Error(`${wirePath}: HTTP/2 client preface is missing`);
  }

  for (const frame of raw.wire_capture.target_header_frames) {
    if (frame.stream_id !== raw.wire_capture.stream_id) {
      throw new Error(`${wirePath}: target header frame has the wrong stream ID`);
    }
    if (frame.offset + frame.length > bytes.length) {
      throw new Error(`${wirePath}: target header frame is outside the capture`);
    }
    const payloadLength = bytes.readUIntBE(frame.offset, 3);
    const type = bytes[frame.offset + 3];
    const flags = bytes[frame.offset + 4];
    const streamId = bytes.readUInt32BE(frame.offset + 5) & 0x7fffffff;
    if (frame.length !== payloadLength + 9 ||
        frame.type !== type ||
        frame.flags !== flags ||
        frame.stream_id !== streamId) {
      throw new Error(`${wirePath}: target header frame metadata does not match its bytes`);
    }
  }
}

export async function validateCorpus(root = resolve('.'), expectedBrowsers = []) {
  const observationSchema = JSON.parse(
    await readFile(resolve(root, 'schema/observation.schema.json'), 'utf8'),
  );
  const rawSchema = JSON.parse(
    await readFile(resolve(root, 'schema/raw-request.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateObservation = ajv.compile(observationSchema);
  const validateRaw = ajv.compile(rawSchema);
  const observationPaths = await listJsonFiles(resolve(root, 'observations'));
  const scenariosByBrowser = new Map();

  for (const path of observationPaths) {
    const observation = await readJson(path);
    if (!validateObservation(observation)) {
      throw new Error(`${path}: ${formatErrors(validateObservation.errors)}`);
    }
    const rawPath = resolve(root, observation.request.raw_file);
    const raw = await readJson(rawPath);
    if (!validateRaw(raw)) {
      throw new Error(`${rawPath}: ${formatErrors(validateRaw.errors)}`);
    }
    if (raw.measurement_id !== observation.request.measurement_id) {
      throw new Error(`${path}: measurement IDs do not match`);
    }
    assertRedacted(raw, rawPath);
    assertScenarioMatches(observation, raw, path);
    await assertWireCapture(root, observation, raw, path);

    const scenarios = scenariosByBrowser.get(observation.client.name) || new Set();
    scenarios.add(observation.scenario.id);
    scenariosByBrowser.set(observation.client.name, scenarios);
  }

  const requiredScenarios = ['navigation-get', 'form-post', 'ajax-post'];
  for (const browser of expectedBrowsers) {
    const scenarios = scenariosByBrowser.get(browser) || new Set();
    const missing = requiredScenarios.filter((scenario) => !scenarios.has(scenario));
    if (missing.length) throw new Error(`${browser}: missing scenarios: ${missing.join(', ')}`);
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
