import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCapture } from '../collector/capture.mjs';

const protocol = { httpVersion: '2.0', alpn: 'h2' };
const ajax = { id: 'ajax-post', method: 'POST', path: '/capture/ajax' };

test('capture verification requires the browser to report a secure context', () => {
  const raw = {
    method: 'POST',
    url: '/capture/ajax?token=abcdefghijklmnop&secure_context=false',
    http_version: '2.0',
    alpn: 'h2',
  };
  assert.throws(() => assertCapture(raw, ajax, protocol), /secure context/);
});

test('capture verification rejects an unexpected protocol', () => {
  const raw = {
    method: 'POST',
    url: '/capture/ajax?token=abcdefghijklmnop&secure_context=true',
    http_version: '1.1',
    alpn: 'http/1.1',
  };
  assert.throws(() => assertCapture(raw, ajax, protocol), /expected 2\.0\/h2/);
});
