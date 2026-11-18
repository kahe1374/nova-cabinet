const ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6afcbe4e002df50df86f';
const DATABASE_ID = '6afcc05300302d503754';
const OWNER_EMAIL = 'Vahiiidk74@gmail.com';
const PAGE_LIMIT = 100;

function header(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : '';
}

function reply(res, payload, status = 200) {
  return res.json(payload, status);
}

async function api(path, key, options = {}) {
  const response = await fetch(ENDPOINT + path, {
    ...options,
    headers: {
      'X-Appwrite-Project': PROJECT_ID,
      'X-Appwrite-Key': key,
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {
    throw new Error('APPWRITE_INVALID_RESPONSE');
  }
  return { response, data };
}

async function listRows(tableId, key, maxRows = 500) {
  const rows = [];
  let offset = 0;
  let total = null;
  while (rows.length < maxRows) {
    const params = new URLSearchParams();
    params.append('queries[]', JSON.stringify({ method: 'limit', values: [PAGE_LIMIT] }));
    params.append('queries[]', JSON.stringify({ method: 'offset', values: [offset] }));
    const result = await api(
      '/tablesdb/' + DATABASE_ID + '/tables/' + encodeURIComponent(tableId) + '/rows?' + params.toString(),
      key
    );
    if (!result.response.ok || !Array.isArray(result.data.rows) || !Number.isInteger(result.data.total)) {
      throw new Error('APPWRITE_TABLE_READ_FAILED:' + tableId);
    }
    if (total === null) total = result.data.total;
    if (total !== result.data.total) throw new Error('APPWRITE_TABLE_CHANGED_DURING_READ:' + tableId);
    rows.push(...result.data.rows);
    if (rows.length >= total || result.data.rows.length === 0) break;
    offset += result.data.rows.length;
  }
  return { rows: rows.slice(0, maxRows), total };
}

export default async ({ req, res, log, error }) => {
  try {
    if (req.method !== 'POST') return reply(res, { ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);

    const jwt = header(req.headers, 'x-appwrite-user-jwt');
    const key = header(req.headers, 'x-appwrite-key');
    if (!jwt) return reply(res, { ok: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
    if (!key) return reply(res, { ok: false, code: 'FUNCTION_KEY_UNAVAILABLE' }, 503);

    // Resolve identity from Appwrite Auth, never from caller-supplied body fields.
    const accountResult = await fetch(ENDPOINT + '/account', {
      headers: { 'X-Appwrite-Project': PROJECT_ID, 'X-Appwrite-JWT': jwt }
    });
    if (!accountResult.ok) return reply(res, { ok: false, code: 'INVALID_SESSION' }, 401);
    const account = await accountResult.json();
    if (!account.$id || String(account.email || '').toLowerCase() !== OWNER_EMAIL.toLowerCase() ||
        account.emailVerification !== true) {
      return reply(res, { ok: false, code: 'OWNER_VERIFICATION_REQUIRED' }, 403);
    }

    const owner = await api(
      '/tablesdb/' + DATABASE_ID + '/tables/app_users/rows/' + encodeURIComponent(account.$id),
      key
    );
    if (!owner.response.ok || owner.data.$id !== account.$id ||
        owner.data.role !== 'owner_admin' || owner.data.is_active !== true ||
        String(owner.data.email || '').toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
      return reply(res, { ok: false, code: 'OWNER_ACCESS_DENIED' }, 403);
    }

    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }
    catch { return reply(res, { ok: false, code: 'INVALID_JSON' }, 400); }

    const action = body.action || 'health';
    if (action === 'health') {
      return reply(res, {
        ok: true,
        code: 'OWNER_AUTHENTICATED',
        capabilities: ['health', 'list_orders', 'list_ai_requests', 'list_ai_pricing'],
        readOnly: true
      });
    }

    if (action === 'list_orders') {
      const [orders, customers] = await Promise.all([
        listRows('orders', key, 500),
        listRows('customers', key, 500)
      ]);
      const customerById = new Map(customers.rows.map((row) => [row.$id, row]));
      const result = orders.rows.map((order) => ({
        ...order,
        customer: customerById.get(order.customer_id) || null
      }));
      return reply(res, {
        ok: true,
        code: 'ORDERS_LOADED',
        rows: result,
        total: orders.total,
        truncated: orders.total > result.length
      });
    }


    if (action === 'list_ai_requests') {
      const result = await listRows('ai_design_requests', key, 500);
      const rows = result.rows
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((row) => {
          const { price_acceptance_token_hash, ...safeRow } = row;
          return safeRow;
        });
      return reply(res, {
        ok: true,
        code: 'AI_REQUESTS_LOADED',
        rows,
        total: result.total,
        truncated: result.total > rows.length
      });
    }

    if (action === 'list_ai_pricing') {
      const result = await listRows('ai_design_pricing', key, 200);
      const rows = result.rows.sort((a, b) => String(a.style_key || '').localeCompare(String(b.style_key || '')));
      return reply(res, {
        ok: true,
        code: 'AI_PRICING_LOADED',
        rows,
        total: result.total,
        truncated: result.total > rows.length
      });
    }

    return reply(res, { ok: false, code: 'ACTION_NOT_SUPPORTED' }, 400);
  } catch (err) {
    error('NOVA admin API failed: ' + (err && err.message ? err.message : 'unknown'));
    return reply(res, { ok: false, code: 'ADMIN_API_ERROR' }, 500);
  }
};
