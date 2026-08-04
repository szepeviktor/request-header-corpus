import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { arch } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { By } from 'selenium-webdriver';
import { createDriver, browserNameForSelenium } from './create-driver.mjs';
import * as navigation from './scenarios/navigation-get.mjs';
import * as form from './scenarios/form-post.mjs';
import * as ajax from './scenarios/ajax-post.mjs';

export const CAPTURE_SCENARIOS = [navigation, form, ajax];
const DISPLAY_NAMES = {
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
  safari: 'safari',
};
const ENGINES = {
  chrome: 'chromium',
  edge: 'chromium',
  firefox: 'gecko',
  safari: 'webkit',
};

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function waitForCapture(path, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error(`Capture did not arrive at ${path}: ${lastError?.message || 'timeout'}`);
}

export async function verifyTrustedTls(driver, baseUrl) {
  await driver.get(`${baseUrl}/health`);
  const secureContext = await driver.executeScript('return window.isSecureContext');
  const body = await driver.findElement(By.css('body')).getText();
  const currentUrl = new URL(await driver.getCurrentUrl());
  if (secureContext !== true || body !== 'ok' || currentUrl.origin !== baseUrl) {
    throw new Error('Browser does not trust the test CA');
  }
  return true;
}

function driverVersion(capabilities, browser) {
  if (process.env.DRIVER_VERSION) return process.env.DRIVER_VERSION;
  if (browser === 'chrome') {
    return capabilities.get('chrome')?.chromedriverVersion?.split(' ')[0] || 'unknown';
  }
  if (browser === 'edge') {
    return capabilities.get('msedge')?.msedgedriverVersion?.split(' ')[0] || 'unknown';
  }
  if (browser === 'firefox') {
    return capabilities.get('moz:geckodriverVersion') || 'unknown';
  }
  return capabilities.get('safari:platformVersion') || 'system';
}

export function buildObservation({ browser, capabilities, raw, rawFile, scenario }) {
  const version = String(capabilities.get('browserVersion') || 'unknown');
  const osName = process.env.OBSERVATION_OS || `${process.platform}-${process.release.name}`;
  const headless = browser !== 'safari' && process.env.HEADLESS !== 'false';

  return {
    schema_version: 1,
    client: {
      name: DISPLAY_NAMES[browser],
      version,
      engine: ENGINES[browser],
      channel: 'stable',
      driver_version: driverVersion(capabilities, browser),
    },
    environment: {
      os: osName,
      architecture: process.env.OBSERVATION_ARCH || arch(),
      headless,
      runner_image: process.env.ImageOS || osName,
      runner_image_version: process.env.ImageVersion || 'unknown',
    },
    tls: {
      trusted_by_browser: true,
      alpn: raw.alpn,
      secure_context: true,
    },
    scenario: {
      id: scenario.id,
      method: scenario.method,
      url: `https://app.test${scenario.path}`,
    },
    request: {
      raw_file: rawFile,
      measurement_id: raw.measurement_id,
      http_version: raw.http_version,
    },
    observed_at: raw.captured_at,
  };
}

async function main() {
  const browser = option('browser', process.env.BROWSER);
  if (!DISPLAY_NAMES[browser]) {
    throw new Error('Use --browser chrome, edge, firefox, or safari');
  }

  const baseUrl = process.env.BASE_URL || 'https://app.test';
  const captureDirectory = resolve(process.env.CAPTURE_DIR || 'tmp/captures');
  const outputRoot = resolve(process.env.OUTPUT_ROOT || '.');
  const driver = await createDriver(browserNameForSelenium(browser));

  try {
    const capabilities = await driver.getCapabilities();
    if (capabilities.get('acceptInsecureCerts') === true) {
      throw new Error('Refusing to capture with acceptInsecureCerts enabled');
    }
    await verifyTrustedTls(driver, baseUrl);

    const version = safeSegment(capabilities.get('browserVersion') || 'unknown');
    const osName = safeSegment(process.env.OBSERVATION_OS || `${process.platform}-${process.release.name}`);

    for (const scenarioModule of CAPTURE_SCENARIOS) {
      const token = randomBytes(24).toString('base64url');
      const incomingPath = join(captureDirectory, `${token}.json`);
      await scenarioModule.run(driver, baseUrl, token);
      const raw = await waitForCapture(incomingPath);

      const rawRelative = join(
        'raw',
        browser,
        version,
        osName,
        `${scenarioModule.scenario.id}.json`,
      );
      const rawPath = join(outputRoot, rawRelative);
      await atomicJson(rawPath, raw);

      const observation = buildObservation({
        browser,
        capabilities,
        raw,
        rawFile: rawRelative.split('\\').join('/'),
        scenario: scenarioModule.scenario,
      });
      const observationPath = join(
        outputRoot,
        'observations',
        browser,
        version,
        osName,
        `${scenarioModule.scenario.id}.json`,
      );
      await atomicJson(observationPath, observation);
      process.stdout.write(`${relative(outputRoot, observationPath)}\n`);
    }
  } finally {
    await driver.quit();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
