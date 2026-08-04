import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttp2Server } from 'node:http2';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { createServer as createTlsServer } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { Http2WireCapture } from './h2-wire-capture.mjs';
import { snapshotRequest } from './request.mjs';

const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

function html(body, script = '') {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Header capture</title></head>
<body>${body}${script ? `<script>${script}</script>` : ''}</body>
</html>`;
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
} = {}) {
  if (!key || !cert) throw new Error('TLS key and certificate are required');

  await mkdir(captureDirectory, { recursive: true });

  const connectionCaptures = new WeakMap();
  const pendingConnections = {
    h2: [],
    'http/1.1': [],
  };
  const pendingHttp2Sessions = [];

  const handleRequest = async (request, response) => {
    try {
      const url = new URL(request.url, 'https://app.test');
      const token = url.searchParams.get('token');

      if (url.pathname === '/health') {
        send(response, 200, 'text/plain; charset=utf-8', 'ok');
        return;
      }

      if (url.pathname === '/scenario/form') {
        if (!TOKEN_PATTERN.test(token || '')) {
          send(response, 400, 'text/plain; charset=utf-8', 'invalid token');
          return;
        }
        send(
          response,
          200,
          'text/html; charset=utf-8',
          html(`<form method="post" action="/capture/form?token=${encodeURIComponent(token)}">
  <input type="hidden" name="payload" value="header-corpus">
  <button id="submit" type="submit">Submit</button>
</form>`),
        );
        return;
      }

      if (url.pathname === '/scenario/ajax') {
        if (!TOKEN_PATTERN.test(token || '')) {
          send(response, 400, 'text/plain; charset=utf-8', 'invalid token');
          return;
        }
        send(response, 200, 'text/html; charset=utf-8', html('<main id="ready">ready</main>'));
        return;
      }

      if (url.pathname.startsWith('/capture/')) {
        if (!TOKEN_PATTERN.test(token || '')) {
          send(response, 400, 'text/plain; charset=utf-8', 'invalid token');
          return;
        }
        await readBody(request);
        const protocol = request.httpVersion === '2.0' ? 'h2' : 'http/1.1';
        const backendConnection = request.httpVersion === '2.0'
          ? request.stream.session
          : request.socket;
        const wireRecorder = connectionCaptures.get(backendConnection);
        const wireCapture = protocol === 'h2'
          ? await wireRecorder?.persistStreamPrefix(captureDirectory, token, request.stream.id)
          : undefined;
        if (protocol === 'h2' && !wireCapture) {
          throw new Error('Missing HTTP/2 wire recorder');
        }
        const record = snapshotRequest(request, token, new Date(), {
          alpn: protocol,
          wireCapture,
        });
        await persistCapture(captureDirectory, token, record);

        if (url.pathname === '/capture/ajax') {
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
  };

  const backendServers = {
    h2: createHttp2Server(),
    'http/1.1': createHttpServer(),
  };
  backendServers.h2.on('request', handleRequest);
  backendServers.h2.on('session', (session) => {
    const recorder = pendingHttp2Sessions.shift();
    if (recorder) connectionCaptures.set(session, recorder);
  });
  backendServers['http/1.1'].on('request', handleRequest);

  for (const [protocol, backendServer] of Object.entries(backendServers)) {
    backendServer.prependListener('connection', (socket) => {
      const recorder = pendingConnections[protocol].shift();
      if (recorder) {
        connectionCaptures.set(socket, recorder);
        if (protocol === 'h2') pendingHttp2Sessions.push(recorder);
      }
    });
    await new Promise((resolveListening, reject) => {
      backendServer.once('error', reject);
      backendServer.listen(0, '127.0.0.1', resolveListening);
    });
  }

  const openTlsSockets = new Set();
  const server = createTlsServer({
    key,
    cert,
    ALPNProtocols: ['h2', 'http/1.1'],
  });

  server.on('secureConnection', (tlsSocket) => {
    const protocol = tlsSocket.alpnProtocol || 'http/1.1';
    const backendServer = backendServers[protocol];
    if (!backendServer) {
      tlsSocket.destroy(new Error(`Unsupported ALPN protocol: ${protocol}`));
      return;
    }

    const recorder = protocol === 'h2' ? new Http2WireCapture() : null;
    pendingConnections[protocol].push(recorder);
    openTlsSockets.add(tlsSocket);
    tlsSocket.once('close', () => openTlsSockets.delete(tlsSocket));
    tlsSocket.pause();

    const backendSocket = connect(backendServer.address().port, '127.0.0.1');
    backendSocket.once('connect', () => {
      if (recorder) {
        tlsSocket.on('data', (chunk) => {
          try {
            recorder.push(chunk);
          } catch (error) {
            tlsSocket.destroy(error);
          }
        });
      }
      tlsSocket.pipe(backendSocket);
      backendSocket.pipe(tlsSocket);
      tlsSocket.resume();
    });
    backendSocket.once('error', (error) => tlsSocket.destroy(error));
    tlsSocket.once('error', () => backendSocket.destroy());
  });

  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolveListening);
  });

  return {
    address: () => server.address(),
    close(callback = () => {}) {
      for (const socket of openTlsSockets) socket.destroy();
      let remaining = 3;
      const closed = () => {
        remaining -= 1;
        if (remaining === 0) callback();
      };
      server.close(closed);
      backendServers.h2.close(closed);
      backendServers['http/1.1'].close(closed);
    },
  };
}

async function main() {
  const keyPath = process.env.TLS_KEY;
  const certPath = process.env.TLS_CERT;
  if (!keyPath || !certPath) throw new Error('TLS_KEY and TLS_CERT must be set');

  const server = await createCaptureServer({
    key: await readFile(keyPath),
    cert: await readFile(certPath),
    host: process.env.CAPTURE_HOST || '127.0.0.1',
    port: Number(process.env.CAPTURE_PORT || 443),
    captureDirectory: process.env.CAPTURE_DIR || resolve('tmp/captures'),
  });

  const address = server.address();
  process.stdout.write(`capture server listening on ${address.address}:${address.port}\n`);

  const stop = () => server.close(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
