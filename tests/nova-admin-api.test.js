import test from 'node:test';
import assert from 'node:assert/strict';

const ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT = '6afcbe4e002df50df86f';
const OWNER_ID = '6afdf252002cc39270ab';
const OWNER_EMAIL = 'Vahiiidk74@gmail.com';

function makeRes() {
  return { payload: null, status: 200, json(p, s=200) { this.payload=p; this.status=s; return p; } };
}
async function invoke({jwt='test-jwt', key='runtime-key', accountStatus=200, account={}, ownerStatus=200, owner={}}={}) {
  const oldFetch = global.fetch;
  global.fetch = async (url, opts={}) => {
    if (url === ENDPOINT + '/account') return new Response(JSON.stringify(account), {status:accountStatus});
    if (url.includes('/tablesdb/') && url.includes('/tables/app_users/rows/')) return new Response(JSON.stringify(owner), {status:ownerStatus});
    throw new Error('Unexpected mocked request: '+url);
  };
  const res=makeRes();
  const handler=(await import('../appwrite/functions/nova-admin-api/index.js?test='+Math.random())).default;
  try {
    await handler({method:'POST',headers:{'x-appwrite-user-jwt':jwt,'x-appwrite-key':key},body:{action:'health'}},res,{},{});
  } finally { global.fetch=oldFetch; }
  return res;
}
test('rejects missing user JWT before network access', async()=>{
 const r=await invoke({jwt:''}); assert.equal(r.status,401); assert.equal(r.payload.code,'AUTHENTICATION_REQUIRED');
});
test('rejects invalid session', async()=>{
 const r=await invoke({accountStatus:401}); assert.equal(r.status,401); assert.equal(r.payload.code,'INVALID_SESSION');
});
test('rejects unverified or non-owner account', async()=>{
 const r=await invoke({account:{$id:'someone',email:'other@example.com',emailVerification:true}});
 assert.equal(r.status,403); assert.equal(r.payload.code,'OWNER_VERIFICATION_REQUIRED');
});
test('requires matching active owner row', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},ownerStatus:404});
 assert.equal(r.status,403); assert.equal(r.payload.code,'OWNER_ACCESS_DENIED');
});
test('health only after owner identity and row verified', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true}});
 assert.equal(r.status,200); assert.equal(r.payload.code,'OWNER_AUTHENTICATED'); assert.equal(r.payload.readOnly,false);
});
