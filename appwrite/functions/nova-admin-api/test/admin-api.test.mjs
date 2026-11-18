import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function load(fetchImpl, extraEnv = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source.replace('export default async', 'module.exports = async'), {
    module, fetch: fetchImpl, process: { env: { APPWRITE_FUNCTION_API_KEY: 'test-key', ...extraEnv } }, URLSearchParams, URL, TextEncoder, Map, Set, Date, JSON, String, Number
  });
  return module.exports;
}
function response() {
  return { status: 200, body: null, headers: {}, json(body, status = 200, headers = {}) { this.body = body; this.status = status; this.headers = headers; return this; } };
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
  await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'invalid', 'x-appwrite-key': 'ephemeral-test-key' }, body: {} }, res, log() {}, error() {} });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'INVALID_SESSION');
});

test('keeps audit-write failures explicitly marked as partial writes', () => {
  assert.match(source, /STATUS_AND_HISTORY_SAVED_AUDIT_FAILED/);
  assert.match(source, /ASSIGNMENT_SAVED_AUDIT_FAILED/);
  assert.match(source, /PRICING_SAVED_AUDIT_FAILED/);
  assert.match(source, /price_acceptance_token_hash, \.\.\.safeRow/);
});


function appwriteResponse(data, ok = true, status = 200) {
  return {
    ok, status,
    async json() { return data; },
    async text() { return JSON.stringify(data); }
  };
}
function ownerFetch(extra = async () => appwriteResponse({ rows: [], total: 0 })) {
  let call = 0;
  return async (url) => {
    call++;
    if (String(url).endsWith('/account')) {
      return appwriteResponse({ $id: 'owner-id', email: 'Vahiiidk74@gmail.com', emailVerification: true });
    }
    if (String(url).includes('/tables/app_users/rows/owner-id')) {
      return appwriteResponse({ $id: 'owner-id', role: 'owner_admin', is_active: true, email: 'Vahiiidk74@gmail.com' });
    }
    return extra(url, call);
  };
}

test('rejects an account that is not the verified owner', async () => {
  const handler = load(async (url) => appwriteResponse({
    $id: 'other-id', email: 'other@example.com', emailVerification: true
  }));
  const res = response();
  await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'jwt', 'x-appwrite-key': 'ephemeral-test-key' }, body: {} }, res, log() {}, error() {} });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'OWNER_VERIFICATION_REQUIRED');
});

test('rejects an inactive or incorrectly assigned owner row', async () => {
  const handler = load(async (url) => {
    if (String(url).endsWith('/account')) return appwriteResponse({
      $id: 'owner-id', email: 'Vahiiidk74@gmail.com', emailVerification: true
    });
    return appwriteResponse({ $id: 'owner-id', role: 'owner_admin', is_active: false, email: 'Vahiiidk74@gmail.com' });
  });
  const res = response();
  await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'jwt', 'x-appwrite-key': 'ephemeral-test-key' }, body: {} }, res, log() {}, error() {} });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'OWNER_ACCESS_DENIED');
});

test('rejects malformed and oversized request bodies after owner verification', async () => {
  for (const [body, expected] of [['{bad json', 'INVALID_JSON'], ['x'.repeat(16385), 'REQUEST_TOO_LARGE'], [[], 'INVALID_REQUEST_BODY']]) {
    const handler = load(ownerFetch());
    const res = response();
    await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'jwt', 'x-appwrite-key': 'ephemeral-test-key' }, body }, res, log() {}, error() {} });
    assert.equal(res.body.code, expected);
  }
});

test('rejects unknown actions and invalid pricing without writing data', async () => {
  let writes = 0;
  const fetchImpl = ownerFetch(async (url, call) => {
    if (String(url).includes('/rows') && !String(url).includes('/app_users/')) writes++;
    return appwriteResponse({ rows: [], total: 0 });
  });
  for (const body of [{ action: 'not_a_real_action' }, { action: 'upsert_ai_pricing', style_key: 'modern', style_label: 'Modern', base_price_toman: 1 }]) {
    const handler = load(fetchImpl, { NOVA_ADMIN_API_READ_ONLY: 'false' });
    const res = response();
    await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'jwt', 'x-appwrite-key': 'ephemeral-test-key' }, body }, res, log() {}, error() {} });
    assert.equal(res.status, 400);
  }
  assert.equal(writes, 0);
});

test('AI request response strips price acceptance token hashes', () => {
  assert.match(source, /\.map\(\(\{ price_acceptance_token_hash, \.\.\.safeRow \}\) => safeRow\)/);
  assert.match(source, /price_acceptance_token_hash/);
});

test('assignment action uses strict row identifier validation', () => {
  assert.match(source, /INVALID_ASSIGNMENT/);
  assert.match(source, /const orderId = cleanRowId\(body\.order_id\);[\s\S]*?const assigneeId/);
});
test('read-only health does not advertise write capabilities', () => {
  assert.match(source, /capabilities: readOnly\s*\? \['health', 'list_orders', 'list_ai_requests', 'list_ai_pricing'\]/);
});


test('answers the approved GitHub Pages CORS preflight without authentication', async () => {
  const handler = load(async () => { throw new Error('preflight must not contact Appwrite'); });
  const res = response();
  await handler({ req: { method: 'OPTIONS', headers: { origin: 'https://kahe1374.github.io' } }, res, log() {}, error() {} });
  assert.equal(res.status, 204);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://kahe1374.github.io');
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assert.match(res.headers['Access-Control-Allow-Headers'], /X-Appwrite-User-JWT/i);
});

test('rejects unapproved CORS origins', async () => {
  const handler = load(async () => { throw new Error('disallowed origin must not contact Appwrite'); });
  const res = response();
  await handler({ req: { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }, res, log() {}, error() {} });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'ORIGIN_NOT_ALLOWED');
});

test('includes CORS headers on allowed-origin authentication errors', async () => {
  const handler = load(async () => { throw new Error('missing JWT must not contact Appwrite'); });
  const res = response();
  await handler({ req: { method: 'POST', headers: { origin: 'https://kahe1374.github.io' }, body: {} }, res, log() {}, error() {} });
  assert.equal(res.status, 401);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://kahe1374.github.io');
});


test('requires the execution-scoped ephemeral key header', async () => {
  const handler = load(async () => { throw new Error('must not contact Appwrite without ephemeral key'); });
  const res = response();
  await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'jwt' }, body: {} }, res, log() {}, error() {} });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'FUNCTION_KEY_UNAVAILABLE');
});

test('assignment writes the scalar orders.assigned_user_id field used by the schema workflow', () => {
  assert.match(source, /body\.assigned_user_id/);
  assert.match(source, /assigned_user_id: assigneeId/);
  assert.doesNotMatch(source, /assigned_to/);
});
