import test from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlToUint8Array } from './pushService.js';

test('converts a base64url VAPID key to the application server key bytes', () => {
  const encoded = Buffer.from([0, 1, 2, 250, 251, 252]).toString('base64url');
  assert.deepEqual([...base64UrlToUint8Array(encoded)], [0, 1, 2, 250, 251, 252]);
  assert.deepEqual([...base64UrlToUint8Array('AQ==')], [1]);
});
