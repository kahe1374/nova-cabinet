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
const ALLOWED_ORIGINS = new Set([
  'https://kahe1374.github.io',
  'https://novacabinet.ir',
  'https://www.novacabinet.ir'
]);
const publicRateBuckets = new Map();
function consumePublicRateLimit(req, mobile) {
  const forwarded = header(req.headers, 'x-forwarded-for').split(',')[0].trim();
  const ip = header(req.headers, 'x-appwrite-client-ip') || header(req.headers, 'cf-connecting-ip') || header(req.headers, 'x-real-ip') || forwarded;
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


async function verifyPublicAiAccount(jwt, error) {
  if (typeof jwt !== 'string' || !jwt) { error('NOVA AI session JWT missing from request payload'); return null; }
  const response = await fetch(ENDPOINT + '/account', {
    headers: { 'X-Appwrite-Project': PROJECT_ID, 'X-Appwrite-JWT': jwt }
  });
  if (!response.ok) { error('NOVA AI session JWT verification returned HTTP ' + response.status); return null; }
  const account = await response.json();
  return account && account.$id ? account : null;
}
function ownsPrivateFile(file, userId) {
  const permissions = Array.isArray(file && file.$permissions) ? file.$permissions : [];
  const owner = 'user:' + userId;
  return permissions.some((permission) =>
    typeof permission === 'string' &&
    (permission.includes('("' + owner + '")') || permission.includes('(' + owner + ')'))
  );
}
function normalizeAiMobile(value) {
  const mobile = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^(09\d{9}|\\+989\d{9}|00989\d{9})$/.test(mobile)) return '';
  return mobile.startsWith('09') ? '+98' + mobile.slice(1) :
    mobile.startsWith('0098') ? '+' + mobile.slice(2) : mobile;
}
async function handlePublicAiCreate(body, key, req, res, responseHeaders, error) {
  if (String(process.env.NOVA_PUBLIC_AI_INTAKE_ENABLED || 'false').toLowerCase() !== 'true') {
    return reply(res, { ok: false, code: 'PUBLIC_AI_INTAKE_DISABLED' }, 423, responseHeaders);
  }
  const jwt = cleanString(body.session_jwt, 4096);
  const account = await verifyPublicAiAccount(jwt, error);
  if (!account) return reply(res, { ok: false, code: 'INVALID_AI_SESSION' }, 401, responseHeaders);
  const name = cleanString(body.name, 160);
  const mobile = normalizeAiMobile(body.phone);
  const city = cleanString(body.city, 100);
  const mode = cleanString(body.design_mode, 20);
  const style = cleanString(body.style, 100);
  const complexity = cleanString(body.complexity_level || 'simple', 20);
  const styleKeys = {
    'مدرن و مینیمال': 'modern',
    'نئوکلاسیک': 'neoclassical',
    'لوکس': 'luxury',
    'کلاسیک': 'classic',
    'پیشنهاد طراح': 'designer_recommendation'
  };
  const styleKey = styleKeys[style];
  const doorMaterial = cleanString(body.door_material, 160);
  const countertopMaterial = cleanString(body.countertop_material, 160);
  const materialCodes = cleanString(body.material_codes, 1000);
  const instructions = cleanString(body.instructions, 3000);
  const fileName = cleanString(body.file_name, 255);
  const mimeType = cleanString(body.mime_type, 120).toLowerCase();
  const fileSize = Number(body.file_size);
  const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime', 'video/webm']);
  if (typeof body.website === 'string' && body.website.trim()) {
    return reply(res, { ok: true, code: 'REQUEST_ACCEPTED' }, 200, responseHeaders);
  }
  if (name.length < 2 || !mobile || !['preserve', 'free'].includes(mode) || !styleKey ||
      !['simple', 'medium', 'complex'].includes(complexity) || !fileName ||
      !allowedMime.has(mimeType) || !Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > 30 * 1024 * 1024) {
    return reply(res, { ok: false, code: 'INVALID_AI_FORM_OR_FILE' }, 400, responseHeaders);
  }
  if (!consumePublicRateLimit(req, mobile)) {
    return reply(res, { ok: false, code: 'PUBLIC_RATE_LIMITED', retry_after_seconds: 600 }, 429, responseHeaders);
  }
  const pricing = await listRows('ai_design_pricing', key, 200);
  const selected = pricing.rows.find((row) => row.style_key === styleKey);
  if (!selected || !Number.isSafeInteger(Number(selected.base_price_toman))) {
    return reply(res, { ok: false, code: 'AI_PRICING_UNAVAILABLE' }, 503, responseHeaders);
  }
  const multiplier = complexity === 'medium' ? 1.2 : complexity === 'complex' ? 1.4 : 1;
  const quotedPrice = Math.min(3000000, Math.max(700000, Math.round(Number(selected.base_price_toman) * multiplier)));
  const id = crypto.randomUUID();
  const requestNumber = 'NA-' + id.replaceAll('-', '').slice(0, 10).toUpperCase();
  const acceptanceToken = crypto.randomUUID() + crypto.randomUUID();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(acceptanceToken));
  const tokenHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const now = new Date().toISOString();
  const saved = await createRow('ai_design_requests', {
    request_number: requestNumber,
    full_name: name,
    mobile,
    city: city || null,
    design_mode: mode,
    style,
    complexity_level: complexity,
    quoted_price_toman: quotedPrice,
    door_material: doorMaterial || null,
    countertop_material: countertopMaterial || null,
    material_codes: materialCodes || null,
    instructions: instructions || null,
    structure_locked: mode === 'preserve',
    price_acceptance_token_hash: tokenHash,
    file_key: id,
    original_file_name: fileName,
    mime_type: mimeType,
    file_size_bytes: fileSize,
    payment_status: 'pending',
    status: 'awaiting_payment',
    created_at: now,
    updated_at: now
  }, key, id);
  if (!saved.response.ok || saved.data.$id !== id) {
    error('NOVA AI request save failed: HTTP ' + saved.response.status);
    return reply(res, { ok: false, code: 'AI_REQUEST_SAVE_FAILED' }, 502, responseHeaders);
  }
  const audit = await createRow('audit_log', {
    actor: null,
    action: 'ai.request.created.public',
    entity_type: 'ai_design_request',
    entity_id: id,
    details: JSON.stringify({ request_number: requestNumber, design_mode: mode, style_key: styleKey, uploader_user_id: account.$id }),
    created_at: now
  }, key);
  if (!audit.response.ok) {
    const rollback = await api('/tablesdb/' + DATABASE_ID + '/tables/ai_design_requests/rows/' + encodeURIComponent(id), key, { method: 'DELETE' });
    if (!rollback.response.ok) return reply(res, { ok: false, code: 'AI_REQUEST_AUDIT_FAILED_PARTIAL', partial: true }, 502, responseHeaders);
    return reply(res, { ok: false, code: 'AI_REQUEST_AUDIT_FAILED' }, 502, responseHeaders);
  }
  return reply(res, {
    ok: true,
    code: 'AI_REQUEST_CREATED',
    request_id: id,
    request_number: requestNumber,
    quoted_price_toman: quotedPrice,
    complexity_level: complexity,
    price_acceptance_token: acceptanceToken
  }, 201, responseHeaders);
}
async function handlePublicAiConfirmUpload(body, key, req, res, responseHeaders, error) {
  const account = await verifyPublicAiAccount(cleanString(body.session_jwt, 4096), error);
  if (!account) return reply(res, { ok: false, code: 'INVALID_AI_SESSION' }, 401, responseHeaders);
  const requestId = cleanRowId(body.request_id);
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return reply(res, { ok: false, code: 'INVALID_REQUEST_ID' }, 400, responseHeaders);
  }
  const current = await getRow('ai_design_requests', requestId, key);
  if (!current.response.ok || current.data.$id !== requestId) {
    return reply(res, { ok: false, code: 'AI_REQUEST_NOT_FOUND' }, 404, responseHeaders);
  }
  const file = await api('/storage/buckets/nova-ai-designs/files/' + encodeURIComponent(requestId), key);
  if (!file.response.ok || file.data.$id !== requestId) {
    return reply(res, { ok: false, code: 'AI_UPLOAD_NOT_FOUND' }, 409, responseHeaders);
  }
  if (!ownsPrivateFile(file.data, account.$id)) {
    return reply(res, { ok: false, code: 'AI_UPLOAD_NOT_OWNED' }, 403, responseHeaders);
  }
  if (file.data.mimeType !== current.data.mime_type ||
      Number(file.data.sizeOriginal) !== Number(current.data.file_size_bytes)) {
    return reply(res, { ok: false, code: 'AI_UPLOAD_METADATA_MISMATCH' }, 409, responseHeaders);
  }
  const now = new Date().toISOString();
  if (current.data.upload_completed_at) {
    return reply(res, { ok: true, code: 'AI_UPLOAD_ALREADY_CONFIRMED' }, 200, responseHeaders);
  }
  const updated = await updateRow('ai_design_requests', requestId, {
    upload_completed_at: now,
    updated_at: now
  }, key);
  if (!updated.response.ok) return reply(res, { ok: false, code: 'AI_UPLOAD_CONFIRM_FAILED' }, 502, responseHeaders);
  return reply(res, { ok: true, code: 'AI_UPLOAD_CONFIRMED' }, 200, responseHeaders);
}
async function handlePublicAiAcceptPrice(body, key, req, res, responseHeaders, error) {
  const account = await verifyPublicAiAccount(cleanString(body.session_jwt, 4096), error);
  if (!account) return reply(res, { ok: false, code: 'INVALID_AI_SESSION' }, 401, responseHeaders);
  const requestId = cleanRowId(body.request_id);
  const token = cleanString(body.price_acceptance_token, 80);
  const amount = Number(body.accepted_amount_toman);
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
      !/^[0-9a-f-]{72}$/i.test(token) || !Number.isSafeInteger(amount) || amount < 700000 || amount > 3000000) {
    return reply(res, { ok: false, code: 'INVALID_AI_PRICE_CONFIRMATION' }, 400, responseHeaders);
  }
  const current = await getRow('ai_design_requests', requestId, key);
  if (!current.response.ok || current.data.$id !== requestId) {
    return reply(res, { ok: false, code: 'AI_REQUEST_NOT_FOUND' }, 404, responseHeaders);
  }
  const file = await api('/storage/buckets/nova-ai-designs/files/' + encodeURIComponent(requestId), key);
  if (!file.response.ok || !ownsPrivateFile(file.data, account.$id)) {
    return reply(res, { ok: false, code: 'AI_UPLOAD_NOT_OWNED' }, 403, responseHeaders);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (!current.data.price_acceptance_token_hash || current.data.price_acceptance_token_hash !== tokenHash) {
    return reply(res, { ok: false, code: 'INVALID_PRICE_CONFIRMATION_TOKEN' }, 403, responseHeaders);
  }
  if (Number(current.data.quoted_price_toman) !== amount) {
    return reply(res, { ok: false, code: 'AI_PRICE_MISMATCH' }, 409, responseHeaders);
  }
  if (!current.data.upload_completed_at) return reply(res, { ok: false, code: 'AI_UPLOAD_NOT_COMPLETED' }, 409, responseHeaders);
  if (current.data.payment_status !== 'pending' || current.data.status !== 'awaiting_payment') {
    return reply(res, { ok: false, code: 'AI_REQUEST_NOT_AWAITING_PAYMENT' }, 409, responseHeaders);
  }
  if (current.data.price_accepted_at) {
    if (Number(current.data.price_accepted_amount_toman) === amount) {
      return reply(res, { ok: true, code: 'AI_PRICE_ALREADY_ACCEPTED', already_accepted: true, accepted_amount_toman: amount }, 200, responseHeaders);
    }
    return reply(res, { ok: false, code: 'AI_PRICE_ALREADY_ACCEPTED_DIFFERENTLY' }, 409, responseHeaders);
  }
  const acceptedAt = new Date().toISOString();
  const updated = await updateRow('ai_design_requests', requestId, {
    price_accepted_at: acceptedAt,
    price_accepted_amount_toman: amount,
    updated_at: acceptedAt
  }, key);
  if (!updated.response.ok) return reply(res, { ok: false, code: 'AI_PRICE_ACCEPTANCE_FAILED' }, 502, responseHeaders);
  const audit = await createRow('audit_log', {
    actor: null,
    action: 'ai.price.accepted.public',
    entity_type: 'ai_design_request',
    entity_id: requestId,
    details: JSON.stringify({ accepted_amount_toman: amount, uploader_user_id: account.$id }),
    created_at: acceptedAt
  }, key);
  if (!audit.response.ok) {
    return reply(res, { ok: false, code: 'AI_PRICE_ACCEPTED_AUDIT_FAILED', partial: true, accepted_amount_toman: amount }, 502, responseHeaders);
  }
  return reply(res, { ok: true, code: 'AI_PRICE_ACCEPTED', accepted_amount_toman: amount, accepted_at: acceptedAt, payment_status: 'pending' }, 200, responseHeaders);
}


function aiDesignPrompt(row) {
  const preserve = row.design_mode === 'preserve';
  const instructions = String(row.instructions ?? '').slice(0, 2500);
  return [
    'Create one photorealistic, premium interior-design visualization by editing the supplied real room photograph.',
    'This is a cabinetry and wood-interior project for NOVA CABINET.',
    preserve
      ? 'CRITICAL: preserve the exact existing room architecture, camera angle, perspective, wall positions, windows, doors, ceiling, floor, plumbing/electrical fixtures, appliance positions, cabinet layout, cabinet count, dimensions, and all built-in geometry. Do not move, resize, add, or remove any structural or fixed element. Only refine cabinet door finishes, colors, handles, countertop finish, and decorative surface materials.'
      : 'Keep the room architecture and camera perspective believable and unchanged. You may propose a coherent new cabinet arrangement only where it fits the existing room and does not alter structural walls, windows, doors, or fixed utilities.',
    'Design style: ' + String(row.style ?? 'modern'),
    'Cabinet door material: ' + String(row.door_material ?? "designer's best matching premium material"),
    'Countertop material: ' + String(row.countertop_material ?? 'coordinated premium countertop'),
    'Material/color codes: ' + String(row.material_codes ?? 'choose a harmonious warm neutral palette'),
    'Customer brief: ' + (instructions || 'Create a refined, functional, high-end design.'),
    'Use realistic joinery, plausible cabinet proportions, accurate lighting and shadows, premium wood grain, refined hardware, natural material texture, editorial architectural photography. No text, no watermark, no logos, no collage, no split-screen.'
  ].join('\n');
}
function validFalQueueUrl(value) {
  try { const u = new URL(String(value)); return u.protocol === 'https:' && u.hostname === 'queue.fal.run'; }
  catch { return false; }
}
function validFalImageUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' &&
      (u.hostname === 'storage.googleapis.com' || u.hostname === 'fal.media' || u.hostname.endsWith('.fal.media'));
  } catch { return false; }
}
async function handlePublicAiStart(body, key, req, res, responseHeaders, error) {
  const account = await verifyPublicAiAccount(cleanString(body.session_jwt, 4096), error);
  if (!account) return reply(res, { ok: false, code: 'INVALID_AI_SESSION' }, 401, responseHeaders);
  const requestId = cleanRowId(body.request_id);
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return reply(res, { ok: false, code: 'INVALID_REQUEST_ID' }, 400, responseHeaders);
  }
  const falKey = cleanString(process.env.FAL_KEY, 500);
  if (!falKey) return reply(res, { ok: false, code: 'AI_GENERATION_NOT_CONFIGURED' }, 503, responseHeaders);
  const current = await getRow('ai_design_requests', requestId, key);
  if (!current.response.ok || current.data.$id !== requestId) return reply(res, { ok: false, code: 'AI_REQUEST_NOT_FOUND' }, 404, responseHeaders);
  const row = current.data;
  if (row.payment_status !== 'paid') return reply(res, { ok: false, code: 'PAYMENT_REQUIRED' }, 409, responseHeaders);
  if (!row.price_accepted_at || Number(row.price_accepted_amount_toman) !== Number(row.quoted_price_toman)) {
    return reply(res, { ok: false, code: 'PRICE_ACCEPTANCE_REQUIRED' }, 409, responseHeaders);
  }
  if (!row.upload_completed_at || !row.file_key) return reply(res, { ok: false, code: 'UPLOAD_NOT_COMPLETE' }, 409, responseHeaders);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(row.mime_type)) {
    return reply(res, { ok: false, code: 'IMAGE_FORMAT_NOT_SUPPORTED' }, 415, responseHeaders);
  }
  const source = await api('/storage/buckets/nova-ai-designs/files/' + encodeURIComponent(row.file_key), key);
  if (!source.response.ok || !ownsPrivateFile(source.data, account.$id)) {
    return reply(res, { ok: false, code: 'AI_UPLOAD_NOT_OWNED' }, 403, responseHeaders);
  }
  if (row.fal_request_id) return reply(res, { ok: true, code: 'AI_GENERATION_ALREADY_STARTED', status: row.status || 'processing' }, 200, responseHeaders);
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const token = await api('/storage/buckets/nova-ai-designs/files/' + encodeURIComponent(row.file_key) + '/tokens', key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expire: expires })
  });
  if (!token.response.ok || !token.data.secret) {
    error('NOVA AI source file token creation failed: HTTP ' + token.response.status);
    return reply(res, { ok: false, code: 'SOURCE_FILE_TOKEN_FAILED' }, 502, responseHeaders);
  }
  const sourceUrl = ENDPOINT + '/storage/buckets/nova-ai-designs/files/' +
    encodeURIComponent(row.file_key) + '/view?project=' + encodeURIComponent(PROJECT_ID) +
    '&token=' + encodeURIComponent(token.data.secret);
  const submitted = await fetch('https://queue.fal.run/google/nano-banana-2.1/edit', {
    method: 'POST',
    headers: { 'Authorization': 'Key ' + falKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: aiDesignPrompt(row),
      image_urls: [sourceUrl],
      num_images: 1,
      resolution: '2K',
      output_format: 'png'
    })
  });
  const queued = await submitted.json().catch(() => ({}));
  if (!submitted.ok || !queued.request_id || !validFalQueueUrl(queued.status_url) || !validFalQueueUrl(queued.response_url)) {
    error('NOVA AI FAL queue submission failed: HTTP ' + submitted.status);
    return reply(res, { ok: false, code: 'FAL_SUBMIT_FAILED' }, 502, responseHeaders);
  }
  const now = new Date().toISOString();
  const updated = await updateRow('ai_design_requests', requestId, {
    fal_request_id: String(queued.request_id),
    fal_status_url: queued.status_url,
    fal_response_url: queued.response_url,
    status: 'processing',
    generation_started_at: now,
    updated_at: now
  }, key);
  if (!updated.response.ok) return reply(res, { ok: false, code: 'FAL_REQUEST_TRACKING_FAILED' }, 502, responseHeaders);
  return reply(res, { ok: true, code: 'AI_GENERATION_STARTED', request_number: row.request_number, status: 'processing' }, 202, responseHeaders);
}
async function handlePublicAiCheck(body, key, req, res, responseHeaders, error) {
  const account = await verifyPublicAiAccount(cleanString(body.session_jwt, 4096), error);
  if (!account) return reply(res, { ok: false, code: 'INVALID_AI_SESSION' }, 401, responseHeaders);
  const requestId = cleanRowId(body.request_id);
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return reply(res, { ok: false, code: 'INVALID_REQUEST_ID' }, 400, responseHeaders);
  }
  const current = await getRow('ai_design_requests', requestId, key);
  if (!current.response.ok || current.data.$id !== requestId) return reply(res, { ok: false, code: 'AI_REQUEST_NOT_FOUND' }, 404, responseHeaders);
  const row = current.data;
  const source = await api('/storage/buckets/nova-ai-designs/files/' + encodeURIComponent(row.file_key || requestId), key);
  if (!source.response.ok || !ownsPrivateFile(source.data, account.$id)) return reply(res, { ok: false, code: 'AI_UPLOAD_NOT_OWNED' }, 403, responseHeaders);
  if (row.output_file_key) return reply(res, { ok: true, code: 'AI_PREVIEW_READY', status: 'preview_ready', output_file_key: row.output_file_key, description: row.output_description || '' }, 200, responseHeaders);
  if (!row.fal_request_id || !validFalQueueUrl(row.fal_status_url) || !validFalQueueUrl(row.fal_response_url)) {
    return reply(res, { ok: false, code: 'AI_GENERATION_NOT_STARTED' }, 409, responseHeaders);
  }
  const falKey = cleanString(process.env.FAL_KEY, 500);
  if (!falKey) return reply(res, { ok: false, code: 'AI_GENERATION_NOT_CONFIGURED' }, 503, responseHeaders);
  const auth = { 'Authorization': 'Key ' + falKey };
  const statusResponse = await fetch(row.fal_status_url, { headers: auth });
  const state = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) return reply(res, { ok: false, code: 'FAL_STATUS_CHECK_FAILED' }, 502, responseHeaders);
  if (state.status !== 'COMPLETED') {
    const status = state.status === 'IN_QUEUE' ? 'queued' : 'processing';
    return reply(res, { ok: true, code: 'AI_GENERATION_IN_PROGRESS', status, queue_position: state.queue_position ?? null }, 200, responseHeaders);
  }
  const resultResponse = await fetch(row.fal_response_url, { headers: auth });
  const result = await resultResponse.json().catch(() => ({}));
  if (!resultResponse.ok) {
    const note = 'Fal generation failed: ' + String(result.detail ?? result.error ?? 'unknown').slice(0, 500);
    await updateRow('ai_design_requests', requestId, { status: 'revision_requested', admin_note: note, updated_at: new Date().toISOString() }, key);
    return reply(res, { ok: false, code: 'FAL_GENERATION_FAILED' }, 502, responseHeaders);
  }
  const imageUrl = result?.images?.[0]?.url;
  const description = cleanString(result.description, 3000);
  if (!validFalImageUrl(imageUrl)) return reply(res, { ok: false, code: 'FAL_OUTPUT_URL_REJECTED' }, 502, responseHeaders);
  const imageResponse = await fetch(imageUrl);
  const contentType = cleanString(imageResponse.headers.get('content-type') || '', 100).split(';')[0].toLowerCase();
  const length = Number(imageResponse.headers.get('content-length') || '0');
  if (!imageResponse.ok || !contentType.startsWith('image/') || (length && length > 25 * 1024 * 1024)) {
    return reply(res, { ok: false, code: 'AI_OUTPUT_DOWNLOAD_FAILED' }, 502, responseHeaders);
  }
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) return reply(res, { ok: false, code: 'AI_OUTPUT_TOO_LARGE' }, 413, responseHeaders);
  const extension = contentType === 'image/webp' ? 'webp' : contentType === 'image/jpeg' ? 'jpg' : 'png';
  const outputId = crypto.randomUUID();
  const form = new FormData();
  form.append('fileId', outputId);
  form.append('file', new Blob([bytes], { type: contentType }), 'NOVA-' + row.request_number + '-preview.' + extension);
  for (const permission of ['read("user:' + account.$id + '")', 'update("user:' + account.$id + '")', 'delete("user:' + account.$id + '")']) {
    form.append('permissions[]', permission);
  }
  const uploadResponse = await fetch(ENDPOINT + '/storage/buckets/nova-ai-designs/files', {
    method: 'POST',
    headers: { 'X-Appwrite-Project': PROJECT_ID, 'X-Appwrite-Key': key },
    body: form
  });
  const uploaded = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || uploaded.$id !== outputId) {
    error('NOVA AI output storage failed: HTTP ' + uploadResponse.status);
    return reply(res, { ok: false, code: 'AI_OUTPUT_STORAGE_FAILED' }, 502, responseHeaders);
  }
  const now = new Date().toISOString();
  const updated = await updateRow('ai_design_requests', requestId, {
    output_file_key: outputId,
    output_description: description,
    generated_at: now,
    status: 'preview_ready',
    updated_at: now
  }, key);
  if (!updated.response.ok) return reply(res, { ok: false, code: 'AI_OUTPUT_TRACKING_FAILED' }, 502, responseHeaders);
  return reply(res, { ok: true, code: 'AI_PREVIEW_READY', status: 'preview_ready', output_file_key: outputId, description }, 200, responseHeaders);
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
    if (['public_create_ai_design_request','public_confirm_ai_design_upload','public_accept_ai_design_price','public_start_ai_design','public_check_ai_design'].includes(earlyBody.action)) {
      if (!earlyKey) return reply(res, { ok: false, code: 'FUNCTION_KEY_UNAVAILABLE' }, 503, responseHeaders);
      if (!ALLOWED_ORIGINS.has(origin)) return reply(res, { ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, responseHeaders);
      if (earlyBody.action === 'public_create_ai_design_request') return handlePublicAiCreate(earlyBody, earlyKey, req, res, responseHeaders, error);
      if (earlyBody.action === 'public_confirm_ai_design_upload') return handlePublicAiConfirmUpload(earlyBody, earlyKey, req, res, responseHeaders, error);
      if (earlyBody.action === 'public_accept_ai_design_price') return handlePublicAiAcceptPrice(earlyBody, earlyKey, req, res, responseHeaders, error);
      if (earlyBody.action === 'public_start_ai_design') return handlePublicAiStart(earlyBody, earlyKey, req, res, responseHeaders, error);
      return handlePublicAiCheck(earlyBody, earlyKey, req, res, responseHeaders, error);
    }
    if (earlyBody.action === 'public_create_order') {
      if (!earlyKey) return reply(res, { ok: false, code: 'FUNCTION_KEY_UNAVAILABLE' }, 503, responseHeaders);
      if (!ALLOWED_ORIGINS.has(origin)) return reply(res, { ok: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, responseHeaders);
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
        ? ['health', 'list_orders', 'list_order_assignees', 'list_order_status_history', 'list_ai_requests', 'list_ai_pricing']
        : ['health', 'list_orders', 'list_order_status_history', 'list_ai_requests', 'list_ai_pricing',
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

    if (action === 'list_order_assignees') {
      const result = await listRows('app_users', key, 500);
      const rows = result.rows
        .filter((row) => row.is_active === true && ['owner_admin', 'factory_manager'].includes(row.role))
        .map((row) => ({ $id: row.$id, full_name: cleanString(row.full_name, 160), role: row.role }))
        .filter((row) => row.full_name);
      return reply(res, { ok: true, code: 'ORDER_ASSIGNEES_LOADED', rows, total: rows.length }, 200, responseHeaders);
    }

    if (action === 'list_order_status_history') {
      const orderId = cleanRowId(body.order_id);
      if (!orderId) return reply(res, { ok: false, code: 'INVALID_ORDER_ID' }, 400, responseHeaders);
      const order = await getRow('orders', orderId, key);
      if (!order.response.ok || order.data.$id !== orderId) return reply(res, { ok: false, code: 'ORDER_NOT_FOUND' }, 404, responseHeaders);
      const result = await listRows('order_status_history', key, 1000);
      const rows = result.rows
        .filter((row) => {
          const ref = row.order;
          return (typeof ref === 'string' ? ref : ref && ref.$id) === orderId;
        })
        .sort((x, y) => String(y.changed_at || '').localeCompare(String(x.changed_at || '')))
        .map((row) => ({
          $id: row.$id,
          old_status: row.old_status || null,
          new_status: row.new_status || null,
          note: row.note || null,
          changed_by: row.changed_by || null,
          changed_at: row.changed_at || null
        }));
      return reply(res, { ok: true, code: 'ORDER_HISTORY_LOADED', rows, total: rows.length }, 200, responseHeaders);
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
