/* © 2026 专业团队 · CampusDrop v4.5.0 */
import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireSuper } from './session';
import {
  RAIN_PLATFORM_FEN, RAIN_SURCHARGE_FEN, WEATHER_PADDING, WEATHER_POINT, isSurchargeRain, parseWeather, rainNotice, weatherLabel, weatherLevel, weatherNotice, weatherSettingSchema,
  type RainInfo, type WeatherInfo, type WeatherLevel, type WeatherObservation,
} from '../shared/v3';

/*
 * Weather linkage (天气联动). The frequent job asks Open-Meteo (free tier, non-commercial use; data CC BY 4.0, credited
 * wherever it is shown) for the current conditions at the campus at most every 30 minutes. The derived level adds a
 * notice for students and pads "as soon as possible" arrival estimates. Operators can switch it off or set the level
 * by hand (a forecast is not the window). An observation older than two hours is not used.
 */
const now = () => Math.floor(Date.now() / 1000);
const REFRESH_SECONDS = 1800, STALE_SECONDS = 7200;
export const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_POINT.latitude}&longitude=${WEATHER_POINT.longitude}`
  + '&current=temperature_2m,precipitation,weather_code,wind_gusts_10m&hourly=precipitation_probability&forecast_hours=3&timezone=Asia%2FShanghai&wind_speed_unit=ms';

type StateRow = { enabled: number; override: 'AUTO' | WeatherLevel; note: string; dataJson: string | null; level: WeatherLevel; fetchedAt: number | null; failedAt: number | null; rainSurcharge?: 'AUTO' | 'ON' | 'OFF' };
async function readState(env: Env): Promise<StateRow | null> {
  try {
    return await env.DB.prepare('SELECT enabled,override,note,data_json AS dataJson,level,fetched_at AS fetchedAt,failed_at AS failedAt,rain_surcharge AS rainSurcharge FROM weather_state WHERE id=1').first<StateRow>();
  } catch (error) {
    if (/no such table/i.test(String(error))) return null;
    if (/no such column/i.test(String(error))) return await env.DB.prepare('SELECT enabled,override,note,data_json AS dataJson,level,fetched_at AS fetchedAt,failed_at AS failedAt FROM weather_state WHERE id=1').first<StateRow>();
    throw error;
  }
}

export async function refreshWeather(env: Env, force = false): Promise<void> {
  const state = await readState(env);
  if (!state || !state.enabled) return;
  const t = now(), last = Math.max(state.fetchedAt ?? 0, state.failedAt ?? 0);
  if (!force && t - last < REFRESH_SECONDS) return;
  let observation: WeatherObservation | null = null;
  try {
    const response = await fetch(WEATHER_URL, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (response.ok) observation = parseWeather(await response.json(), t);
  } catch { /* network or timeout: handled below */ }
  if (!observation) { await env.DB.prepare('UPDATE weather_state SET failed_at=? WHERE id=1').bind(t).run(); return; }
  const level = weatherLevel(observation), hour = new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 13);
  await env.DB.batch([
    env.DB.prepare('UPDATE weather_state SET data_json=?,level=?,fetched_at=?,failed_at=NULL WHERE id=1').bind(JSON.stringify(observation), level, t),
    env.DB.prepare(`INSERT INTO weather_log(hour,level,weather_code,precipitation,wind_gust) VALUES(?,?,?,?,?)
      ON CONFLICT(hour) DO UPDATE SET level=CASE WHEN excluded.level='SEVERE' OR weather_log.level='SEVERE' THEN 'SEVERE' WHEN excluded.level='WET' OR weather_log.level='WET' THEN 'WET' ELSE 'CLEAR' END,
      weather_code=excluded.weather_code,precipitation=max(coalesce(weather_log.precipitation,0),coalesce(excluded.precipitation,0)),wind_gust=max(coalesce(weather_log.wind_gust,0),coalesce(excluded.wind_gust,0))`)
      .bind(hour, level, observation.code, observation.precipitation, observation.windGust),
    env.DB.prepare("DELETE FROM weather_log WHERE hour<strftime('%Y-%m-%dT%H',unixepoch()-5184000,'unixepoch')"),
  ]);
}

/** The level in effect, the notice students see and the minutes added to ASAP estimates. */
export async function weatherInfo(env: Env): Promise<WeatherInfo> {
  const state = await readState(env);
  if (!state || !state.enabled) {
    const on = state?.rainSurcharge === 'ON';
    return { enabled: false, level: 'CLEAR', source: 'NONE', observed: null, notice: '', paddingMinutes: 0, rain: rainInfo(state?.rainSurcharge ?? 'AUTO', on, '') };
  }
  const t = now(), data = state.dataJson ? JSON.parse(state.dataJson) as WeatherObservation : null;
  const fresh = data && t - data.at <= STALE_SECONDS ? data : null;
  const observed = fresh ? { ...fresh, label: weatherLabel(fresh.code) } : null;
  const manual = state.override !== 'AUTO';
  const level: WeatherLevel = manual ? state.override as WeatherLevel : observed ? state.level : 'CLEAR';
  const label = observed?.label ?? '';
  const mode = state.rainSurcharge ?? 'AUTO', rainActive = mode === 'ON' || (mode === 'AUTO' && isSurchargeRain(observed));
  return { enabled: true, level, source: manual ? 'MANUAL' : observed ? 'OBSERVED' : 'NONE', observed, notice: weatherNotice(level, label, state.note), paddingMinutes: WEATHER_PADDING[level],
    rain: rainInfo(mode, rainActive, isSurchargeRain(observed) ? label : '') };
}
function rainInfo(mode: 'AUTO' | 'ON' | 'OFF', active: boolean, label: string): RainInfo {
  return { active, mode, label, fen: active ? RAIN_SURCHARGE_FEN : 0, courierFen: active ? RAIN_SURCHARGE_FEN - RAIN_PLATFORM_FEN : 0, notice: rainNotice(active, label) };
}
/** The rain surcharge for a payment made now (0 when it does not apply). */
export async function rainSurchargeNow(env: Env): Promise<{ fen: number; platformFen: number; label: string }> {
  try { const r = (await weatherInfo(env)).rain; return r?.active ? { fen: RAIN_SURCHARGE_FEN, platformFen: RAIN_PLATFORM_FEN, label: r.label } : { fen: 0, platformFen: 0, label: '' }; }
  catch { return { fen: 0, platformFen: 0, label: '' }; }
}

export async function weatherRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, ''), method = request.method;
  // Not cached by the browser: when an operator switches the weather level, students see it on their next page load.
  if (path === '/weather' && method === 'GET') return json({ weather: await weatherInfo(env) });
  if (path !== '/admin/weather') return null;
  const admin = await requireAdmin(request, env);
  if (method === 'GET') {
    const state = await readState(env);
    return json({ weather: await weatherInfo(env), setting: state ? { enabled: Boolean(state.enabled), override: state.override, note: state.note, rainSurcharge: state.rainSurcharge ?? 'AUTO' } : null, fetchedAt: state?.fetchedAt ?? null, failedAt: state?.failedAt ?? null });
  }
  if (method === 'PUT') {
    requireSuper(admin);
    const data = await body(request, weatherSettingSchema);
    const changed = await env.DB.prepare('UPDATE weather_state SET enabled=?,override=?,note=?,rain_surcharge=coalesce(?,rain_surcharge),updated_by=?,updated_at=unixepoch() WHERE id=1').bind(data.enabled ? 1 : 0, data.override, data.note, data.rainSurcharge ?? null, admin.id).run();
    if (!changed.meta.changes) throw new ApiError(503, 'MIGRATION_REQUIRED', '天气设置需要先执行数据库迁移 0012');
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(?,'ADMIN',?,'WEATHER_SETTING',?,?)")
      .bind(crypto.randomUUID(), admin.id, 'weather', JSON.stringify(data)).run();
    if (data.enabled) await refreshWeather(env, true).catch(() => {});
    return json({ weather: await weatherInfo(env) });
  }
  return null;
}
