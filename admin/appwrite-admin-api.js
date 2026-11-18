import { Client, Account, Functions } from 'https://cdn.jsdelivr.net/npm/appwrite@29.0.0/+esm';

const ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6afcbe4e002df50df86f';
const FUNCTION_ID = 'nova-admin-api';

export function createNovaAdminApi() {
  const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
  const account = new Account(client);
  const functions = new Functions(client);
  let ready = false;

  async function authenticate() {
    const user = await account.get();
    if (!user.email || user.email.toLowerCase() !== 'vahiiidk74@gmail.com' || user.emailVerification !== true) {
      throw new Error('OWNER_VERIFICATION_REQUIRED');
    }
    const token = await account.createJWT();
    if (!token || !token.jwt) throw new Error('OWNER_JWT_UNAVAILABLE');
    client.setJWT(token.jwt);
    ready = true;
    return { id: user.$id, email: user.email };
  }

  async function call(action, parameters = {}) {
    if (!ready) throw new Error('ADMIN_API_NOT_AUTHENTICATED');
    const result = await functions.createExecution({
      functionId: FUNCTION_ID,
      body: JSON.stringify({ action, ...parameters }),
      async: false,
      method: 'POST'
    });
    let payload = {};
    try { payload = JSON.parse(result.responseBody || '{}'); }
    catch { throw new Error('ADMIN_API_INVALID_RESPONSE'); }
    if (result.responseStatusCode < 200 || result.responseStatusCode >= 300 || payload.ok !== true) {
      const error = new Error(payload.code || 'ADMIN_API_REQUEST_FAILED');
      error.status = result.responseStatusCode;
      error.code = payload.code || 'ADMIN_API_REQUEST_FAILED';
      error.partial = payload.partial === true;
      throw error;
    }
    return payload;
  }

  function clear() {
    ready = false;
    client.setJWT('');
  }

  return Object.freeze({ authenticate, call, clear });
}
