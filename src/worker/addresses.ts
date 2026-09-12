import { CAMPUS_ID, type Address, type AddressInput } from '../shared/contracts';
import type { Env } from './types';
import { ApiError } from './http';
export async function readAddress(env: Env, userId: string): Promise<Address | null> {
  return env.DB.prepare(`SELECT a.id, a.campus_id AS campusId, a.zone, a.dorm_building_code AS buildingCode,
    b.display_name AS buildingName, a.room_no AS roomNo, a.valid_from AS validFrom
    FROM user_addresses a JOIN dorm_buildings b ON b.code = a.dorm_building_code
    WHERE a.user_id = ? AND a.valid_to IS NULL`).bind(userId).first<Address>();
}
export async function saveAddress(env: Env, userId: string, data: AddressInput, createOnly: boolean): Promise<Address> {
  const building = await env.DB.prepare(`SELECT code FROM dorm_buildings
    WHERE code = ? AND campus_id = ? AND zone = ? AND active = 1`)
    .bind(data.buildingCode, CAMPUS_ID, data.zone).first();
  if (!building) throw new ApiError(400, 'INVALID_BUILDING', '请选择当前开放且所属区域正确的宿舍楼');
  const id = crypto.randomUUID();
  const insert = env.DB.prepare(`INSERT INTO user_addresses(id, user_id, campus_id, zone, dorm_building_code, room_no)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(id, userId, CAMPUS_ID, data.zone, data.buildingCode, data.roomNo);
  try {
    // D1 batch is atomic: failed replacement restores the prior active address.
    await env.DB.batch([
      ...(!createOnly ? [env.DB.prepare('UPDATE user_addresses SET valid_to = unixepoch() WHERE user_id = ? AND valid_to IS NULL').bind(userId)] : []),
      insert,
      env.DB.prepare(`INSERT INTO audit_logs(id, actor_type, actor_id, action, resource_id)
        VALUES (?, 'STUDENT', ?, 'ADDRESS_SAVED', ?)`).bind(crypto.randomUUID(), userId, id),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint')) throw new ApiError(409, 'ADDRESS_EXISTS', '已有寝室资料，请使用修改操作');
    throw error;
  }
  return (await readAddress(env, userId))!;
}
export async function deleteAddress(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('UPDATE user_addresses SET valid_to = unixepoch() WHERE user_id = ? AND valid_to IS NULL').bind(userId),
    env.DB.prepare(`INSERT INTO audit_logs(id, actor_type, actor_id, action, resource_id)
      VALUES (?, 'STUDENT', ?, 'ADDRESS_REMOVED', ?)`).bind(crypto.randomUUID(), userId, userId),
  ]);
}
