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
  assert.match(source, /capabilities: readOnly\s*\? \['health', 'list_orders', 'list_order_assignees', 'list_order_status_history', 'list_ai_requests', 'get_ai_request_file_access', 'get_ai_upload_restore_targets', 'list_ai_pricing'\]/);
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
  const handler = load(async () => { throw new Error('must not contact Appwrite without ephemeral key'); }, { APPWRITE_FUNCTION_API_KEY: '' });
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


const publicHeaders = { origin: 'https://kahe1374.github.io', 'x-appwrite-key': 'ephemeral-test-key' };
const publicOrder = {
  action: 'public_create_order', name: 'Test Customer', phone: '09123456789',
  type: 'Kitchen cabinet', order_type: 'cabinet', city: 'Tehran',
  details: 'Test order', idempotency_key: '12345678-1234-4234-8234-123456789abc'
};

test('public order intake is disabled by default and cannot write', async () => {
  let calls = 0;
  const handler = load(async () => { calls++; throw new Error('disabled path must not write'); });
  const res = response();
  await handler({ req: { method: 'POST', headers: publicHeaders, body: publicOrder }, res, log() {}, error() {} });
  assert.equal(res.status, 423);
  assert.equal(res.body.code, 'PUBLIC_ORDER_INTAKE_DISABLED');
  assert.equal(calls, 0);
});

test('public order intake validates origin, mobile and idempotency key before writes', async () => {
  let writes = 0;
  const handler = load(async () => { writes++; return appwriteResponse({}); }, { NOVA_PUBLIC_ORDER_INTAKE_ENABLED: 'true' });
  for (const [headers, body, status] of [
    [{ ...publicHeaders, origin: 'https://evil.example' }, publicOrder, 403],
    [publicHeaders, { ...publicOrder, phone: '123' }, 400],
    [publicHeaders, { ...publicOrder, idempotency_key: 'not-a-uuid' }, 400]
  ]) {
    const res = response();
    await handler({ req: { method: 'POST', headers, body }, res, log() {}, error() {} });
    assert.equal(res.status, status);
  }
  assert.equal(writes, 0);
});

test('public order intake creates private customer, order, status history and audit rows', async () => {
  const calls = [];
  const handler = load(async (url, options = {}) => {
    const path = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if ((options.method || 'GET') === 'POST') {
      if (path.includes('/tables/customers/rows')) return appwriteResponse({ $id: 'customer-row-id' });
      if (path.includes('/tables/orders/rows')) return appwriteResponse({ $id: publicOrder.idempotency_key });
      if (path.includes('/tables/order_status_history/rows')) return appwriteResponse({ $id: 'history-row-id' });
      if (path.includes('/tables/audit_log/rows')) return appwriteResponse({ $id: 'audit-row-id' });
    }
    throw new Error('unexpected Appwrite call ' + path);
  }, { NOVA_PUBLIC_ORDER_INTAKE_ENABLED: 'true' });
  const res = response();
  await handler({ req: { method: 'POST', headers: publicHeaders, body: publicOrder }, res, log() {}, error() {} });
  assert.equal(res.status, 201);
  assert.equal(res.body.code, 'ORDER_CREATED');
  const customer = calls.find(x => x.path.includes('/tables/customers/rows'));
  const order = calls.find(x => x.path.includes('/tables/orders/rows'));
  const history = calls.find(x => x.path.includes('/tables/order_status_history/rows'));
  const audit = calls.find(x => x.path.includes('/tables/audit_log/rows'));
  assert.equal(customer.body.permissions.length, 0);
  assert.equal(customer.body.data.mobile, '+989123456789');
  assert.equal(order.body.rowId, publicOrder.idempotency_key);
  assert.equal(order.body.permissions.length, 0);
  assert.equal(order.body.data.customer, 'customer-row-id');
  assert.equal(order.body.data.currency, 'IRR');
  assert.equal(order.body.data.paid_amount, 0);
  assert.equal(history.body.data.order, publicOrder.idempotency_key);
  assert.equal(audit.body.data.action, 'order.created.public');
  assert.equal(calls.length, 4);
});

test('public order intake rolls back customer when order creation fails', async () => {
  const calls = [];
  const handler = load(async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, method: options.method || 'GET' });
    if (path.includes('/tables/customers/rows') && options.method === 'POST') return appwriteResponse({ $id: 'customer-row-id' });
    if (path.includes('/tables/orders/rows') && options.method === 'POST') return appwriteResponse({}, false, 400);
    if (path.includes('/tables/customers/rows/customer-row-id') && options.method === 'DELETE') return appwriteResponse({});
    throw new Error('unexpected Appwrite call ' + path);
  }, { NOVA_PUBLIC_ORDER_INTAKE_ENABLED: 'true' });
  const res = response();
  await handler({ req: { method: 'POST', headers: publicHeaders, body: publicOrder }, res, log() {}, error() {} });
  assert.equal(res.status, 502);
  assert.equal(res.body.code, 'ORDER_SAVE_FAILED');
  assert.equal(calls.at(-1).method, 'DELETE');
});

test('public order idempotency returns the existing order and removes the duplicate customer', async () => {
  const calls = [];
  const handler = load(async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, method: options.method || 'GET' });
    if (path.includes('/tables/customers/rows') && options.method === 'POST') return appwriteResponse({ $id: 'duplicate-customer' });
    if (path.includes('/tables/orders/rows') && options.method === 'POST') return appwriteResponse({}, false, 409);
    if (path.includes('/tables/customers/rows/duplicate-customer') && options.method === 'DELETE') return appwriteResponse({});
    if (path.includes('/tables/orders/rows/' + publicOrder.idempotency_key)) return appwriteResponse({ $id: publicOrder.idempotency_key, order_number: 'NV-123456789ABC' });
    throw new Error('unexpected Appwrite call ' + path);
  }, { NOVA_PUBLIC_ORDER_INTAKE_ENABLED: 'true' });
  const res = response();
  await handler({ req: { method: 'POST', headers: publicHeaders, body: publicOrder }, res, log() {}, error() {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 'ORDER_ALREADY_RECEIVED');
  assert.equal(res.body.duplicate, true);
  assert.equal(calls.at(-1).method, 'GET');
});

test('public intake applies a per-runtime rate limit before any database writes', async () => {
  let writes = 0;
  const handler = load(async (url, options = {}) => {
    if (options.method === 'POST') {
      writes++;
      const path = String(url);
      if (path.includes('/tables/customers/rows')) return appwriteResponse({ $id: 'customer-row-id' });
      if (path.includes('/tables/orders/rows')) return appwriteResponse({ $id: '12345678-1234-4234-8234-123456789abc' });
      if (path.includes('/tables/order_status_history/rows')) return appwriteResponse({ $id: 'history-row-id' });
      if (path.includes('/tables/audit_log/rows')) return appwriteResponse({ $id: 'audit-row-id' });
    }
    throw new Error('unexpected Appwrite call ' + String(url));
  }, { NOVA_PUBLIC_ORDER_INTAKE_ENABLED: 'true' });
  for (let i = 0; i < 6; i++) {
    const res = response();
    const body = { ...publicOrder, idempotency_key: '12345678-1234-4234-8234-' + String(i).padStart(12, '0') };
    await handler({ req: { method: 'POST', headers: { ...publicHeaders, 'x-forwarded-for': '203.0.113.10' }, body }, res, log() {}, error() {} });
    if (i < 5) assert.equal(res.status, 201);
    else {
      assert.equal(res.status, 429);
      assert.equal(res.body.code, 'PUBLIC_RATE_LIMITED');
    }
  }
  assert.equal(writes, 20);
});

test('order status history is owner-only, read-only, and scoped to the requested order', async () => {
  const calls = [];
  const handler = load(ownerFetch(async (url, call) => {
    const path = String(url); calls.push(path);
    if (path.endsWith('/tables/orders/rows/order-123')) return appwriteResponse({ $id: 'order-123' });
    if (path.includes('/tables/order_status_history/rows?')) return appwriteResponse({ rows: [
      { $id: 'h2', order: 'order-123', old_status: 'new', new_status: 'under_review', note: 'checked', changed_by: 'manager-1', changed_at: '2026-01-02T00:00:00.000Z' },
      { $id: 'other', order: 'another-order', new_status: 'new' },
      { $id: 'h1', order: { $id: 'order-123' }, old_status: null, new_status: 'new', changed_by: null, changed_at: '2026-01-01T00:00:00.000Z' }
    ], total: 3 });
    throw new Error('unexpected call ' + path);
  }));
  const res = response();
  await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'jwt', 'x-appwrite-key': 'ephemeral-test-key' }, body: { action: 'list_order_status_history', order_id: 'order-123' } }, res, log() {}, error() {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 'ORDER_HISTORY_LOADED');
  assert.equal(Array.from(res.body.rows, row => row.$id).join(','), 'h2,h1');
  assert.equal(res.body.rows[0].note, 'checked');
  assert.equal(calls.some(path => /DELETE|PATCH|POST/.test(path)), false);
});

test('read-only health advertises history but still no write capabilities', () => {
  assert.match(source, /'list_order_status_history'/);
  assert.match(source, /if \(action === 'list_order_status_history'\)/);
  assert.match(source, /capabilities: readOnly\s*\? \['health', 'list_orders', 'list_order_assignees', 'list_order_status_history', 'list_ai_requests', 'get_ai_request_file_access', 'get_ai_upload_restore_targets', 'list_ai_pricing'\]/);
});

test('order assignees lists only active authorized managers with minimal fields', async () => {
  const handler = load(ownerFetch(async (url) => {
    const path = String(url);
    if (path.includes('/tables/app_users/rows?')) return appwriteResponse({ rows: [
      { $id: 'manager-1', full_name: 'مدیر کارگاه', role: 'factory_manager', is_active: true, mobile: 'private' },
      { $id: 'admin-1', full_name: 'مدیر', role: 'owner_admin', is_active: true },
      { $id: 'staff-1', full_name: 'کارمند', role: 'staff', is_active: true },
      { $id: 'inactive-1', full_name: 'غیرفعال', role: 'factory_manager', is_active: false }
    ], total: 4 });
    throw new Error('unexpected call ' + path);
  }));
  const res = response();
  await handler({ req: { method: 'POST', headers: { 'x-appwrite-user-jwt': 'jwt', 'x-appwrite-key': 'ephemeral-test-key' }, body: { action: 'list_order_assignees' } }, res, log() {}, error() {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.code, 'ORDER_ASSIGNEES_LOADED');
  assert.equal(Array.from(res.body.rows, row => row.$id).join(','), 'manager-1,admin-1');
  assert.equal(Object.hasOwn(res.body.rows[0], 'mobile'), false);
});
