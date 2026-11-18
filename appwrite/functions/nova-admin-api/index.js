const ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6afcbe4e002df50df86f';
const DATABASE_ID = '6afcc05300302d503754';
const OWNER_EMAIL = 'Vahiiidk74@gmail.com';
const PAGE_LIMIT = 100;
const ORDER_STATUSES = new Set([
  'new', 'under_review', 'awaiting_quote_approval', 'awaiting_payment',
  'approved_for_production', 'in_production', 'quality_control',
  'ready_for_delivery', 'delivered', 'completed', 'cancelled'
]);

function header(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : '';
}
const ALLOWED_ORIGINS = new Set(['https://kahe1374.github.io']);
const publicRateBuckets = new Map();
function consumePublicRateLimit(req, mobile) {
  const forwarded = header(req.headers, 'x-forwarded-for').split(',')[0].trim();
  const ip = header(req.headers, 'cf-connecting-ip') || header(req.headers, 'x-real-ip') || forwarded;
  const key = ip ? 'ip:' + ip.slice(0, 64) : 'mobile:' + mobile;
  const now = Date.now();
  const recent = (publicRateBuckets.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  if (recent.length >= 5) { publicRateBuckets.set(key, recent); return false; }
  recent.push(now);
  publicRateBuckets.set(key, recent);
  if (publicRateBuckets.size > 1000) {
    for (const [bucketKey, times] of publicRateBuckets) {
      if (!times.some((time) => now - time < 10 * 60 * 1000)) publicRateBuckets.delete(bucketKey);
    }
  }
  return true;
}
function corsHeaders(origin) {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Appwrite-Project, X-Appwrite-User-JWT',
    'Access-Control-Max-Age': '86400'
  };
}
function reply(res, payload, status = 200, headers = {}) { return res.json(payload, status, headers); }

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
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('APPWRITE_INVALID_RESPONSE'); }
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
    const result = await api('/tablesdb/' + DATABASE_ID + '/tables/' + encodeURIComponent(tableId) + '/rows?' + params.toString(), key);
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
async function getRow(tableId, rowId, key) {
  return api('/tablesdb/' + DATABASE_ID + '/tables/' + encodeURIComponent(tableId) + '/rows/' + encodeURIComponent(rowId), key);
}
async function createRow(tableId, data, key, rowId = 'unique()') {
  return api('/tablesdb/' + DATABASE_ID + '/tables/' + encodeURIComponent(tableId) + '/rows', key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowId, data, permissions: [] })
  });
}
async function updateRow(tableId, rowId, data, key) {
  return api('/tablesdb/' + DATABASE_ID + '/tables/' + encodeURIComponent(tableId) + '/rows/' + encodeURIComponent(rowId), key, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });
}
function cleanString(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function cleanRowId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 36 ? normalized : '';
}
async function writeAudit(key, actorId, action, entityType, entityId, details) {
  const result = await createRow('audit_log', {
    actor: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    details: JSON.stringify(details || {}),
    created_at: new Date().toISOString()
  }, key);
  if (!result.response.ok) throw new Error('AUDIT_LOG_WRITE_FAILED');
}


function normalizePublicMobile(value) {
  const mobile = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^(09\d{9}|\+989\d{9}|00989\d{9})$/.test(mobile)) return '';
  return mobile.startsWith('09') ? '+98' + mobile.slice(1) :
    mobile.startsWith('0098') ? '+' + mobile.slice(2) : mobile;
}
async function handlePublicOrder(body, key, req, res, responseHeaders, error) {
  if (String(process.env.NOVA_PUBLIC_ORDER_INTAKE_ENABLED || 'false').toLowerCase() !== 'true') {
    return reply(res, { ok: false, code: 'PUBLIC_ORDER_INTAKE_DISABLED' }, 423, responseHeaders);
  }
  const name = cleanString(body.name, 160);
  const mobile = normalizePublicMobile(body.phone);
  const title = cleanString(body.type, 200);
  const orderType = cleanString(body.order_type || 'cabinet', 30);
  const city = cleanString(body.city, 100);
  const province = cleanString(body.province, 100);
  const address = cleanString(body.address, 2000);
  const details = cleanString(body.details, 3000);
  const token = cleanString(body.idempotency_key, 36);
  if (typeof body.website === 'string' && body.website.trim()) {
    return reply(res, { ok: true, code: 'REQUEST_ACCEPTED' }, 200, responseHeaders);
  }
  if (name.length < 2 || !mobile || !title ||
      !['cabinet', 'workshop_service'].includes(orderType) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return reply(res, { ok: false, code: 'INVALID_PUBLIC_ORDER' }, 400, responseHeaders);
  }
  if (!consumePublicRateLimit(req, mobile)) {
    return reply(res, { ok: false, code: 'PUBLIC_RATE_LIMITED', retry_after_seconds: 600 }, 429, responseHeaders);
  }
  const now = new Date().toISOString();
  const customer = await createRow('customers', {
    full_name: name, mobile, province: province || null, city: city || null,
    address: address || null, notes: details || null,
    created_at: now, updated_at: now
  }, key);
  if (!customer.response.ok || !customer.data.$id) {
    return reply(res, { ok: false, code: 'CUSTOMER_SAVE_FAILED' }, 502, responseHeaders);
  }
  const orderNumber = 'NV-' + token.replaceAll('-', '').slice(0, 12).toUpperCase();
  const order = await createRow('orders', {
    order_number: orderNumber, customer: customer.data.$id, title,
    description: details || null, order_type: orderType, status: 'new',
    currency: 'IRR', paid_amount: 0, created_at: now, updated_at: now
  }, key, token);
  if (!order.response.ok || !order.data.$id) {
    const cleanup = await api('/tablesdb/' + DATABASE_ID + '/tables/customers/rows/' +
      encodeURIComponent(customer.data.$id), key, { method: 'DELETE' });
    if (order.response.status === 409) {
      const existing = await getRow('orders', token, key);
      if (existing.response.ok && existing.data.$id === token) {
        return reply(res, { ok: true, code: 'ORDER_ALREADY_RECEIVED',
          order_number: existing.data.order_number, duplicate: true }, 200, responseHeaders);
      }
    }
    if (!cleanup.response.ok) {
      error('NOVA public intake customer rollback failed: HTTP ' + cleanup.response.status);
      return reply(res, { ok: false, code: 'PUBLIC_ORDER_PARTIAL_FAILURE', partial: true }, 502, responseHeaders);
    }
    return reply(res, { ok: false, code: 'ORDER_SAVE_FAILED' }, 502, responseHeaders);
  }
  const history = await createRow('order_status_history', {
    order: token, old_status: null, new_status: 'new',
    note: 'درخواست از فرم عمومی سایت ثبت شد', changed_by: null, changed_at: now
  }, key);
  if (!history.response.ok || !history.data.$id) {
    const removeOrder = await api('/tablesdb/' + DATABASE_ID + '/tables/orders/rows/' + encodeURIComponent(token), key, { method: 'DELETE' });
    const removeCustomer = await api('/tablesdb/' + DATABASE_ID + '/tables/customers/rows/' + encodeURIComponent(customer.data.$id), key, { method: 'DELETE' });
    if (!removeOrder.response.ok || !removeCustomer.response.ok) {
      return reply(res, { ok: false, code: 'PUBLIC_ORDER_ROLLBACK_FAILED', partial: true }, 502, responseHeaders);
    }
    return reply(res, { ok: false, code: 'ORDER_HISTORY_SAVE_FAILED' }, 502, responseHeaders);
  }
  const audit = await createRow('audit_log', {
    actor: null, action: 'order.created.public', entity_type: 'order',
    entity_id: token, details: JSON.stringify({ order_number: orderNumber, order_type: orderType }),
    created_at: now
  }, key);
  if (!audit.response.ok || !audit.data.$id) {
    const removeHistory = await api('/tablesdb/' + DATABASE_ID + '/tables/order_status_history/rows/' + encodeURIComponent(history.data.$id), key, { method: 'DELETE' });
    const removeOrder = await api('/tablesdb/' + DATABASE_ID + '/tables/orders/rows/' + encodeURIComponent(token), key, { method: 'DELETE' });
    const removeCustomer = await api('/tablesdb/' + DATABASE_ID + '/tables/customers/rows/' + encodeURIComponent(customer.data.$id), key, { method: 'DELETE' });
    if (!removeHistory.response.ok || !removeOrder.response.ok || !removeCustomer.response.ok) {
      return reply(res, { ok: false, code: 'PUBLIC_ORDER_ROLLBACK_FAILED', partial: true }, 502, responseHeaders);
    }
    return reply(res, { ok: false, code: 'ORDER_AUDIT_SAVE_FAILED' }, 502, responseHeaders);
  }
  return reply(res, { ok: true, code: 'ORDER_CREATED', order_number: orderNumber }, 201, responseHeaders);
}

export default async ({ req, res, log, error }) => {
  const origin = header(req.headers, 'origin');
  const responseHeaders = corsHeaders(origin);
  try {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return reply(res, { ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, responseHeaders);
    }
    if (req.method === 'OPTIONS') return reply(res, {}, 204, responseHeaders);
    if (req.method !== 'POST') return reply(res, { ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, responseHeaders);
    const earlyKey = header(req.headers, 'x-appwrite-key') || process.env.APPWRITE_FUNCTION_API_KEY || '';
    let earlyBody = {};
    try {
      const raw = typeof req.body === 'string' ? (req.body || '{}') : JSON.stringify(req.body || {});
      if (new TextEncoder().encode(raw).byteLength > 16384) return reply(res, { ok: false, code: 'REQUEST_TOO_LARGE' }, 413, responseHeaders);
      earlyBody = typeof req.body === 'string' ? JSON.parse(raw) : (req.body || {});
      if (!earlyBody || typeof earlyBody !== 'object' || Array.isArray(earlyBody)) return reply(res, { ok: false, code: 'INVALID_REQUEST_BODY' }, 400, responseHeaders);
    } catch {
      return reply(res, { ok: false, code: 'INVALID_JSON' }, 400, responseHeaders);
    }
    if (earlyBody.action === 'public_create_order') {
      if (!earlyKey) return reply(res, { ok: false, code: 'FUNCTION_KEY_UNAVAILABLE' }, 503, responseHeaders);
      if (origin !== 'https://kahe1374.github.io') return reply(res, { ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, responseHeaders);
      return handlePublicOrder(earlyBody, earlyKey, req, res, responseHeaders, error);
    }
    const jwt = header(req.headers, 'x-appwrite-user-jwt');
    const key = earlyKey;
    if (!jwt) return reply(res, { ok: false, code: 'AUTHENTICATION_REQUIRED' }, 401, responseHeaders);
    if (!key) return reply(res, { ok: false, code: 'FUNCTION_KEY_UNAVAILABLE' }, 503, responseHeaders);

    const accountResult = await fetch(ENDPOINT + '/account', {
      headers: { 'X-Appwrite-Project': PROJECT_ID, 'X-Appwrite-JWT': jwt }
    });
    if (!accountResult.ok) return reply(res, { ok: false, code: 'INVALID_SESSION' }, 401, responseHeaders);
    const account = await accountResult.json();
    if (!account.$id || String(account.email || '').toLowerCase() !== OWNER_EMAIL.toLowerCase() || account.emailVerification !== true) {
      return reply(res, { ok: false, code: 'OWNER_VERIFICATION_REQUIRED' }, 403, responseHeaders);
    }
    const owner = await getRow('app_users', account.$id, key);
    if (!owner.response.ok || owner.data.$id !== account.$id || owner.data.role !== 'owner_admin' ||
        owner.data.is_active !== true || String(owner.data.email || '').toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
      return reply(res, { ok: false, code: 'OWNER_ACCESS_DENIED' }, 403, responseHeaders);
    }

    let body = {};
    try {
      const rawBody = typeof req.body === 'string' ? (req.body || '{}') : JSON.stringify(req.body || {});
      if (new TextEncoder().encode(rawBody).byteLength > 16384) return reply(res, { ok: false, code: 'REQUEST_TOO_LARGE' }, 413, responseHeaders);
      body = typeof req.body === 'string' ? JSON.parse(rawBody) : (req.body || {});
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply(res, { ok: false, code: 'INVALID_REQUEST_BODY' }, 400, responseHeaders);
      }
    } catch {
      return reply(res, { ok: false, code: 'INVALID_JSON' }, 400, responseHeaders);
    }
    const action = body.action || 'health';
    const readOnly = String(process.env.NOVA_ADMIN_API_READ_ONLY || 'true').toLowerCase() !== 'false';
    const writeActions = new Set(['update_order_status', 'assign_order', 'upsert_ai_pricing']);
    if (writeActions.has(action) && readOnly) return reply(res, { ok: false, code: 'API_READ_ONLY', readOnly: true }, 423, responseHeaders);

    if (action === 'health') return reply(res, {
      ok: true, code: 'OWNER_AUTHENTICATED',
      capabilities: readOnly
        ? ['health', 'list_orders', 'list_ai_requests', 'list_ai_pricing']
        : ['health', 'list_orders', 'list_ai_requests', 'list_ai_pricing',
          'update_order_status', 'assign_order', 'upsert_ai_pricing'],
      readOnly
    }, 200, responseHeaders);

    if (action === 'list_orders') {
      const [orders, customers] = await Promise.all([listRows('orders', key, 500), listRows('customers', key, 500)]);
      const customerById = new Map(customers.rows.map((row) => [row.$id, row]));
      const rows = orders.rows.map((order) => {
        const customerRef = order.customer;
        const customerId = typeof customerRef === 'string' ? customerRef : customerRef && customerRef.$id;
        return { ...order, customer: customerById.get(customerId) || (typeof customerRef === 'object' ? customerRef : null) };
      });
      return reply(res, { ok: true, code: 'ORDERS_LOADED', rows, total: orders.total, truncated: orders.total > rows.length }, 200, responseHeaders);
    }

    if (action === 'list_ai_requests') {
      const result = await listRows('ai_design_requests', key, 500);
      const rows = result.rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map(({ price_acceptance_token_hash, ...safeRow }) => safeRow);
      return reply(res, { ok: true, code: 'AI_REQUESTS_LOADED', rows, total: result.total, truncated: result.total > rows.length }, 200, responseHeaders);
    }

    if (action === 'list_ai_pricing') {
      const result = await listRows('ai_design_pricing', key, 200);
      const rows = result.rows.sort((a, b) => String(a.style_key || '').localeCompare(String(b.style_key || '')));
      return reply(res, { ok: true, code: 'AI_PRICING_LOADED', rows, total: result.total, truncated: result.total > rows.length }, 200, responseHeaders);
    }

    if (action === 'update_order_status') {
      const orderId = cleanRowId(body.order_id);
      const newStatus = cleanString(body.status, 40);
      const note = cleanString(body.note, 2000);
      if (!orderId || !ORDER_STATUSES.has(newStatus)) return reply(res, { ok: false, code: 'INVALID_ORDER_OR_STATUS' }, 400, responseHeaders);
      const current = await getRow('orders', orderId, key);
      if (!current.response.ok || current.data.$id !== orderId) return reply(res, { ok: false, code: 'ORDER_NOT_FOUND' }, 404, responseHeaders);
      const oldStatus = current.data.status;
      if (oldStatus === newStatus) return reply(res, { ok: true, code: 'STATUS_UNCHANGED', row: current.data }, 200, responseHeaders);
      const updated = await updateRow('orders', orderId, { status: newStatus, updated_at: new Date().toISOString() }, key);
      if (!updated.response.ok) return reply(res, { ok: false, code: 'ORDER_UPDATE_FAILED' }, 502, responseHeaders);
      const history = await createRow('order_status_history', {
        order: orderId, old_status: oldStatus || null, new_status: newStatus,
        note: note || null, changed_by: account.$id, changed_at: new Date().toISOString()
      }, key);
      if (!history.response.ok) return reply(res, { ok: false, code: 'STATUS_UPDATED_HISTORY_FAILED', partial: true, row: updated.data }, 502, responseHeaders);
      try {
        await writeAudit(key, account.$id, 'order.status.updated', 'order', orderId, { old_status: oldStatus || null, new_status: newStatus });
      } catch {
        return reply(res, { ok: false, code: 'STATUS_AND_HISTORY_SAVED_AUDIT_FAILED', partial: true, row: updated.data, history_id: history.data.$id }, 502, responseHeaders);
      }
      return reply(res, { ok: true, code: 'ORDER_STATUS_UPDATED', row: updated.data, history_id: history.data.$id }, 200, responseHeaders);
    }

    if (action === 'assign_order') {
      const orderId = cleanRowId(body.order_id);
      const assigneeId = body.assigned_user_id === null || body.assigned_user_id === '' ? null : cleanRowId(body.assigned_user_id);
      if (!orderId || (body.assigned_user_id && !assigneeId)) return reply(res, { ok: false, code: 'INVALID_ASSIGNMENT' }, 400, responseHeaders);
      const current = await getRow('orders', orderId, key);
      if (!current.response.ok || current.data.$id !== orderId) return reply(res, { ok: false, code: 'ORDER_NOT_FOUND' }, 404, responseHeaders);
      if (assigneeId) {
        const assignee = await getRow('app_users', assigneeId, key);
        if (!assignee.response.ok || assignee.data.$id !== assigneeId || assignee.data.is_active !== true ||
            !['owner_admin', 'factory_manager'].includes(assignee.data.role)) {
          return reply(res, { ok: false, code: 'ASSIGNEE_NOT_ALLOWED' }, 400, responseHeaders);
        }
      }
      const previous = current.data.assigned_user_id || null;
      if (previous === assigneeId) return reply(res, { ok: true, code: 'ASSIGNMENT_UNCHANGED', row: current.data }, 200, responseHeaders);
      const updated = await updateRow('orders', orderId, { assigned_user_id: assigneeId, updated_at: new Date().toISOString() }, key);
      if (!updated.response.ok) return reply(res, { ok: false, code: 'ORDER_ASSIGNMENT_FAILED' }, 502, responseHeaders);
      try {
        await writeAudit(key, account.$id, 'order.assigned', 'order', orderId, { previous_assigned_user_id: previous, assigned_user_id: assigneeId });
      } catch {
        return reply(res, { ok: false, code: 'ASSIGNMENT_SAVED_AUDIT_FAILED', partial: true, row: updated.data }, 502, responseHeaders);
      }
      return reply(res, { ok: true, code: 'ORDER_ASSIGNED', row: updated.data }, 200, responseHeaders);
    }

    if (action === 'upsert_ai_pricing') {
      const styleKey = cleanString(body.style_key, 80);
      const styleLabel = cleanString(body.style_label, 160);
      const price = Number(body.base_price_toman);
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(styleKey) || !styleLabel || !Number.isSafeInteger(price) || price < 700000 || price > 3000000) {
        return reply(res, { ok: false, code: 'INVALID_PRICING' }, 400, responseHeaders);
      }
      const existing = await listRows('ai_design_pricing', key, 500);
      const match = existing.rows.find((row) => row.style_key === styleKey);
      const data = { style_key: styleKey, style_label: styleLabel, base_price_toman: price,
        updated_at: new Date().toISOString(), updated_by: account.$id };
      const saved = match
        ? await updateRow('ai_design_pricing', match.$id, data, key)
        : await createRow('ai_design_pricing', data, key);
      if (!saved.response.ok) return reply(res, { ok: false, code: 'PRICING_SAVE_FAILED' }, 502, responseHeaders);
      try {
        await writeAudit(key, account.$id, match ? 'ai.pricing.updated' : 'ai.pricing.created',
          'ai_design_pricing', saved.data.$id, { style_key: styleKey, base_price_toman: price });
      } catch {
        return reply(res, { ok: false, code: 'PRICING_SAVED_AUDIT_FAILED', partial: true, row: saved.data }, 502, responseHeaders);
      }
      return reply(res, { ok: true, code: match ? 'PRICING_UPDATED' : 'PRICING_CREATED', row: saved.data }, 200, responseHeaders);
    }

    return reply(res, { ok: false, code: 'ACTION_NOT_SUPPORTED' }, 400, responseHeaders);
  } catch (err) {
    error('NOVA admin API failed: ' + (err && err.message ? err.message : 'unknown'));
    return reply(res, { ok: false, code: 'ADMIN_API_ERROR' }, 500, responseHeaders);
  }
};
