import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../admin/appwrite-admin-api.js', import.meta.url), 'utf8');

test('browser client uses only the public Appwrite endpoint and project identifiers', () => {
  assert.match(source, /https:\/\/fra\.cloud\.appwrite\.io\/v1/);
  assert.match(source, /FUNCTION_ID = 'nova-admin-api'/);
  assert.doesNotMatch(source, /APPWRITE_API_KEY|x-appwrite-key|secret[_-]?key/i);
});

test('browser client verifies exact owner identity and verified email using the active session', () => {
  assert.match(source, /OWNER_EMAIL = 'vahiiidk74@gmail\.com'/);
  assert.match(source, /const user = await account\.get\(\)/);
  assert.match(source, /user\.email\.toLowerCase\(\) !== OWNER_EMAIL/);
  assert.match(source, /user\.emailVerification !== true/);
  assert.doesNotMatch(source, /createJWT\(\)/);
});

test('function execution is synchronous and errors preserve partial-write information', () => {
  assert.match(source, /async: false/);
  assert.match(source, /payload\.partial === true/);
  assert.match(source, /error\.status = result\.responseStatusCode/);
});

test('client cannot call before authentication and exposes a session clear operation', () => {
  assert.match(source, /if \(!ready\) throw new Error\('ADMIN_API_NOT_AUTHENTICATED'\)/);
  assert.match(source, /function clear\(\)/);
  assert.match(source, /function clear\(\) \{ ready = false; \}/);
});
