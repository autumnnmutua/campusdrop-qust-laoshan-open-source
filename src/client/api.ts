export class RequestError extends Error {constructor(message:string,public requestId?:string){super(message);}}
export async function api<T>(path:string,method='GET',data?:unknown):Promise<T>{
 const readOnly=method==='GET'||method==='HEAD';
 for(let attempt=0;attempt<(readOnly?3:1);attempt++){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
   let response:Response;
   try{response=await fetch(`/api/v1${path}`,{method,credentials:'same-origin',signal:controller.signal,headers:data===undefined?undefined:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});}
   catch{if(readOnly&&attempt<2){await new Promise(r=>setTimeout(r,300*(attempt+1)));continue;}throw new RequestError(readOnly?'网络连接失败，请检查网络后点击刷新重试。':'提交结果尚未确认，请先刷新查看订单结果；注册请先尝试登录，勿重复提交。');}
   if(readOnly&&[502,503,504].includes(response.status)&&attempt<2){await response.body?.cancel();await new Promise(r=>setTimeout(r,500*(attempt+1)));continue;}
   const requestId=response.headers.get('X-Request-Id')??undefined;
   if(!(response.headers.get('content-type')??'').includes('application/json'))throw new RequestError(response.status===404?'业务服务尚未接通，请联系管理员检查 /api 路由。':'网络或业务网关暂时不可用，请稍后刷新查询操作结果。',requestId);
   let result:{error?:{message?:string;requestId?:string}};
   try{result=await response.json();}catch{throw new RequestError('服务响应不完整，请刷新查询操作结果。',requestId);}
   if(!response.ok){const id=result.error?.requestId??requestId;throw new RequestError((result.error?.message??'请求失败，请稍后重试')+(id?`（问题编号：${id}）`:''),id);}
   return result as T;
  }finally{clearTimeout(timeout);}
 }
 throw new RequestError('网络连接失败，请刷新重试。');
}
