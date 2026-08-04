import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { arch } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserVersion, launchBrowser } from './launch-browser.mjs';
import { formatRawHeaders } from './raw-headers.mjs';

export const CAPTURE_SCENARIOS = [
  { id: 'navigation-get', method: 'GET', path: '/capture/navigation' },
  { id: 'form-post', method: 'POST', path: '/capture/form' },
  { id: 'ajax-post', method: 'POST', path: '/capture/ajax' },
];
export const CAPTURE_PROTOCOLS = [
  {
    id: 'http2',
    baseUrl: () => process.env.BASE_URL || 'https://app.test',
    httpVersion: '2.0',
    alpn: 'h2',
  },
  {
    id: 'http1',
    baseUrl: () => process.env.HTTP1_BASE_URL || 'https://http1.app.test:444',
    httpVersion: '1.1',
    alpn: 'http/1.1',
  },
];
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

async function atomicText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, path);
}

async function waitForCapture(path, browserProcess, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      lastError = error;
    }
    if (browserProcess.child.exitCode !== null) {
      throw new Error(
        `Browser exited before ${path} arrived (exit ${browserProcess.child.exitCode})\n` +
          browserProcess.output(),
      );
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(
    `Capture did not arrive at ${path}: ${lastError?.message || 'timeout'}\n` +
      browserProcess.output(),
  );
}

export function assertCapture(raw, scenario, protocol) {
  const url = new URL(raw.url, 'https://app.test');
  if (raw.method !== scenario.method || url.pathname !== scenario.path) {
    throw new Error(
      `Captured ${raw.method} ${url.pathname}, expected ${scenario.method} ${scenario.path}`,
    );
  }
  if (raw.http_version !== protocol.httpVersion || raw.alpn !== protocol.alpn) {
    throw new Error(
      `Capture negotiated ${raw.http_version}/${raw.alpn}, ` +
        `expected ${protocol.httpVersion}/${protocol.alpn}`,
    );
  }
  if (
    scenario.id === 'ajax-post' &&
    url.searchParams.get('secure_context') !== 'true'
  ) {
    throw new Error('Browser did not report a secure context');
  }
}

export function buildObservation({
  browser,
  version,
  raw,
  rawFile,
  scenario,
  protocol,
  baseUrl,
}) {
  const osName = process.env.OBSERVATION_OS || `${process.platform}-${process.release.name}`;
  const headless = browser !== 'safari' && process.env.HEADLESS !== 'false';

  return {
    client: {
      name: DISPLAY_NAMES[browser],
      version,
      engine: ENGINES[browser],
      channel: 'stable',
      launch_method: 'direct',
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
      url: `${baseUrl}${scenario.path}`,
    },
    request: {
      raw_file: rawFile,
      measurement_id: raw.measurement_id,
      http_version: raw.http_version,
      protocol: protocol.id,
    },
    observed_at: raw.captured_at,
  };
}

function scenarioTokens(runToken) {
  return {
    'navigation-get': `${runToken}-navigation`,
    'form-post': `${runToken}-form`,
    'ajax-post': `${runToken}-ajax`,
  };
}

async function main() {
  const browser = option('browser', process.env.BROWSER);
  if (!DISPLAY_NAMES[browser]) {
    throw new Error('Use --browser chrome, edge, firefox, or safari');
  }

  const captureDirectory = resolve(process.env.CAPTURE_DIR || 'tmp/captures');
  const outputRoot = resolve(process.env.OUTPUT_ROOT || '.');
  const version = safeSegment(await browserVersion(browser));
  const osName = safeSegment(
    process.env.OBSERVATION_OS || `${process.platform}-${process.release.name}`,
  );
  const observations = [];

  for (const protocol of CAPTURE_PROTOCOLS) {
    const baseUrl = protocol.baseUrl();
    const runToken = randomBytes(24).toString('base64url');
    const tokens = scenarioTokens(runToken);
    const navigationUrl =
      `${baseUrl}/capture/navigation?token=${encodeURIComponent(tokens['navigation-get'])}`;
    const browserProcess = await launchBrowser(browser, navigationUrl);

    try {
      for (const scenario of CAPTURE_SCENARIOS) {
        const incomingPath = join(captureDirectory, `${tokens[scenario.id]}.json`);
        const raw = await waitForCapture(incomingPath, browserProcess);
        assertCapture(raw, scenario, protocol);

        const rawRelative = join(
          'raw',
          browser,
          version,
          osName,
          protocol.id,
          `${scenario.id}.txt`,
        );
        const rawPath = join(outputRoot, rawRelative);
        await atomicText(rawPath, formatRawHeaders(raw.raw_headers));

        observations.push(buildObservation({
          browser,
          version,
          raw,
          rawFile: rawRelative.split('\\').join('/'),
          scenario,
          protocol,
          baseUrl,
        }));
        process.stdout.write(`${relative(outputRoot, rawPath)}\n`);
      }
    } finally {
      await browserProcess.stop();
    }
  }

  const fragmentPath = join(outputRoot, 'manifest-fragments', `${browser}.json`);
  await atomicJson(fragmentPath, { observations });
  process.stdout.write(`${relative(outputRoot, fragmentPath)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
