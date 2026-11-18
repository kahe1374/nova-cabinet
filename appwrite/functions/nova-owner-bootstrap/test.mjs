import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const { default: handler } = await import(moduleUrl);

const account = {
  $id: 'owner-account-123',
  email: 'Vahiiidk74@gmail.com',
  emailVerification: true
};

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(data); }
  };
}

function harness(fetchImpl) {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const logs = [];
  const errors = [];
  return {
    logs,
    errors,
    async call({ method = 'POST', headers = { 'x-appwrite-user-jwt': 'valid-jwt', 'x-appwrite-key': 'ephemeral-key' } } = {}) {
      let result;
      await handler({
        req: { method, headers, body: {} },
        res: { json(payload, status = 200) { result = { payload, status }; return result; } },
        log: message => logs.push(message),
        error: message => errors.push(message)
      });
      return result;
    },
    restore() { globalThis.fetch = oldFetch; }
  };
}

function successfulFetch({ rows = [], lockStatus = 201, ownerStatus = 201 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if (String(url).endsWith('/account')) return response(account);
    if (String(url).includes('/rows?')) return response({ rows, total: rows.length });
    if (String(url).endsWith('/tables/app_users/rows') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.rowId === 'nova-owner-bootstrap-lock') {
        return response({ $id: body.rowId, ...body.data }, lockStatus);
      }
      return response({ $id: body.rowId, ...body.data }, ownerStatus);
    }
    return response({}, 404);
  };
  return { fetchImpl, calls };
}

test('rejects non-POST requests without calling Appwrite', async () => {
  const h = harness(async () => { throw new Error('fetch must not be called'); });
  try {
    const result = await h.call({ method: 'GET' });
    assert.equal(result.status, 405);
    assert.equal(result.payload.code, 'METHOD_NOT_ALLOWED');
  } finally { h.restore(); }
});

test('requires a session JWT', async () => {
  const h = harness(async () => { throw new Error('fetch must not be called'); });
  try {
    const result = await h.call({ headers: { 'x-appwrite-key': 'ephemeral-key' } });
    assert.equal(result.status, 401);
    assert.equal(result.payload.code, 'AUTHENTICATION_REQUIRED');
  } finally { h.restore(); }
});

test('rejects an unverified owner email', async () => {
  const { fetchImpl } = successfulFetch();
  const h = harness(async (url, options) => {
    if (String(url).endsWith('/account')) return response({ ...account, emailVerification: false });
    return fetchImpl(url, options);
  });
  try {
    const result = await h.call();
    assert.equal(result.status, 403);
    assert.equal(result.payload.code, 'EMAIL_NOT_VERIFIED');
  } finally { h.restore(); }
});

test('rejects an account with a different email before any row write', async () => {
  const h = harness(async url => String(url).endsWith('/account')
    ? response({ ...account, email: 'attacker@example.com' })
    : response({}, 500));
  try {
    const result = await h.call();
    assert.equal(result.status, 403);
    assert.equal(result.payload.code, 'NOT_AUTHORIZED_FOR_OWNER_BOOTSTRAP');
  } finally { h.restore(); }
});

test('creates exactly one owner row after taking the lock', async () => {
  const { fetchImpl, calls } = successfulFetch();
  const h = harness(fetchImpl);
  try {
    const result = await h.call();
    assert.equal(result.status, 201);
    assert.equal(result.payload.code, 'OWNER_BOOTSTRAPPED');
    const writes = calls.filter(call => call.method === 'POST');
    assert.equal(writes.length, 2);
    const ownerWrite = JSON.parse(writes[1].body);
    assert.equal(ownerWrite.rowId, account.$id);
    assert.equal(ownerWrite.data.role, 'owner_admin');
    assert.deepEqual(ownerWrite.permissions, [
      'read("user:' + account.$id + '")',
      'update("user:' + account.$id + '")'
    ]);
  } finally { h.restore(); }
});

test('refuses a lock owned by a different account', async () => {
  const h = harness(async (url, options = {}) => {
    if (String(url).endsWith('/account')) return response(account);
    if (String(url).endsWith('/tables/app_users/rows') && options.method === 'POST') return response({}, 409);
    if (String(url).includes('/rows/nova-owner-bootstrap-lock')) {
      return response({ role: 'owner_bootstrap_lock', full_name: 'some-other-account', email: account.email });
    }
    return response({}, 500);
  });
  try {
    const result = await h.call();
    assert.equal(result.status, 409);
    assert.equal(result.payload.code, 'BOOTSTRAP_LOCKED');
  } finally { h.restore(); }
});

test('does not create another owner when an owner row already exists', async () => {
  const existing = {
    $id: 'someone-else',
    role: 'owner_admin',
    email: 'other-owner@example.com',
    is_active: true
  };
  const { fetchImpl, calls } = successfulFetch({ rows: [existing] });
  const h = harness(fetchImpl);
  try {
    const result = await h.call();
    assert.equal(result.status, 409);
    assert.equal(result.payload.code, 'OWNER_ALREADY_EXISTS');
    const ownerWrites = calls.filter(call => call.method === 'POST' &&
      JSON.parse(call.body).data.role === 'owner_admin');
    assert.equal(ownerWrites.length, 0);
  } finally { h.restore(); }
});

test('fails closed when app_users cannot be fully enumerated', async () => {
  const h = harness(async (url, options = {}) => {
    if (String(url).endsWith('/account')) return response(account);
    if (String(url).endsWith('/tables/app_users/rows') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      return response({ $id: body.rowId, ...body.data }, 201);
    }
    if (String(url).includes('/rows?')) return response({ rows: [], total: 1 });
    return response({}, 404);
  });
  try {
    const result = await h.call();
    assert.equal(result.status, 500);
    assert.equal(result.payload.code, 'INTERNAL_ERROR');
  } finally { h.restore(); }
});

test('allows the same verified account to retry after a prior lock acquisition', async () => {
  const calls = [];
  const h = harness(async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, method: options.method || 'GET' });
    if (value.endsWith('/account')) return response(account);
    if (value.endsWith('/rows/nova-owner-bootstrap-lock')) {
      return response({
        $id: 'nova-owner-bootstrap-lock',
        role: 'owner_bootstrap_lock',
        full_name: account.$id,
        email: account.email
      });
    }
    if (value.endsWith('/rows?')) return response({ rows: [], total: 0 });
    if (value.endsWith('/tables/app_users/rows') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.rowId === 'nova-owner-bootstrap-lock') return response({}, 409);
      return response({ $id: body.rowId, ...body.data }, 201);
    }
    return response({}, 404);
  });
  try {
    const result = await h.call();
    assert.equal(result.status, 201, JSON.stringify(h.errors));
    assert.equal(result.payload.code, 'OWNER_BOOTSTRAPPED');
    assert.ok(calls.some(call => call.url.endsWith('/rows/nova-owner-bootstrap-lock')));
  } finally { h.restore(); }
});

test('concurrent requests for the same verified account produce only one owner row', async () => {
  const rows = new Map();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const h = harness(async (url, options = {}) => {
    const value = String(url);
    const method = options.method || 'GET';
    if (value.endsWith('/account')) {
      await pause(2);
      return response(account);
    }
    if (value.includes('/rows?')) {
      await pause(2);
      return response({ rows: [...rows.values()], total: rows.size });
    }
    const rowMatch = value.match(/\/rows\/([^/?]+)$/);
    if (method === 'GET' && rowMatch) {
      const found = rows.get(decodeURIComponent(rowMatch[1]));
      return found ? response(found) : response({ message: 'not found' }, 404);
    }
    if (method === 'POST' && value.endsWith('/tables/app_users/rows')) {
      await pause(5);
      const body = JSON.parse(options.body);
      if (rows.has(body.rowId)) return response({ message: 'duplicate' }, 409);
      const row = { $id: body.rowId, ...body.data };
      rows.set(body.rowId, row);
      return response(row, 201);
    }
    return response({}, 404);
  });
  try {
    const results = await Promise.all([h.call(), h.call()]);
    assert.equal(rows.get('nova-owner-bootstrap-lock')?.role, 'owner_bootstrap_lock');
    assert.equal(rows.get(account.$id)?.role, 'owner_admin');
    assert.equal([...rows.values()].filter(row => row.role === 'owner_admin').length, 1);
    assert.ok(results.every(result =>
      result.status === 201 || (result.status === 200 && result.payload.code === 'OWNER_ALREADY_BOOTSTRAPPED')
    ));
  } finally { h.restore(); }
});

