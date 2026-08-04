import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createSecureServer } from 'node:http2';
import { createServer as createHttpsServer } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotRequest } from './request.mjs';

const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

function html(body, script = '') {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Header capture</title></head>
<body>${body}${script ? `<script>${script}</script>` : ''}</body>
</html>`;
}

export function orchestrationPage(navigationToken) {
  if (!navigationToken.endsWith('-navigation')) {
    return html('<main id="captured">captured</main>');
  }
  const runToken = navigationToken.slice(0, -'-navigation'.length);
  const ajaxToken = `${runToken}-ajax`;
  const formToken = `${runToken}-form`;
  return html(
    '<main id="running">running</main>',
    `(async () => {
  if (!window.isSecureContext) {
    throw new Error('The capture page is not a secure context');
  }
  const ajax = await fetch(
    '/capture/ajax?token=' + encodeURIComponent(${JSON.stringify(ajaxToken)}) +
      '&secure_context=' + encodeURIComponent(String(window.isSecureContext)),
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({payload: 'header-corpus'})
    }
  );
  if (!ajax.ok) throw new Error('AJAX capture failed: ' + ajax.status);
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/capture/form?token=' + encodeURIComponent(${JSON.stringify(formToken)});
  const payload = document.createElement('input');
  payload.type = 'hidden';
  payload.name = 'payload';
  payload.value = 'header-corpus';
  form.append(payload);
  document.body.append(form);
  form.submit();
})().catch((error) => {
  document.body.dataset.captureError = String(error);
  document.querySelector('main').textContent = String(error);
});`,
  );
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function persistCapture(captureDirectory, token, record) {
  await mkdir(captureDirectory, { recursive: true });
  const target = resolve(captureDirectory, `${token}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  // The server can run through sudo to bind port 443 on macOS. Captures contain
  // redacted values only, and must remain readable by the unprivileged test process.
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, target);
}

export async function createCaptureServer({
  key,
  cert,
  host = '127.0.0.1',
  port = 443,
  captureDirectory = resolve('tmp/captures'),
  protocol = 'h2',
} = {}) {
  if (!key || !cert) throw new Error('TLS key and certificate are required');
  if (!['h2', 'http1'].includes(protocol)) throw new Error('Protocol must be h2 or http1');

  const server = protocol === 'h2'
    ? createSecureServer({ key, cert, allowHTTP1: true })
    : createHttpsServer({ key, cert, ALPNProtocols: ['http/1.1'] });

  server.on('request', async (request, response) => {
    try {
      const url = new URL(request.url, 'https://app.test');
      const token = url.searchParams.get('token');

      if (url.pathname === '/health') {
        send(response, 200, 'text/plain; charset=utf-8', 'ok');
        return;
      }

      if (url.pathname.startsWith('/capture/')) {
        if (!TOKEN_PATTERN.test(token || '')) {
          send(response, 400, 'text/plain; charset=utf-8', 'invalid token');
          return;
        }
        await readBody(request);
        const record = snapshotRequest(request, token);
        await persistCapture(captureDirectory, token, record);

        if (url.pathname === '/capture/navigation') {
          send(response, 200, 'text/html; charset=utf-8', orchestrationPage(token));
        } else if (url.pathname === '/capture/ajax') {
          send(response, 200, 'application/json; charset=utf-8', '{"captured":true}');
        } else {
          send(response, 200, 'text/html; charset=utf-8', html('<main id="captured">captured</main>'));
        }
        return;
      }

      send(response, 404, 'text/plain; charset=utf-8', 'not found');
    } catch (error) {
      process.stderr.write(`capture request failed: ${error.stack || error.message}\n`);
      if (!response.headersSent) send(response, 500, 'text/plain; charset=utf-8', 'capture failed');
      else response.destroy();
    }
  });

  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolveListening);
  });

  return server;
}

async function main() {
  const keyPath = process.env.TLS_KEY;
  const certPath = process.env.TLS_CERT;
  if (!keyPath || !certPath) throw new Error('TLS_KEY and TLS_CERT must be set');

  const key = await readFile(keyPath);
  const cert = await readFile(certPath);
  const common = {
    key,
    cert,
    host: process.env.CAPTURE_HOST || '127.0.0.1',
    captureDirectory: process.env.CAPTURE_DIR || resolve('tmp/captures'),
  };
  const servers = await Promise.all([
    createCaptureServer({
      ...common,
      port: Number(process.env.CAPTURE_PORT || 443),
      protocol: 'h2',
    }),
    createCaptureServer({
      ...common,
      port: Number(process.env.CAPTURE_HTTP1_PORT || 444),
      protocol: 'http1',
    }),
  ]);

  for (const server of servers) {
    const address = server.address();
    process.stdout.write(`capture server listening on ${address.address}:${address.port}\n`);
  }

  const stop = () => {
    let remaining = servers.length;
    for (const server of servers) {
      server.close(() => {
        remaining -= 1;
        if (remaining === 0) process.exit(0);
      });
    }
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
