import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { connect as connectHttp2 } from 'node:http2';
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

function sendHttp2Request({ port, ca, token }) {
  return new Promise((resolve, reject) => {
    const session = connectHttp2(`https://127.0.0.1:${port}`, {
      ca,
      servername: 'app.test',
    });
    session.once('error', reject);
    const outgoing = session.request({
      ':method': 'GET',
      ':path': `/capture/navigation?token=${token}`,
      'x-order-check': 'yes',
    });
    outgoing.once('response', (headers) => {
      outgoing.resume();
      outgoing.once('end', () => {
        session.close();
        resolve(headers[':status']);
      });
    });
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

test('HTTPS capture server exposes HPACK-decoded HTTP/2 headers in order', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'header-corpus-h2-test-'));
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

  const token = 'ponmlkjihgfedcba';
  assert.equal(await sendHttp2Request({ port: server.address().port, ca: cert, token }), 200);
  const capture = JSON.parse(await readFile(join(captureDirectory, `${token}.json`), 'utf8'));
  assert.equal(capture.http_version, '2.0');
  assert.equal(capture.alpn, 'h2');
  assert.deepEqual(capture.raw_headers.slice(0, 8), [
    ':method',
    'GET',
    ':path',
    `/capture/navigation?token=${token}`,
    ':authority',
    `app.test:${server.address().port}`,
    ':scheme',
    'https',
  ]);
  const customIndex = capture.raw_headers.indexOf('x-order-check');
  assert.ok(customIndex > 6);
  assert.equal(capture.raw_headers[customIndex + 1], 'yes');
});
