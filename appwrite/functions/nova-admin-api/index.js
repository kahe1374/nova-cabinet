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
function reply(res, payload, status = 200) { return res.json(payload, status); }

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
async function createRow(tableId, data, key) {
  return api('/tablesdb/' + DATABASE_ID + '/tables/' + encodeURIComponent(tableId) + '/rows', key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowId: 'unique()', data, permissions: [] })
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

export default async ({ req, res, log, error }) => {
  try {
    if (req.method !== 'POST') return reply(res, { ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    const jwt = header(req.headers, 'x-appwrite-user-jwt');
    const key = process.env.APPWRITE_FUNCTION_API_KEY || '';
    if (!jwt) return reply(res, { ok: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
    if (!key) return reply(res, { ok: false, code: 'FUNCTION_KEY_UNAVAILABLE' }, 503);

    const accountResult = await fetch(ENDPOINT + '/account', {
      headers: { 'X-Appwrite-Project': PROJECT_ID, 'X-Appwrite-JWT': jwt }
    });
    if (!accountResult.ok) return reply(res, { ok: false, code: 'INVALID_SESSION' }, 401);
    const account = await accountResult.json();
    if (!account.$id || String(account.email || '').toLowerCase() !== OWNER_EMAIL.toLowerCase() || account.emailVerification !== true) {
      return reply(res, { ok: false, code: 'OWNER_VERIFICATION_REQUIRED' }, 403);
    }
    const owner = await getRow('app_users', account.$id, key);
    if (!owner.response.ok || owner.data.$id !== account.$id || owner.data.role !== 'owner_admin' ||
        owner.data.is_active !== true || String(owner.data.email || '').toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
      return reply(res, { ok: false, code: 'OWNER_ACCESS_DENIED' }, 403);
    }

    let body = {};
    try {
      const rawBody = typeof req.body === 'string' ? (req.body || '{}') : JSON.stringify(req.body || {});
      if (new TextEncoder().encode(rawBody).byteLength > 16384) return reply(res, { ok: false, code: 'REQUEST_TOO_LARGE' }, 413);
      body = typeof req.body === 'string' ? JSON.parse(rawBody) : (req.body || {});
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply(res, { ok: false, code: 'INVALID_REQUEST_BODY' }, 400);
      }
    } catch {
      return reply(res, { ok: false, code: 'INVALID_JSON' }, 400);
    }
    const action = body.action || 'health';

    if (action === 'health') return reply(res, {
      ok: true, code: 'OWNER_AUTHENTICATED',
      capabilities: ['health', 'list_orders', 'list_ai_requests', 'list_ai_pricing',
        'update_order_status', 'assign_order', 'upsert_ai_pricing'],
      readOnly: false
    });

    if (action === 'list_orders') {
      const [orders, customers] = await Promise.all([listRows('orders', key, 500), listRows('customers', key, 500)]);
      const customerById = new Map(customers.rows.map((row) => [row.$id, row]));
      const rows = orders.rows.map((order) => {
        const customerRef = order.customer;
        const customerId = typeof customerRef === 'string' ? customerRef : customerRef && customerRef.$id;
        return { ...order, customer: customerById.get(customerId) || (typeof customerRef === 'object' ? customerRef : null) };
      });
      return reply(res, { ok: true, code: 'ORDERS_LOADED', rows, total: orders.total, truncated: orders.total > rows.length });
    }

    if (action === 'list_ai_requests') {
      const result = await listRows('ai_design_requests', key, 500);
      const rows = result.rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map(({ price_acceptance_token_hash, ...safeRow }) => safeRow);
      return reply(res, { ok: true, code: 'AI_REQUESTS_LOADED', rows, total: result.total, truncated: result.total > rows.length });
    }

    if (action === 'list_ai_pricing') {
      const result = await listRows('ai_design_pricing', key, 200);
      const rows = result.rows.sort((a, b) => String(a.style_key || '').localeCompare(String(b.style_key || '')));
      return reply(res, { ok: true, code: 'AI_PRICING_LOADED', rows, total: result.total, truncated: result.total > rows.length });
    }

    if (action === 'update_order_status') {
      const orderId = cleanString(body.order_id, 36);
      const newStatus = cleanString(body.status, 40);
      const note = cleanString(body.note, 2000);
      if (!orderId || !ORDER_STATUSES.has(newStatus)) return reply(res, { ok: false, code: 'INVALID_ORDER_OR_STATUS' }, 400);
      const current = await getRow('orders', orderId, key);
      if (!current.response.ok || current.data.$id !== orderId) return reply(res, { ok: false, code: 'ORDER_NOT_FOUND' }, 404);
      const oldStatus = current.data.status;
      if (oldStatus === newStatus) return reply(res, { ok: true, code: 'STATUS_UNCHANGED', row: current.data });
      const updated = await updateRow('orders', orderId, { status: newStatus, updated_at: new Date().toISOString() }, key);
      if (!updated.response.ok) return reply(res, { ok: false, code: 'ORDER_UPDATE_FAILED' }, 502);
      const history = await createRow('order_status_history', {
        order: orderId, old_status: oldStatus || null, new_status: newStatus,
        note: note || null, changed_by: account.$id, changed_at: new Date().toISOString()
      }, key);
      if (!history.response.ok) return reply(res, { ok: false, code: 'STATUS_UPDATED_HISTORY_FAILED', partial: true, row: updated.data }, 502);
      try {
        await writeAudit(key, account.$id, 'order.status.updated', 'order', orderId, { old_status: oldStatus || null, new_status: newStatus });
      } catch {
        return reply(res, { ok: false, code: 'STATUS_AND_HISTORY_SAVED_AUDIT_FAILED', partial: true, row: updated.data, history_id: history.data.$id }, 502);
      }
      return reply(res, { ok: true, code: 'ORDER_STATUS_UPDATED', row: updated.data, history_id: history.data.$id });
    }

    if (action === 'assign_order') {
      const orderId = cleanString(body.order_id, 36);
      const assigneeId = body.assigned_user_id === null || body.assigned_user_id === '' ? null : cleanString(body.assigned_user_id, 36);
      if (!orderId || (body.assigned_user_id && !assigneeId)) return reply(res, { ok: false, code: 'INVALID_ASSIGNMENT' }, 400);
      const current = await getRow('orders', orderId, key);
      if (!current.response.ok || current.data.$id !== orderId) return reply(res, { ok: false, code: 'ORDER_NOT_FOUND' }, 404);
      if (assigneeId) {
        const assignee = await getRow('app_users', assigneeId, key);
        if (!assignee.response.ok || assignee.data.$id !== assigneeId || assignee.data.is_active !== true ||
            !['owner_admin', 'factory_manager'].includes(assignee.data.role)) {
          return reply(res, { ok: false, code: 'ASSIGNEE_NOT_ALLOWED' }, 400);
        }
      }
      const previous = current.data.assigned_user_id || null;
      if (previous === assigneeId) return reply(res, { ok: true, code: 'ASSIGNMENT_UNCHANGED', row: current.data });
      const updated = await updateRow('orders', orderId, { assigned_user_id: assigneeId, updated_at: new Date().toISOString() }, key);
      if (!updated.response.ok) return reply(res, { ok: false, code: 'ORDER_ASSIGNMENT_FAILED' }, 502);
      try {
        await writeAudit(key, account.$id, 'order.assigned', 'order', orderId, { previous_assigned_user_id: previous, assigned_user_id: assigneeId });
      } catch {
        return reply(res, { ok: false, code: 'ASSIGNMENT_SAVED_AUDIT_FAILED', partial: true, row: updated.data }, 502);
      }
      return reply(res, { ok: true, code: 'ORDER_ASSIGNED', row: updated.data });
    }

    if (action === 'upsert_ai_pricing') {
      const styleKey = cleanString(body.style_key, 80);
      const styleLabel = cleanString(body.style_label, 160);
      const price = Number(body.base_price_toman);
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(styleKey) || !styleLabel || !Number.isSafeInteger(price) || price < 700000 || price > 3000000) {
        return reply(res, { ok: false, code: 'INVALID_PRICING' }, 400);
      }
      const existing = await listRows('ai_design_pricing', key, 500);
      const match = existing.rows.find((row) => row.style_key === styleKey);
      const data = { style_key: styleKey, style_label: styleLabel, base_price_toman: price,
        updated_at: new Date().toISOString(), updated_by: account.$id };
      const saved = match
        ? await updateRow('ai_design_pricing', match.$id, data, key)
        : await createRow('ai_design_pricing', data, key);
      if (!saved.response.ok) return reply(res, { ok: false, code: 'PRICING_SAVE_FAILED' }, 502);
      try {
        await writeAudit(key, account.$id, match ? 'ai.pricing.updated' : 'ai.pricing.created',
          'ai_design_pricing', saved.data.$id, { style_key: styleKey, base_price_toman: price });
      } catch {
        return reply(res, { ok: false, code: 'PRICING_SAVED_AUDIT_FAILED', partial: true, row: saved.data }, 502);
      }
      return reply(res, { ok: true, code: match ? 'PRICING_UPDATED' : 'PRICING_CREATED', row: saved.data });
    }

    return reply(res, { ok: false, code: 'ACTION_NOT_SUPPORTED' }, 400);
  } catch (err) {
    error('NOVA admin API failed: ' + (err && err.message ? err.message : 'unknown'));
    return reply(res, { ok: false, code: 'ADMIN_API_ERROR' }, 500);
  }
};
