import {z} from 'zod';
import type {Env} from './types';
import {ApiError,body,json} from './http';
import {requireAdmin,requireStudent,requireSuper} from './session';
import {digest,randomToken,verifyPassword,hashPassword} from '../domain/password';
import {usernameSchema,studentPasswordSchema,passwordSchema} from '../shared/contracts';
import {authRateLimit,rateLimit} from './rate-limit';
const kindSchema=z.enum(['student','admin']);
const resetSchema=z.object({kind:kindSchema,username:usernameSchema,code:z.string().regex(/^[a-f0-9]{64}$/),newPassword:z.string().min(6).max(128)}).strict();
async function issue(env:Env,kind:'student'|'admin',id:string,issuer:string,days=false,issuerPasswordHash:string){
 const token=randomToken(),hash=await digest(token),expiresAt=Math.floor(Date.now()/1000)+(days?2592000:900);
 const actorTable=days?(kind==='admin'?'admin_users':'users'):'admin_users',targetTable=kind==='admin'?'admin_users':'users';
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT INTO recovery_tokens(token_hash,actor_kind,actor_id,issued_by,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${actorTable} WHERE id=? AND status='ACTIVE' AND password_hash=? ${days?'':"AND role='SUPER_ADMIN'"}) AND EXISTS(SELECT 1 FROM ${targetTable} WHERE id=? AND status='ACTIVE' ${!days&&kind==='admin'?"AND role<>'SUPER_ADMIN'":''}) ON CONFLICT(actor_kind,actor_id) DO UPDATE SET token_hash=excluded.token_hash,issued_by=excluded.issued_by,expires_at=excluded.expires_at,used_at=NULL,replacement_hash=NULL`).bind(hash,kind,id,issuer,expiresAt,issuer,issuerPasswordHash,id),
  env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) SELECT ?,'SYSTEM',?,'RECOVERY_CODE_ISSUED',? WHERE EXISTS(SELECT 1 FROM recovery_tokens WHERE token_hash=?)").bind(crypto.randomUUID(),issuer,id,hash)
 ]);
 if(!results[0].meta.changes)throw new ApiError(409,'AUTH_CHANGED','账号权限或密码已变化，请重新登录后操作');
 return {code:token,expiresAt,message:'恢复码仅显示一次，请私下保存；重新生成会使旧码失效。'};
}
export async function recoveryRoutes(request:Request,env:Env){
 const path=new URL(request.url).pathname.replace('/api/v1','');
 if(path==='/auth/recovery/reset'&&request.method==='POST'){
  await authRateLimit(request,env,'recovery');const data=await body(request,resetSchema);
  await rateLimit(env,`recovery:${data.kind}:${data.username}`,5);
  const valid=(data.kind==='admin'?passwordSchema:studentPasswordSchema).safeParse(data.newPassword);if(!valid.success)throw new ApiError(400,'INVALID_PASSWORD',data.kind==='admin'?'管理员新密码至少12个字符':'学生新密码至少6个字符');
  const table=data.kind==='admin'?'admin_users':'users';
  const account=await env.DB.prepare(`SELECT id FROM ${table} WHERE username=? AND status='ACTIVE'`).bind(data.username).first<{id:string}>();
  const tokenHash=await digest(data.code),id=account?.id??'missing';
  const exists=await env.DB.prepare('SELECT token_hash FROM recovery_tokens WHERE token_hash=? AND actor_kind=? AND actor_id=? AND used_at IS NULL AND expires_at>unixepoch()').bind(tokenHash,data.kind,id).first();
  if(!exists)throw new ApiError(400,'RECOVERY_INVALID','账号或恢复码无效、已使用或已过期');
  const hash=await hashPassword(valid.data);
  const result=await env.DB.prepare(`UPDATE recovery_tokens SET used_at=unixepoch(),replacement_hash=? WHERE token_hash=? AND actor_kind=? AND actor_id=? AND used_at IS NULL AND expires_at>unixepoch() AND EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='ACTIVE')`).bind(hash,tokenHash,data.kind,id,id).run();
  if(!result.meta.changes)throw new ApiError(400,'RECOVERY_INVALID','恢复码无效或已使用');
  return json({ok:true,message:'密码已更新，旧会话已退出，请重新登录。'});
 }
 if(['/me/recovery-code','/admin/me/recovery-code'].includes(path)&&request.method==='POST'){
  const kind=path.startsWith('/admin')?'admin':'student';const actor=kind==='admin'?await requireAdmin(request,env):await requireStudent(request,env);
  await rateLimit(env,`recovery-issue:${actor.id}`,5);const data=await body(request,z.object({currentPassword:z.string().min(1).max(128)}).strict());
  const hash=await env.DB.prepare(`SELECT password_hash FROM ${kind==='admin'?'admin_users':'users'} WHERE id=?`).bind(actor.id).first<string>('password_hash');
  if(!hash||!await verifyPassword(data.currentPassword,hash))throw new ApiError(403,'INVALID_CREDENTIALS','当前密码不正确');
  return json(await issue(env,kind,actor.id,actor.id,true,hash));
 }
 if(path==='/admin/recovery/issue'&&request.method==='POST'){
  const admin=await requireAdmin(request,env);requireSuper(admin);await rateLimit(env,`admin-recovery:${admin.id}`,10);
  const data=await body(request,z.object({kind:kindSchema,username:usernameSchema,currentPassword:z.string().min(1).max(128),identityVerified:z.literal(true)}).strict());
  const hash=await env.DB.prepare('SELECT password_hash FROM admin_users WHERE id=?').bind(admin.id).first<string>('password_hash');
  if(!hash||!await verifyPassword(data.currentPassword,hash))throw new ApiError(403,'INVALID_CREDENTIALS','请验证当前管理员密码');
  const table=data.kind==='admin'?'admin_users':'users';
  const target=await env.DB.prepare(`SELECT id ${data.kind==='admin'?',role':''} FROM ${table} WHERE username=? AND status='ACTIVE'`).bind(data.username).first<{id:string;role?:string}>();
  if(!target)throw new ApiError(404,'NOT_FOUND','账号不存在或已停用');
  if(target.role==='SUPER_ADMIN')throw new ApiError(403,'SUPER_ADMIN_PROTECTED','超级管理员请使用本人恢复码或受控离线恢复流程');
  return json(await issue(env,data.kind,target.id,admin.id,false,hash));
 }
 return null;
}
