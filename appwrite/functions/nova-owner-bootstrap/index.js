const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6afcbe4e002df50df86f';
const DATABASE_ID = '6afcc05300302d503754';
const TABLE_ID = 'app_users';
const OWNER_EMAIL = 'Vahiiidk74@gmail.com';
const OWNER_NAME = 'Vahidkahe';
const OWNER_MOBILE = '09223685532';

function json(res, payload, status = 200) {
  return res.json(payload, status);
}

function headerValue(headers, wanted) {
  const key = Object.keys(headers || {}).find(
    (name) => name.toLowerCase() === wanted.toLowerCase()
  );
  return key ? headers[key] : '';
}

async function request(path, authHeader, authValue, options = {}) {
  const response = await fetch(APPWRITE_ENDPOINT + path, {
    ...options,
    headers: {
      'X-Appwrite-Project': PROJECT_ID,
      [authHeader]: authValue,
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error('Appwrite returned an unreadable response.');
  }
  return { response, data };
}

export default async ({ req, res, log, error }) => {
  try {
    if (req.method !== 'POST') {
      return json(res, { ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    }

    const jwt = headerValue(req.headers, 'x-appwrite-user-jwt');
    const functionKey = headerValue(req.headers, 'x-appwrite-key');
    if (!jwt) {
      return json(res, { ok: false, code: 'AUTHENTICATION_REQUIRED' }, 401);
    }
    if (!functionKey) {
      error('Appwrite ephemeral function key was not provided.');
      return json(res, { ok: false, code: 'FUNCTION_KEY_UNAVAILABLE' }, 503);
    }

    // Verify the caller's session with Appwrite. Never trust body-supplied identity or role.
    const accountResult = await request('/account', 'X-Appwrite-JWT', jwt);
    if (!accountResult.response.ok) {
      return json(res, { ok: false, code: 'INVALID_SESSION' }, 401);
    }

    const account = accountResult.data;
    if (
      typeof account.email !== 'string' ||
      account.email.toLowerCase() !== OWNER_EMAIL.toLowerCase()
    ) {
      return json(res, { ok: false, code: 'NOT_AUTHORIZED_FOR_OWNER_BOOTSTRAP' }, 403);
    }
    if (account.emailVerification !== true) {
      return json(res, { ok: false, code: 'EMAIL_NOT_VERIFIED' }, 403);
    }
    if (!account.$id || !/^[A-Za-z0-9._-]{1,36}$/.test(account.$id)) {
      return json(res, { ok: false, code: 'INVALID_ACCOUNT_ID' }, 400);
    }

    // Server-side ephemeral key is restricted by this function's rows.read/rows.write scopes.
    const rowId = encodeURIComponent(account.$id);
    const rowPath =
      '/tablesdb/' + DATABASE_ID + '/tables/' + TABLE_ID + '/rows/' + rowId;

    const existing = await request(rowPath, 'X-Appwrite-Key', functionKey);
    if (existing.response.ok) {
      const row = existing.data;
      if (
        row.role === 'owner_admin' &&
        row.email &&
        row.email.toLowerCase() === OWNER_EMAIL.toLowerCase() &&
        row.is_active === true
      ) {
        return json(res, { ok: true, code: 'OWNER_ALREADY_BOOTSTRAPPED' }, 200);
      }
      return json(res, { ok: false, code: 'ACCOUNT_ROW_CONFLICT' }, 409);
    }
    if (existing.response.status !== 404) {
      error('Owner bootstrap could not safely inspect account row. HTTP ' + existing.response.status);
      return json(res, { ok: false, code: 'ROW_CHECK_FAILED' }, 503);
    }

    const userRole = 'user:' + account.$id;
    const created = await request(
      '/tablesdb/' + DATABASE_ID + '/tables/' + TABLE_ID + '/rows',
      'X-Appwrite-Key',
      functionKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowId: account.$id,
          data: {
            full_name: OWNER_NAME,
            mobile: OWNER_MOBILE,
            email: OWNER_EMAIL,
            role: 'owner_admin',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          permissions: [
            'read("' + userRole + '")',
            'update("' + userRole + '")'
          ]
        })
      }
    );

    if (created.response.ok) {
      log('NOVA initial owner row created.');
      return json(res, { ok: true, code: 'OWNER_BOOTSTRAPPED' }, 201);
    }

    // If two valid requests race, verify the deterministic row created by the winner.
    if (created.response.status === 409) {
      const retryCheck = await request(rowPath, 'X-Appwrite-Key', functionKey);
      if (
        retryCheck.response.ok &&
        retryCheck.data.role === 'owner_admin' &&
        retryCheck.data.email &&
        retryCheck.data.email.toLowerCase() === OWNER_EMAIL.toLowerCase() &&
        retryCheck.data.is_active === true
      ) {
        return json(res, { ok: true, code: 'OWNER_ALREADY_BOOTSTRAPPED' }, 200);
      }
    }

    error('Owner bootstrap row creation failed. HTTP ' + created.response.status);
    if (created.response.status === 401 || created.response.status === 403) {
      return json(res, { ok: false, code: 'FUNCTION_ROW_SCOPES_REQUIRED' }, 503);
    }
    return json(res, { ok: false, code: 'OWNER_BOOTSTRAP_FAILED' }, 503);
  } catch (err) {
    error('Owner bootstrap failed safely: ' + (err && err.message ? err.message : 'unknown error'));
    return json(res, { ok: false, code: 'INTERNAL_ERROR' }, 500);
  }
};
