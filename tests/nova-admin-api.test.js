import test from 'node:test';
import assert from 'node:assert/strict';

const ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const PROJECT = '6afcbe4e002df50df86f';
const OWNER_ID = '6afdf252002cc39270ab';
const OWNER_EMAIL = 'Vahiiidk74@gmail.com';

function makeRes() {
  return { payload: null, status: 200, json(p, s=200) { this.payload=p; this.status=s; return p; } };
}
async function invoke({jwt='test-jwt', key='runtime-key', accountStatus=200, account={}, ownerStatus=200, owner={}, method='POST', body={action:'health'}}={}) {
  const oldFetch = global.fetch;
  const oldKey = process.env.APPWRITE_FUNCTION_API_KEY;
  const oldReadOnly = process.env.NOVA_ADMIN_API_READ_ONLY;
  process.env.APPWRITE_FUNCTION_API_KEY = key;
  process.env.NOVA_ADMIN_API_READ_ONLY = 'false';
  global.fetch = async (url, opts={}) => {
    if (url === ENDPOINT + '/account') return new Response(JSON.stringify(account), {status:accountStatus});
    if (url.includes('/tablesdb/') && url.includes('/tables/app_users/rows/')) return new Response(JSON.stringify(owner), {status:ownerStatus});
    throw new Error('Unexpected mocked request: '+url);
  };
  const res=makeRes();
  const handler=(await import('../appwrite/functions/nova-admin-api/index.js?test='+Math.random())).default;
  try {
    await handler({req:{method,headers:{'x-appwrite-user-jwt':jwt,'x-appwrite-key':key},body},res,log(){},error(){}});
  } finally {
    global.fetch=oldFetch;
    if (oldKey === undefined) delete process.env.APPWRITE_FUNCTION_API_KEY;
    else process.env.APPWRITE_FUNCTION_API_KEY = oldKey;
    if (oldReadOnly === undefined) delete process.env.NOVA_ADMIN_API_READ_ONLY;
    else process.env.NOVA_ADMIN_API_READ_ONLY = oldReadOnly;
  }
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

test('rejects non-POST methods', async()=>{
 const r=await invoke({method:'GET'});
 assert.equal(r.status,405); assert.equal(r.payload.code,'METHOD_NOT_ALLOWED');
});
test('rejects inactive owner row', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:false}});
 assert.equal(r.status,403); assert.equal(r.payload.code,'OWNER_ACCESS_DENIED');
});
test('rejects unsupported actions after authentication', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true},body:{action:'delete_everything'}});
 assert.equal(r.status,400); assert.equal(r.payload.code,'ACTION_NOT_SUPPORTED');
});
test('rejects invalid order status before any order lookup', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true},body:{action:'update_order_status',order_id:'123456789012345678901234567890123456',status:'admin'}});
 assert.equal(r.status,400); assert.equal(r.payload.code,'INVALID_ORDER_OR_STATUS');
});
test('rejects out-of-range AI pricing before database writes', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true},body:{action:'upsert_ai_pricing',style_key:'modern',style_label:'Modern',base_price_toman:1}});
 assert.equal(r.status,400); assert.equal(r.payload.code,'INVALID_PRICING');
});

test('rejects oversized request bodies', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true},body:' '.repeat(16385)});
 assert.equal(r.status,413); assert.equal(r.payload.code,'REQUEST_TOO_LARGE');
});
test('rejects non-object JSON bodies', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true},body:'[]'});
 assert.equal(r.status,400); assert.equal(r.payload.code,'INVALID_REQUEST_BODY');
});

test('rejects multibyte request bodies exceeding the byte limit', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true},body:'漢'.repeat(6000)});
 assert.equal(r.status,413); assert.equal(r.payload.code,'REQUEST_TOO_LARGE');
});

test('rejects overlong row identifiers instead of truncating them', async()=>{
 const oldFetch=global.fetch; const oldKey=process.env.APPWRITE_FUNCTION_API_KEY; const oldReadOnly=process.env.NOVA_ADMIN_API_READ_ONLY;
 process.env.NOVA_ADMIN_API_READ_ONLY='false';
 process.env.APPWRITE_FUNCTION_API_KEY='runtime-key';
 let tableLookups=0;
 global.fetch=async(url)=> {
  if(url===ENDPOINT+'/account') return new Response(JSON.stringify({$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true}),{status:200});
  if(url.includes('/tables/app_users/rows/')) return new Response(JSON.stringify({$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true}),{status:200});
  tableLookups++; return new Response('{}',{status:404});
 };
 try {
  const handler=(await import('../appwrite/functions/nova-admin-api/index.js?long-id-test')).default;
  const res=makeRes();
  await handler({req:{method:'POST',headers:{'x-appwrite-user-jwt':'jwt','x-appwrite-key':'untrusted-header-key'},body:{action:'update_order_status',order_id:'x'.repeat(37),status:'new'}},res,log(){},error(){}});
  assert.equal(res.status,400); assert.equal(res.payload.code,'INVALID_ORDER_OR_STATUS'); assert.equal(tableLookups,0);
 } finally { global.fetch=oldFetch; if(oldKey===undefined) delete process.env.APPWRITE_FUNCTION_API_KEY; else process.env.APPWRITE_FUNCTION_API_KEY=oldKey; }
});

test('health reports explicitly configured write mode', async()=>{
 const r=await invoke({account:{$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true},owner:{$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true}});
 assert.equal(r.status,200); assert.equal(r.payload.readOnly,false);
});
test('write actions are blocked in default read-only mode', async()=>{
 const oldFetch=global.fetch; const oldKey=process.env.APPWRITE_FUNCTION_API_KEY; const oldMode=process.env.NOVA_ADMIN_API_READ_ONLY;
 process.env.APPWRITE_FUNCTION_API_KEY='runtime-key'; delete process.env.NOVA_ADMIN_API_READ_ONLY;
 let writes=0;
 global.fetch=async(url,opts={})=>{
  if(url===ENDPOINT+'/account') return new Response(JSON.stringify({$id:OWNER_ID,email:OWNER_EMAIL,emailVerification:true}),{status:200});
  if(url.includes('/tables/app_users/rows/')) return new Response(JSON.stringify({$id:OWNER_ID,email:OWNER_EMAIL,role:'owner_admin',is_active:true}),{status:200});
  if(opts.method==='PATCH'||opts.method==='POST') writes++;
  return new Response('{}',{status:404});
 };
 try {
  const handler=(await import('../appwrite/functions/nova-admin-api/index.js?readonly-test')).default;
  const res=makeRes();
  await handler({req:{method:'POST',headers:{'x-appwrite-user-jwt':'jwt','x-appwrite-key':'runtime-key'},body:{action:'update_order_status',order_id:'order-1',status:'new'}},res,log(){},error(){}});
  assert.equal(res.status,423); assert.equal(res.payload.code,'API_READ_ONLY'); assert.equal(writes,0);
 } finally {
  global.fetch=oldFetch;
  if(oldKey===undefined) delete process.env.APPWRITE_FUNCTION_API_KEY; else process.env.APPWRITE_FUNCTION_API_KEY=oldKey;
  if(oldMode===undefined) delete process.env.NOVA_ADMIN_API_READ_ONLY; else process.env.NOVA_ADMIN_API_READ_ONLY=oldMode;
 }
});
