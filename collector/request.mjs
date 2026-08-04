import { randomUUID } from 'node:crypto';

const SECRET_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie']);

export function redactHeaderValue(name, value) {
  return SECRET_HEADERS.has(String(name).toLowerCase()) ? '[REDACTED]' : value;
}

export function redactHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, redactHeaderValue(name, value)]),
  );
}

export function redactRawHeaders(rawHeaders = []) {
  const redacted = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    redacted.push(name, redactHeaderValue(name, value));
  }
  return redacted;
}

export function snapshotRequest(
  request,
  measurementToken,
  capturedAt = new Date(),
  { alpn = request.socket?.alpnProtocol || null } = {},
) {
  return {
    schema_version: 3,
    measurement_id: randomUUID(),
    measurement_token: measurementToken,
    captured_at: capturedAt.toISOString(),
    method: request.method,
    url: request.url,
    http_version: request.httpVersion,
    alpn,
    headers: redactHeaders(request.headers),
    raw_headers: redactRawHeaders(request.rawHeaders),
  };
}

export function isSecretHeader(name) {
  return SECRET_HEADERS.has(String(name).toLowerCase());
}
