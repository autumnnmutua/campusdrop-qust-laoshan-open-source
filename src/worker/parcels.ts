import type { Env } from './types';
import type { Parcel, ParcelInput } from '../shared/delivery';
import { ApiError } from './http';
import { CAMPUS_ID } from '../shared/contracts';
export const parcelColumns = 'id, pickup_code AS pickupCode, station_code AS stationCode, size AS packageSize, carrier, note, status, created_at AS createdAt';
export async function ownParcel(env: Env, userId: string, id: string): Promise<Parcel> {
  const parcel = await env.DB.prepare(`SELECT ${parcelColumns} FROM parcels WHERE id=? AND user_id=?`).bind(id,userId).first<Parcel>();
  if (!parcel) throw new ApiError(404,'NOT_FOUND','包裹不存在');
  return parcel;
}
export async function createParcel(env: Env, userId: string, data: ParcelInput): Promise<Parcel> {
  const station = await env.DB.prepare('SELECT code FROM stations WHERE code=? AND campus_id=? AND active=1').bind(data.stationCode,CAMPUS_ID).first();
  if (!station) throw new ApiError(400,'INVALID_STATION','请选择当前开放的站点');
  const id=crypto.randomUUID();
  try {
    await env.DB.prepare('INSERT INTO parcels(id,user_id,pickup_code,station_code,size,carrier,note) VALUES(?,?,?,?,?,?,?)')
      .bind(id,userId,data.pickupCode,data.stationCode,data.packageSize,data.carrier??null,data.note??'').run();
  } catch(error) {
    if(String(error).includes('UNIQUE constraint')) throw new ApiError(409,'PARCEL_EXISTS','这个站点的取件码已登记，请在我的包裹中查看');
    throw error;
  }
  return ownParcel(env,userId,id);
}
export async function cancelParcel(env: Env,userId:string,id:string):Promise<void> {
  await ownParcel(env,userId,id);
  const result=await env.DB.prepare(`UPDATE parcels SET status='CANCELLED' WHERE id=? AND user_id=? AND status='ACTIVE'
    AND NOT EXISTS(SELECT 1 FROM delivery_orders WHERE parcel_id=parcels.id AND status<>'CANCELLED')`).bind(id,userId).run();
  if(!result.meta.changes) throw new ApiError(409,'PARCEL_IN_USE','包裹已有配送订单或已结束，无法移除');
}
