/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-9E32E65E74 */
import type { Env } from './types';
import { ApiError } from './http';
export async function requireContact(env:Env,id:string){
  const phone=await env.DB.prepare("SELECT phone FROM admin_users WHERE id=? AND status='ACTIVE'").bind(id).first<string>('phone');
  if(!phone)throw new ApiError(409,'CONTACT_REQUIRED','请先在管理员资料中填写联系电话');
}
