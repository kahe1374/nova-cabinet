const ENDPOINT='https://fra.cloud.appwrite.io/v1', PROJECT_ID='6afcbe4e002df50df86f', DATABASE_ID='6afcc05300302d503754';
const ALLOWED_ORIGINS=new Set(['https://kahe1374.github.io']);
function header(h,n){const k=Object.keys(h||{}).find(x=>x.toLowerCase()===n.toLowerCase());return k?h[k]:'';}
function cors(origin){return {...(origin?{'Access-Control-Allow-Origin':origin}:{}),'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'};}
function reply(res,p,s=200,h={}){return res.json(p,s,h);}
async function api(path,key,options={}){const r=await fetch(ENDPOINT+path,{...options,headers:{'X-Appwrite-Project':PROJECT_ID,'X-Appwrite-Key':key,...(options.headers||{})}});const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{throw new Error('APPWRITE_INVALID_RESPONSE');}return {response:r,data};}
async function createRow(table,data,key){return api('/tablesdb/'+DATABASE_ID+'/tables/'+encodeURIComponent(table)+'/rows',key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rowId:'unique()',data,permissions:[]})});}
async function deleteRow(table,id,key){return api('/tablesdb/'+DATABASE_ID+'/tables/'+encodeURIComponent(table)+'/rows/'+encodeURIComponent(id),key,{method:'DELETE'});}
function normalizeMobile(value){const m=String(value??'').replace(/[\\s-]/g,'');if(!/^(09\\d{9}|\\+989\\d{9}|00989\\d{9})$/.test(m))return '';return m.startsWith('09')?'+98'+m.slice(1):m.startsWith('0098')?'+'+m.slice(2):m;}
export default async ({req,res,log,error})=>{
 const origin=header(req.headers,'origin'),headers=cors(origin);
 try{
  if(origin&&!ALLOWED_ORIGINS.has(origin))return reply(res,{ok:false,code:'ORIGIN_NOT_ALLOWED'},403,headers);
  if(req.method==='OPTIONS')return reply(res,{},204,headers);
  if(req.method!=='POST')return reply(res,{ok:false,code:'METHOD_NOT_ALLOWED'},405,headers);
  const key=header(req.headers,'x-appwrite-key');if(!key)return reply(res,{ok:false,code:'FUNCTION_KEY_UNAVAILABLE'},503,headers);
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});
  if(new TextEncoder().encode(raw).byteLength>12000)return reply(res,{ok:false,code:'REQUEST_TOO_LARGE'},413,headers);
  let body;try{body=JSON.parse(raw||'{}');}catch{return reply(res,{ok:false,code:'INVALID_JSON'},400,headers);}
  if(!body||typeof body!=='object'||Array.isArray(body))return reply(res,{ok:false,code:'INVALID_REQUEST_BODY'},400,headers);
  if(typeof body.website==='string'&&body.website.trim())return reply(res,{ok:true},200,headers);
  const name=String(body.name??'').trim().slice(0,160),mobile=normalizeMobile(body.phone);
  const title=String(body.type??'').trim().slice(0,200),orderType=String(body.order_type??'cabinet').trim();
  const city=String(body.city??'').trim().slice(0,100),details=String(body.details??'').trim().slice(0,3000);
  if(name.length<2||!mobile||!title||!['cabinet','workshop_service'].includes(orderType))return reply(res,{ok:false,code:'INVALID_FORM'},400,headers);
  const now=new Date().toISOString();
  const customer=await createRow('customers',{full_name:name,mobile,city:city||null,notes:'درخواست ثبت‌شده از سایت NOVA CABINET',created_at:now,updated_at:now},key);
  if(!customer.response.ok||!customer.data.$id){log('NOVA intake customer creation failed: HTTP '+customer.response.status);return reply(res,{ok:false,code:'CUSTOMER_SAVE_FAILED'},502,headers);}
  const orderNumber='NV-'+crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
  const order=await createRow('orders',{order_number:orderNumber,customer:customer.data.$id,order_type:orderType,title,description:[city?'شهر: '+city:'',details].filter(Boolean).join('\\n')||null,status:'new',currency:'IRR',paid_amount:0,created_at:now,updated_at:now},key);
  if(!order.response.ok||!order.data.$id){
   log('NOVA intake order creation failed: HTTP '+order.response.status);
   const cleanup=await deleteRow('customers',customer.data.$id,key);
   if(!cleanup.response.ok){error('NOVA intake customer cleanup failed: HTTP '+cleanup.response.status);return reply(res,{ok:false,code:'CUSTOMER_CLEANUP_FAILED',partial:true},502,headers);}
   return reply(res,{ok:false,code:'ORDER_SAVE_FAILED'},502,headers);
  }
  return reply(res,{ok:true,order_number:orderNumber},201,headers);
 }catch(err){error('NOVA public intake failed: '+(err&&err.message?err.message:'unknown'));return reply(res,{ok:false,code:'INTAKE_FAILED'},500,headers);}
};
