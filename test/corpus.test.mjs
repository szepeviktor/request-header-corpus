import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';
import { CAPTURE_SCENARIOS } from '../collector/capture.mjs';
import { findPrivateKeys } from '../scripts/check-private-keys.mjs';
import { validateCorpus } from '../scripts/validate.mjs';

const BROWSERS = {
  chrome: 'chromium',
  edge: 'chromium',
  firefox: 'gecko',
  safari: 'webkit',
};

async function copySchemas(root) {
  await mkdir(join(root, 'schema'), { recursive: true });
  for (const name of ['observation.schema.json', 'raw-request.schema.json']) {
    await writeFile(
      join(root, 'schema', name),
      await readFile(resolve('schema', name)),
    );
  }
}

async function writeFixture(root, browser, engine, scenario) {
  const measurementId = randomUUID();
  const version = '1.0.0';
  const os =
    browser === 'safari'
      ? 'macos-15'
      : ['chrome', 'edge'].includes(browser)
        ? 'windows-2025'
        : 'ubuntu-24.04';
  const rawRelative = `raw/${browser}/${version}/${os}/${scenario.id}.json`;
  const wireRelative = rawRelative.replace(/\.json$/, '.h2');
  const wireBytes = Buffer.concat([
    Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'),
    Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]),
    Buffer.from([0, 0, 1, 1, 5, 0, 0, 0, 1, 0x82]),
  ]);
  const isAjax = scenario.id === 'ajax-post';
  const isForm = scenario.id === 'form-post';
  const headers = {
    'sec-fetch-mode': isAjax ? 'same-origin' : 'navigate',
    'sec-fetch-dest': isAjax ? 'empty' : 'document',
  };
  if (isAjax) headers['content-type'] = 'application/json';
  if (isForm) headers['content-type'] = 'application/x-www-form-urlencoded';
  const rawHeaders = Object.entries(headers).flat();
  const raw = {
    schema_version: 2,
    measurement_id: measurementId,
    measurement_token: 'abcdefghijklmnop',
    captured_at: '2026-08-04T00:00:00.000Z',
    method: scenario.method,
    url: `${scenario.path}?token=abcdefghijklmnop`,
    http_version: '2.0',
    alpn: 'h2',
    headers,
    raw_headers: rawHeaders,
    wire_capture: {
      format: 'http2-connection-prefix-v1',
      file: wireRelative,
      connection_id: randomUUID(),
      stream_id: 1,
      byte_length: wireBytes.length,
      sha256: createHash('sha256').update(wireBytes).digest('hex'),
      target_header_frames: [{
        offset: 33,
        length: 10,
        type: 1,
        flags: 5,
        stream_id: 1,
      }],
    },
  };
  const observation = {
    schema_version: 2,
    client: {
      name: browser,
      version,
      engine,
      channel: 'stable',
      driver_version: '1.0.0',
    },
    environment: {
      os,
      architecture: 'x64',
      headless: browser !== 'safari',
      runner_image: os,
      runner_image_version: 'test',
    },
    tls: { trusted_by_browser: true, alpn: 'h2', secure_context: true },
    scenario: {
      id: scenario.id,
      method: scenario.method,
      url: `https://app.test${scenario.path}`,
    },
    request: {
      raw_file: rawRelative,
      wire_file: wireRelative,
      measurement_id: measurementId,
      http_version: '2.0',
    },
    observed_at: '2026-08-04T00:00:00.000Z',
  };
  const rawPath = join(root, rawRelative);
  const observationPath = join(root, 'observations', browser, version, os, `${scenario.id}.json`);
  await mkdir(dirname(rawPath), { recursive: true });
  await mkdir(dirname(observationPath), { recursive: true });
  await writeFile(rawPath, JSON.stringify(raw));
  await writeFile(join(root, wireRelative), wireBytes);
  await writeFile(observationPath, JSON.stringify(observation));
}

test('schema validation requires all three scenarios for every requested browser', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'header-corpus-schema-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await copySchemas(root);
  assert.deepEqual(
    CAPTURE_SCENARIOS.map((item) => item.scenario.id),
    ['navigation-get', 'form-post', 'ajax-post'],
  );
  for (const [browser, engine] of Object.entries(BROWSERS)) {
    for (const scenarioModule of CAPTURE_SCENARIOS) {
      await writeFixture(root, browser, engine, scenarioModule.scenario);
    }
  }
  assert.equal(await validateCorpus(root, Object.keys(BROWSERS)), 12);
});

test('private key guard detects key filenames in output', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'header-corpus-keys-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'raw'), { recursive: true });
  await writeFile(join(root, 'raw', 'accidental.key'), 'secret');
  const findings = await findPrivateKeys(root);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /accidental\.key$/);
});
