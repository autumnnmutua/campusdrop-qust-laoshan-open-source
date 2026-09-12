import type { Env } from './types';
import {ApiError} from './http';
const known=new Set(['health','auth','admin','me','orders','parcels','quotes','stations','dorm-buildings','login','logout','register','address','tasks','available','dashboard','batches','status','pickup-code','claim','release','handoffs','confirm','reject','recovery','recovery-code','reset','issue','errors','admins','scopes','disable','note','upgrade','cancel','hide','refund','mock-pay','tips','contact','audit','assignees','password','tickets','messages','read','read-all','receive','bulk-pickup']);
export function safeRoute(request:Request){const parts=new URL(request.url).pathname.split('/').slice(3,10);return '/api/v1/'+parts.map(p=>known.has(p)?p:':id').join('/');}
export function classifyError(error:unknown){
 const message=error instanceof Error?error.message:String(error);
 if(/SQLITE_BUSY|SQLITE_LOCKED|D1_ERROR.*(?:timeout|overloaded|unavailable|reset)|network connection lost/i.test(message))return 'DATABASE_TRANSIENT';
 if(/D1_ERROR|SQLITE_/i.test(message))return 'DATABASE_ERROR';
 return 'INTERNAL_ERROR';
}
export async function recordError(env:Env,request:Request,id:string,category:string,status:number){
 const event={requestId:id,route:safeRoute(request),method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(request.method)?request.method:'OTHER',category,status};
 // Only fixed categories and redacted route templates. Never log raw exceptions, headers, request bodies or query strings.
 console.error(JSON.stringify(event));
 try{await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO error_events(request_id,route,method,category,http_status) VALUES(?,?,?,?,?)').bind(id,event.route,event.method,category,status),env.DB.prepare('DELETE FROM error_events WHERE created_at<unixepoch()-604800'),env.DB.prepare('DELETE FROM error_events WHERE request_id IN (SELECT request_id FROM error_events ORDER BY created_at DESC,request_id DESC LIMIT -1 OFFSET 1000)')]);}catch{/* Database outage must not replace the original controlled response. */}
}
export function expectedConstraint(error:unknown):ApiError|null{
 const message=error instanceof Error?error.message:'';
 const mapping:Record<string,string>={STUDENT_RECEIPT_REQUIRED:'请等待学生确认收货',HANDOFF_REQUIRED:'包裹已取出，请先完成归还交接',HANDOFF_PENDING:'交接待核验，暂不能推进配送或取消',HANDOFF_INVALID:'交接状态已变化，请刷新后重试',RELEASE_NOT_ALLOWED:'当前订单不能退回市场，请检查交接及订单状态',ADMIN_HAS_TASKS:'管理员仍有未完成任务，请先处理交接',INVALID_TRANSITION:'订单状态已变化，请刷新',RECOVERY_INVALID:'恢复码无效或已过期'};
 for(const [code,text] of Object.entries(mapping))if(message.includes(code))return new ApiError(409,code,text);
 if(message.includes('UNIQUE constraint failed: parcel_handoffs.order_id'))return new ApiError(409,'HANDOFF_PENDING','已有交接申请，请刷新查看');
 return null;
}
