import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function load(fetchImpl) {
  const module = { exports: {} };
  vm.runInNewContext(source.replace('export default async', 'module.exports = async'), {
    module, fetch: fetchImpl, process: { env: { APPWRITE_FUNCTION_API_KEY: 'test-key' } }, URLSearchParams, URL, Map, Set, Date, JSON, String, Number
  });
  return module.exports;
}
function response() {
  return { status: 200, body: null, json(body, status = 200) { this.body = body; this.status = status; return this; } };
}

test('rejects non-POST requests', async () => {
  const handler = load(async () => { throw new Error('fetch must not be called'); });
  const res = response();
  await handler({ req: { method: 'GET', headers: {} }, res, log() {}, error() {} });
  assert.equal(res.status, 405);
  assert.equal(res.body.code, 'METHOD_NOT_ALLOWED');
});

test('rejects missing owner session before contacting Appwrite', async () => {
  const handler = load(async () => { throw new Error('fetch must not be called'); });
  const res = response();
  await handler({ req: { method: 'POST', headers: {}, body: {} }, res, log() {}, error() {} });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'AUTHENTICATION_REQUIRED');
});

test('rejects invalid Appwrite sessions', async () => {
  const handler = load(async () => ({ ok: false, status: 401 }));
  const res = response();
  await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'invalid' }, body: {} }, res, log() {}, error() {} });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'INVALID_SESSION');
});

test('keeps audit-write failures explicitly marked as partial writes', () => {
  assert.match(source, /STATUS_AND_HISTORY_SAVED_AUDIT_FAILED/);
  assert.match(source, /ASSIGNMENT_SAVED_AUDIT_FAILED/);
  assert.match(source, /PRICING_SAVED_AUDIT_FAILED/);
  assert.match(source, /price_acceptance_token_hash, \.\.\.safeRow/);
});
