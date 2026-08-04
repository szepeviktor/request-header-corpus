import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';
import { CAPTURE_PROTOCOLS, CAPTURE_SCENARIOS } from '../collector/capture.mjs';
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
  const name = 'observation.schema.json';
  await writeFile(join(root, 'schema', name), await readFile(resolve('schema', name)));
}

async function writeFixture(root, browser, engine, protocol, scenario) {
  const measurementId = randomUUID();
  const version = '1.0.0';
  const os =
    browser === 'safari'
      ? 'macos-15'
      : ['chrome', 'edge'].includes(browser)
        ? 'windows-2025'
        : 'ubuntu-24.04';
  const rawRelative = `raw/${browser}/${version}/${os}/${protocol}/${scenario.id}.txt`;
  const isAjax = scenario.id === 'ajax-post';
  const isForm = scenario.id === 'form-post';
  const headers = {
    'sec-fetch-mode': isAjax ? 'same-origin' : 'navigate',
    'sec-fetch-dest': isAjax ? 'empty' : 'document',
  };
  if (isAjax) headers['content-type'] = 'application/json';
  if (isForm) headers['content-type'] = 'application/x-www-form-urlencoded';
  const rawText = `${Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')}\n`;
  const observation = {
    schema_version: 4,
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
    tls: {
      trusted_by_browser: true,
      alpn: protocol === 'http2' ? 'h2' : 'http/1.1',
      secure_context: true,
    },
    scenario: {
      id: scenario.id,
      method: scenario.method,
      url: protocol === 'http2'
        ? `https://app.test${scenario.path}`
        : `https://http1.app.test:444${scenario.path}`,
    },
    request: {
      raw_file: rawRelative,
      measurement_id: measurementId,
      http_version: protocol === 'http2' ? '2.0' : '1.1',
      protocol,
    },
    observed_at: '2026-08-04T00:00:00.000Z',
  };
  const rawPath = join(root, rawRelative);
  const observationPath = join(
    root,
    'observations',
    browser,
    version,
    os,
    protocol,
    `${scenario.id}.json`,
  );
  await mkdir(dirname(rawPath), { recursive: true });
  await mkdir(dirname(observationPath), { recursive: true });
  await writeFile(rawPath, rawText);
  await writeFile(observationPath, JSON.stringify(observation));
}

test('schema validation requires both protocols and all scenarios for every browser', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'header-corpus-schema-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await copySchemas(root);
  assert.deepEqual(
    CAPTURE_SCENARIOS.map((item) => item.scenario.id),
    ['navigation-get', 'form-post', 'ajax-post'],
  );
  for (const [browser, engine] of Object.entries(BROWSERS)) {
    for (const protocol of CAPTURE_PROTOCOLS.map(({ id }) => id)) {
      for (const scenarioModule of CAPTURE_SCENARIOS) {
        await writeFixture(root, browser, engine, protocol, scenarioModule.scenario);
      }
    }
  }
  assert.equal(await validateCorpus(root, Object.keys(BROWSERS)), 24);
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
