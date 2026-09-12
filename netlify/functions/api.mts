import type {Context,Config} from '@netlify/functions';
import {createHandler} from '../../cloudbase/functions/campusdrop-api/index.js';
export default async (request:Request,context:Context)=>{
 const appOrigin=Netlify.env.get('APP_ORIGIN')??context.site.url,upstream=Netlify.env.get('UPSTREAM_ORIGIN');
 const failure=(status:number,message:string)=>Response.json({error:{code:'DEPLOYMENT_CONFIG_REQUIRED',message}},{status,headers:{'Cache-Control':'no-store'}});
 if(!upstream)return failure(503,'业务上游未配置');
 const chunks:Uint8Array[]=[];let size=0;const reader=request.body?.getReader();
 if(reader){while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>8192){await reader.cancel();return failure(413,'提交内容过长');}chunks.push(next.value);}}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const url=new URL(request.url),handler=createHandler({APP_ORIGIN:appOrigin,UPSTREAM_ORIGIN:upstream});
 const result=await handler({httpMethod:request.method,path:url.pathname,queryStringParameters:Object.fromEntries(url.searchParams),headers:Object.fromEntries(request.headers),body:new TextDecoder().decode(bytes)});
 return new Response(result.statusCode===204?null:result.body,{status:result.statusCode,headers:result.headers});
};
export const config:Config={path:'/api/*'};
