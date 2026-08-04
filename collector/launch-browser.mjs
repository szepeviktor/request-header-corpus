import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BINARIES = {
  chrome: () => process.env.CHROME_BINARY || 'google-chrome',
  edge: () => process.env.EDGE_BINARY || 'microsoft-edge',
  firefox: () => process.env.FIREFOX_BINARY || 'firefox',
};

function isHeadless(browser) {
  return browser !== 'safari' && process.env.HEADLESS !== 'false';
}

export function createLaunchSpec(browser, url, profileDirectory) {
  if (browser === 'safari') {
    return {
      command: '/usr/bin/open',
      args: ['-W', '-n', '-a', 'Safari', url],
    };
  }

  const command = BINARIES[browser]?.();
  if (!command) throw new Error(`Unsupported browser: ${browser}`);
  const args = [];
  if (browser === 'chrome' || browser === 'edge') {
    if (isHeadless(browser)) args.push('--headless=new');
    args.push(
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDirectory}`,
      '--window-size=1440,1200',
    );
    if (process.platform === 'linux') {
      args.push('--no-sandbox', '--disable-dev-shm-usage');
    }
  } else {
    if (isHeadless(browser)) args.push('--headless');
    args.push('--no-remote', '--new-instance');
    if (process.env.FIREFOX_PROFILE) {
      args.push('--profile', process.env.FIREFOX_PROFILE);
    }
  }
  args.push(url);
  return { command, args };
}

async function terminate(child, browser) {
  if (child.exitCode !== null) return;
  if (browser === 'safari') {
    const killer = spawn('/usr/bin/pkill', ['-x', 'Safari'], { stdio: 'ignore' });
    await once(killer, 'exit');
  } else if (process.platform === 'win32') {
    const killer = spawn(
      'taskkill.exe',
      ['/pid', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true },
    );
    await once(killer, 'exit');
  } else {
    child.kill('SIGTERM');
  }

  if (child.exitCode !== null) return;
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

export async function launchBrowser(browser, url) {
  const profileDirectory = await mkdtemp(join(tmpdir(), `header-corpus-${browser}-`));
  const spec = createLaunchSpec(browser, url, profileDirectory);
  const child = spawn(spec.command, spec.args, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  const append = (chunk) => {
    output = `${output}${chunk}`.slice(-32_768);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (error) => append(`${error.stack || error.message}\n`));

  return {
    child,
    output: () => output,
    async stop() {
      await terminate(child, browser);
      await rm(profileDirectory, { recursive: true, force: true });
    },
  };
}

function versionFromOutput(output) {
  return String(output).match(/\d+(?:\.\d+){1,3}/)?.[0] || 'unknown';
}

export async function browserVersion(browser) {
  if (process.env.BROWSER_VERSION) return process.env.BROWSER_VERSION;
  if (browser === 'safari') {
    const { stdout } = await execFileAsync('defaults', [
      'read',
      '/Applications/Safari.app/Contents/Info',
      'CFBundleShortVersionString',
    ]);
    return stdout.trim();
  }
  const { stdout, stderr } = await execFileAsync(BINARIES[browser](), ['--version']);
  return versionFromOutput(`${stdout}\n${stderr}`);
}
