import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCaptureServer } from '../collector/server.mjs';

function sendRequest({ port, ca, token }) {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: '127.0.0.1',
        port,
        path: `/capture/navigation?token=${token}`,
        method: 'GET',
        ca,
        servername: 'app.test',
        headers: {
          'X-First': 'one',
          'X-Duplicate': ['alpha', 'beta'],
          Cookie: 'session=secret',
        },
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
}

test('HTTPS capture server persists ordered raw headers and redacts secrets', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'header-corpus-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const keyPath = join(directory, 'server.key');
  const certPath = join(directory, 'server.crt');
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=app.test',
    '-addext',
    'subjectAltName=DNS:app.test,IP:127.0.0.1',
    '-days',
    '1',
    '-keyout',
    keyPath,
    '-out',
    certPath,
  ], { stdio: 'ignore' });

  const key = await readFile(keyPath);
  const cert = await readFile(certPath);
  const captureDirectory = join(directory, 'captures');
  const server = await createCaptureServer({ key, cert, port: 0, captureDirectory });
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const token = 'abcdefghijklmnop';
  assert.equal(await sendRequest({ port: server.address().port, ca: cert, token }), 200);
  const capture = JSON.parse(await readFile(join(captureDirectory, `${token}.json`), 'utf8'));
  const firstIndex = capture.raw_headers.indexOf('X-First');
  const duplicateIndex = capture.raw_headers.indexOf('X-Duplicate');
  assert.ok(firstIndex >= 0);
  assert.ok(duplicateIndex > firstIndex);
  assert.equal(capture.raw_headers[duplicateIndex + 1], 'alpha');
  assert.equal(capture.raw_headers[duplicateIndex + 3], 'beta');
  assert.equal(capture.headers.cookie, '[REDACTED]');
});
