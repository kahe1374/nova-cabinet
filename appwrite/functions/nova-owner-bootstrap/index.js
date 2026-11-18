const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6afcbe4e002df50df86f';
const DATABASE_ID = '6afcc05300302d503754';
const TABLE_ID = 'app_users';
const OWNER_EMAIL = 'Vahiiidk74@gmail.com';
const OWNER_NAME = 'Vahidkahe';
const OWNER_MOBILE = '09223685532';
const PAGE_SIZE = 100;
const MAX_ROWS_TO_SCAN = 10000;

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

// Read every app_users page so a pre-existing owner row cannot be overlooked
// because of a default page limit or an unindexed role query.
async function listAllAppUsers(functionKey) {
  const allRows = [];
  let offset = 0;
  let expectedTotal = null;

  while (true) {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset)
    });
    const result = await request(
      '/tablesdb/' + DATABASE_ID + '/tables/' + TABLE_ID + '/rows?' + params.toString(),
      'X-Appwrite-Key',
      functionKey
    );

    if (!result.response.ok || !Array.isArray(result.data.rows) ||
        !Number.isInteger(result.data.total)) {
      throw new Error('Could not safely enumerate app_users rows.');
    }

    if (expectedTotal === null) {
      expectedTotal = result.data.total;
      if (expectedTotal > MAX_ROWS_TO_SCAN) {
        throw new Error('app_users exceeds the safe bootstrap scan limit.');
      }
    } else if (result.data.total !== expectedTotal) {
      throw new Error('app_users changed during the bootstrap safety scan.');
    }

    allRows.push(...result.data.rows);
    if (allRows.length >= expectedTotal) break;
    if (result.data.rows.length === 0 || allRows.length > MAX_ROWS_TO_SCAN) {
      throw new Error('app_users pagination was incomplete.');
    }
    offset += result.data.rows.length;
  }

  if (allRows.length !== expectedTotal) {
    throw new Error('app_users scan did not return every row.');
  }
  return allRows;
}

function isValidOwnerRow(row, accountId) {
  return row &&
    row.$id === accountId &&
    row.role === 'owner_admin' &&
    typeof row.email === 'string' &&
    row.email.toLowerCase() === OWNER_EMAIL.toLowerCase() &&
    row.is_active === true;
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

    // Fail closed if the full owner table cannot be inspected.
    const rows = await listAllAppUsers(functionKey);
    const existingOwner = rows.find((row) => row.role === 'owner_admin');

    if (existingOwner) {
      if (isValidOwnerRow(existingOwner, account.$id)) {
        return json(res, { ok: true, code: 'OWNER_ALREADY_BOOTSTRAPPED' }, 200);
      }
      return json(res, { ok: false, code: 'OWNER_ALREADY_EXISTS' }, 409);
    }

    const existingAccountRow = rows.find((row) => row.$id === account.$id);
    if (existingAccountRow) {
      return json(res, { ok: false, code: 'ACCOUNT_ROW_CONFLICT' }, 409);
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

    // The deterministic row ID prevents duplicate rows for concurrent requests
    // from the one permitted Appwrite account.
    if (created.response.status === 409) {
      const retryCheck = await request(
        '/tablesdb/' + DATABASE_ID + '/tables/' + TABLE_ID + '/rows/' + encodeURIComponent(account.$id),
        'X-Appwrite-Key',
        functionKey
      );
      if (retryCheck.response.ok && isValidOwnerRow(retryCheck.data, account.$id)) {
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
