import {serviceRoutes} from './service-workflows';
import {recoveryRoutes} from './recovery';
import {recordError,classifyError,expectedConstraint} from './observability';
import type { Env } from './types';
import { z } from 'zod';
import { ApiError, body, checkOrigin, json } from './http';
import { adminContactSchema, addressSchema, CAMPUS_ID, createAdminSchema, loginSchema, profileSchema, registerSchema,roleSchema,scopeSchema } from '../shared/contracts';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../domain/password';
import { createSession, requireAdmin, requireStudent, requireSuper, revokeSession, localCookie } from './session';
import { authRateLimit, rateLimit } from './rate-limit';
import { deleteAddress, readAddress, saveAddress } from './addresses';
import { adminBuildings, createAdmin,updateAdminScopes } from './admin';
import { deliveryRoutes } from './delivery-routes';

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  checkOrigin(request, env);
  if (method === 'GET' && pathname === '/api/v1/health') return json({ service: 'CampusDrop', stage: 5 });
  if (method === 'GET' && pathname === '/api/v1/dorm-buildings') {
    const rows = await env.DB.prepare('SELECT code, display_name AS displayName, zone FROM dorm_buildings WHERE campus_id = ? AND active = 1 ORDER BY zone DESC, sort_order').bind(CAMPUS_ID).all();
    return json({ buildings: rows.results });
  }
  if (method === 'GET' && pathname === '/api/v1/stations') {
    const rows = await env.DB.prepare(`SELECT code, canonical_name AS canonicalName, aliases_json AS aliasesJson,
      relative_location AS relativeLocation, lat, lng FROM stations WHERE campus_id = ? AND active = 1`).bind(CAMPUS_ID).all();
    return json({ stations: rows.results });
  }
  if (method === 'POST' && pathname === '/api/v1/auth/register') {
    await authRateLimit(request, env, 'register');
    const data = await body(request, registerSchema);
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(data.password);
    try {
      await env.DB.prepare('INSERT INTO users(id, username, password_hash, name, phone) VALUES (?, ?, ?, ?, ?)')
        .bind(id, data.username, passwordHash, data.name, data.phone).run();
    } catch (error) {
      if (String(error).includes('UNIQUE constraint')) throw new ApiError(409, 'USERNAME_TAKEN', '该用户名已被使用');
      throw error;
    }
    return json({ user: { id, username: data.username, name: data.name, phone: data.phone } }, 201,
      { 'Set-Cookie': await createSession(request, env, 'student', id) });
  }
  if (method === 'POST' && ['/api/v1/auth/login', '/api/v1/admin/auth/login'].includes(pathname)) {
    const kind = pathname.includes('/admin/') ? 'admin' : 'student';
    await authRateLimit(request, env, `${kind}:login`);
    const data = await body(request, loginSchema);
    await rateLimit(env, `${kind}:username:${data.username}`, 8);
    // Table name comes exclusively from the fixed route, never from submitted input.
    const table = kind === 'admin' ? 'admin_users' : 'users';
    const account = await env.DB.prepare(`SELECT id, password_hash, status ${kind==='admin'?',development_only':''} FROM ${table} WHERE username = ?`)
      .bind(data.username).first<{ id: string; password_hash: string; status: string; development_only?: number }>();
    const valid = await verifyPassword(data.password, account?.password_hash ?? DUMMY_HASH);
    if (!valid || !account || account.status !== 'ACTIVE' || (account.development_only && !localCookie(request,env))) throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    return json({ ok: true }, 200, { 'Set-Cookie': await createSession(request, env, kind, account.id) });
  }
  if (method === 'POST' && ['/api/v1/auth/logout', '/api/v1/admin/auth/logout'].includes(pathname)) {
    return json({ ok: true }, 200, { 'Set-Cookie': await revokeSession(request, env, pathname.includes('/admin/') ? 'admin' : 'student') });
  }
  if (pathname === '/api/v1/me') {
    const user = await requireStudent(request, env);
    if (method === 'GET') return json({ user, address: await readAddress(env, user.id) });
    if (method === 'PATCH') {
      const data = await body(request, profileSchema);
      await env.DB.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').bind(data.name, data.phone, user.id).run();
      return json({ user: { ...user, ...data } });
    }
  }
  if (pathname === '/api/v1/me/address') {
    const user = await requireStudent(request, env);
    if (method === 'GET') return json({ address: await readAddress(env, user.id) });
    if (method === 'POST' || method === 'PUT') {
      const data = await body(request, addressSchema);
      return json({ address: await saveAddress(env, user.id, data, method === 'POST') }, method === 'POST' ? 201 : 200);
    }
    if (method === 'DELETE') { await deleteAddress(env, user.id); return json({ ok: true }); }
  }
  const recoveryResponse=await recoveryRoutes(request,env);if(recoveryResponse)return recoveryResponse;
  const serviceResponse=await serviceRoutes(request,env);if(serviceResponse)return serviceResponse;
  const deliveryResponse=await deliveryRoutes(request,env);
  if(deliveryResponse)return deliveryResponse;
  if (pathname.startsWith('/api/v1/admin/')) {
    const admin = await requireAdmin(request, env);
    if(method==='GET'&&pathname==='/api/v1/admin/errors'){
      requireSuper(admin);const events=await env.DB.prepare('SELECT request_id AS requestId,route,method,category,http_status AS status,created_at AS createdAt FROM error_events WHERE created_at>=unixepoch()-604800 ORDER BY created_at DESC,request_id DESC LIMIT 100').all();
      const counts=await env.DB.prepare('SELECT category,count(*) AS count FROM error_events WHERE created_at>unixepoch()-86400 GROUP BY category').all();return json({events:events.results,counts:counts.results,retentionDays:7});
    }
    if (method === 'GET' && pathname === '/api/v1/admin/me') return json({ admin });
    if (method === 'PUT' && pathname === '/api/v1/admin/me/contact') {
      const data=await body(request,adminContactSchema);
      await env.DB.batch([
        env.DB.prepare('UPDATE admin_users SET phone=? WHERE id=?').bind(data.phone,admin.id),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'ADMIN',?,'ADMIN_CONTACT_UPDATED',?)").bind(crypto.randomUUID(),admin.id,admin.id),
      ]);
      return json({admin:{...admin,phone:data.phone}});
    }
    if (method === 'GET' && pathname === '/api/v1/admin/dorm-buildings') return json({ buildings: await adminBuildings(env, admin) });
    if (method === 'POST' && pathname === '/api/v1/admin/admins') {
      requireSuper(admin);
      return json({ id: await createAdmin(env, admin, await body(request, createAdminSchema)) }, 201);
    }
    if (method === 'GET' && pathname === '/api/v1/admin/admins') {
      requireSuper(admin);
      return json({ admins: (await env.DB.prepare('SELECT id, username, role, status FROM admin_users ORDER BY created_at, id').all()).results });
    }
    const scopeMatch=/^\/api\/v1\/admin\/admins\/([a-f0-9-]{36})\/scopes$/.exec(pathname);
    if(scopeMatch&&method==='PUT'){
      requireSuper(admin);
      const data=await body(request,z.object({role:roleSchema,scopes:z.array(scopeSchema).max(19)}).strict());
      await updateAdminScopes(env,admin,scopeMatch[1],data.role,data.scopes);return json({ok:true});
    }
    const disableMatch = /^\/api\/v1\/admin\/admins\/([a-f0-9-]{36})\/disable$/.exec(pathname);
    if (method === 'POST' && disableMatch) {
      requireSuper(admin);
      const id = disableMatch[1];
      if (id === admin.id) throw new ApiError(400, 'SELF_DISABLE', '不能停用当前登录账号');
      const target = await env.DB.prepare('SELECT role FROM admin_users WHERE id = ?').bind(id).first<{ role: string }>();
      if (!target) throw new ApiError(404, 'NOT_FOUND', '管理员不存在');
      // Super-admin recovery and transfer need a separate audited process.
      if (target.role === 'SUPER_ADMIN') throw new ApiError(403, 'SUPER_ADMIN_PROTECTED', '此接口不能停用超级管理员');
      const activeTasks=await env.DB.prepare("SELECT count(*) AS n FROM delivery_batches b JOIN batch_items bi ON bi.batch_id=b.id JOIN delivery_orders o ON o.id=bi.order_id WHERE b.assignee_admin_id=? AND o.status NOT IN ('CANCELLED','COMPLETED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')").bind(id).first<number>('n');
      if(activeTasks)throw new ApiError(409,'ADMIN_HAS_TASKS','该管理员还有未完成任务，请先完成配送或交接退单');
      await env.DB.batch([
        env.DB.prepare("UPDATE admin_users SET status = 'DISABLED' WHERE id = ?").bind(id),
        env.DB.prepare('DELETE FROM sessions WHERE admin_id = ?').bind(id),
        env.DB.prepare("INSERT INTO audit_logs(id, actor_type, actor_id, action, resource_id) VALUES (?, 'ADMIN', ?, 'ADMIN_DISABLED', ?)")
          .bind(crypto.randomUUID(), admin.id, id),
      ]);
      return json({ ok: true });
    }
  }
  throw new ApiError(404, 'NOT_FOUND', '接口不存在');
}
export default {
 async scheduled(_event:ScheduledController,env:Env){await env.DB.batch([env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=unixepoch()'),env.DB.prepare('DELETE FROM recovery_tokens WHERE expires_at<=unixepoch() OR used_at IS NOT NULL'),env.DB.prepare('DELETE FROM error_events WHERE created_at<unixepoch()-604800')]);},
 async fetch(request:Request,env:Env):Promise<Response>{
  const requestId=crypto.randomUUID();let response:Response;
  try{response=await route(request,env);}catch(error){
   const expected=error instanceof ApiError?error:expectedConstraint(error);
   if(expected)response=json({error:{code:expected.code,message:expected.message,requestId}},expected.status,expected.status===429?{'Retry-After':'900'}:undefined);
   else{const category=classifyError(error),status=category==='DATABASE_TRANSIENT'?503:500;await recordError(env,request,requestId,category,status);response=json({error:{code:category,message:'服务暂时不可用，请刷新查询操作结果；请提供问题编号以便处理。',requestId}},status,status===503?{'Retry-After':'2'}:undefined);}
  }
  response.headers.set('X-Request-Id',requestId);return response;
 }
};
