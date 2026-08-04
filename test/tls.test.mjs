import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTrustedTls } from '../collector/capture.mjs';

test('browser TLS verification rejects a non-secure context', async () => {
  const driver = {
    async get() {},
    async executeScript() {
      return false;
    },
    findElement() {
      return { async getText() { return 'ok'; } };
    },
    async getCurrentUrl() {
      return 'https://app.test/health';
    },
  };
  await assert.rejects(
    verifyTrustedTls(driver, 'https://app.test'),
    /Browser does not trust the test CA/,
  );
});

test('browser TLS verification does not suppress certificate navigation errors', async () => {
  const certificateError = new Error('certificate verify failed');
  const driver = {
    async get() {
      throw certificateError;
    },
  };
  await assert.rejects(verifyTrustedTls(driver, 'https://app.test'), certificateError);
});
