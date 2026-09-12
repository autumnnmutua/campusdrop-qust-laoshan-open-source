'use strict';
// Same-origin bridge. CampusDrop authorization is still checked by the existing Worker.
// No Tencent credentials, SDK login token, user id or password are embedded here.
function failure(statusCode,code,message){return {statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify({error:{code,message}}),isBase64Encoded:false};}
function exactOrigin(value){try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value?u.origin:null;}catch{return null;}}
exports.createHandler=(settings,fetchImpl=fetch)=>async event=>{
 const appOrigin=exactOrigin(settings.APP_ORIGIN),upstream=exactOrigin(settings.UPSTREAM_ORIGIN);
 if(!appOrigin||!upstream)return failure(503,'DEPLOYMENT_CONFIG_REQUIRED','请配置 CloudBase 网站实际 HTTPS 域名');
 const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),String(v)]));
 const method=String(event.httpMethod||event.requestContext?.http?.method||'').toUpperCase();
 if(!['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].includes(method))return failure(405,'METHOD_NOT_ALLOWED','请求方法不支持');
 // Do not trust client-controlled Host, Referer, userId, forwarding or authorization headers.
 if(!['GET','HEAD'].includes(method)&&headers.origin!==appOrigin)return failure(403,'ORIGIN_REJECTED','请从本站页面提交操作');
 if(headers['sec-fetch-site']==='cross-site')return failure(403,'ORIGIN_REJECTED','请从本站页面提交操作');
 if(method==='OPTIONS')return {statusCode:204,headers:{'cache-control':'no-store'},body:''};
 const path=event.path||event.rawPath||'';
 if(!/^\/api\/v1\/[a-zA-Z0-9/_-]+$/.test(path)||path.includes('//'))return failure(404,'NOT_FOUND','接口不存在');
 const url=new URL(upstream+path);
 for(const [key,value] of Object.entries(event.queryStringParameters||{}))if(value!==null&&value!==undefined)url.searchParams.set(key,String(value));
 const outgoing={Accept:'application/json',Origin:upstream};
 if(headers['content-type'])outgoing['Content-Type']=headers['content-type'];
 // Pass only this app's session cookies. Never forward CloudBase/admin gateway credentials.
 if(headers.cookie){const cookies=headers.cookie.split(';').map(v=>v.trim()).filter(v=>/^__Host-campusdrop_(student|admin)=[a-f0-9]{64}$/.test(v));
  const names=cookies.map(v=>v.split('=')[0]);if(new Set(names).size!==names.length)return failure(401,'SESSION_INVALID','登录状态异常，请重新登录');outgoing.Cookie=cookies.join('; ');}
 const encoded=event.body||'';
 if(typeof encoded!=='string'||encoded.length>12000)return failure(413,'BODY_TOO_LARGE','提交内容过长');
 const body=event.isBase64Encoded?Buffer.from(encoded,'base64'):Buffer.from(encoded);
 if(body.length>8192)return failure(413,'BODY_TOO_LARGE','提交内容过长');
 try{
  const r=await fetchImpl(url,{method,headers:outgoing,body:['GET','HEAD'].includes(method)||!encoded?undefined:body,redirect:'manual',signal:AbortSignal.timeout(24000)});
  if(r.status>=300&&r.status<400)return failure(502,'UPSTREAM_UNAVAILABLE','业务服务暂时不可用，请稍后查询订单状态');
  if(!(r.headers.get('content-type')||'').includes('application/json'))return failure(502,'UPSTREAM_UNAVAILABLE','业务服务暂时不可用，请稍后查询订单状态');
  const resultHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
  const cookies=r.headers.getSetCookie?r.headers.getSetCookie():[r.headers.get('set-cookie')].filter(Boolean);
  // Worker cookie has no Domain and is Secure/HttpOnly/Strict, thus becomes CloudBase host-only.
  if(cookies.length===1&&/^__Host-campusdrop_(student|admin)=/.test(cookies[0]))resultHeaders['set-cookie']=cookies[0];
  if(r.headers.has('x-request-id'))resultHeaders['x-request-id']=r.headers.get('x-request-id');
  if(r.headers.has('retry-after'))resultHeaders['retry-after']=r.headers.get('retry-after');
  return {statusCode:r.status,headers:resultHeaders,body:await r.text(),isBase64Encoded:false};
 }catch{return failure(502,'UPSTREAM_UNAVAILABLE','网络暂时不可用。如刚提交支付或订单，请先刷新确认结果，勿重复提交。');}
};
exports.main=event=>exports.createHandler(process.env)(event);
