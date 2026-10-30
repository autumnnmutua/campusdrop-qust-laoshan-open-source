import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { toast } from './effects';
import { SymbolIcon } from './campus-design';
import { LoadingState } from './components';
import { AdminShell } from './admin-delivery';
import { useResource } from './student-delivery';
import { WeatherCredit } from './v3-ui';
import { ASAP_TARGETS, PUNCTUALITY_DAYS, rate, weatherLabel, type PunctualityReport, type PunctualityRow, type WeatherInfo } from '../shared/v3';

/*
 * v3.0 admin pages: 准时率看板 (on-time dashboard) and the weather panel in 运营设置. Single-series charts in one hue
 * (the channel blue), exact values printed next to every bar, native tooltips on the trend points; no colour carries
 * meaning on its own.
 */
const pct = (r: PunctualityRow) => { const v = rate(r); return v == null ? '—' : `${Math.round(v * 100)}%`; };
function RateBars({ title, note, rows, limit = 10 }: { title: string; note: string; rows: PunctualityRow[]; limit?: number }) {
  const shown = rows.slice(0, limit);
  return <figure className="chart bar-list rate-bars"><figcaption><strong>{title}</strong><small>{note}</small></figcaption>
    {shown.length ? <ol>{shown.map(r => { const v = rate(r) ?? 0; return <li key={r.key} title={`${r.label}：准时 ${r.onTime} / ${r.delivered} 单${r.avgMinutes != null ? `，平均 ${r.avgMinutes} 分钟` : ''}`}>
      <span>{r.label}</span>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect className="bar-track" width="100" height="10" rx="4"/><rect className="bar-fill" width={Math.max(2, v * 100)} height="10" rx="4"/><line className="bar-goal" x1="90" x2="90" y1="0" y2="10"/></svg>
      <strong>{pct(r)}<small> · {r.onTime}/{r.delivered}</small></strong>
    </li>; })}</ol> : <p className="muted">暂无已送达订单</p>}
    {rows.length > limit && <p className="muted">另有 {rows.length - limit} 项未显示</p>}
  </figure>;
}
/** On-time rate per day: a 2 px line with markers; days without deliveries leave a gap rather than a zero. */
function DayTrend({ rows }: { rows: PunctualityRow[] }) {
  const W = 640, H = 170, L = 34, R = 10, T = 12, B = 26, n = rows.length;
  const x = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)), y = (v: number) => T + (1 - v) * (H - T - B);
  const segs: string[] = [];let cur = '';
  rows.forEach((r, i) => { const v = rate(r); if (v == null) { if (cur) segs.push(cur); cur = ''; return; } cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; });
  if (cur) segs.push(cur);
  return <figure className="chart day-trend"><figcaption><strong>每日准时率</strong><small>按送达日期 · 悬停查看当天单量</small></figcaption>
    {n ? <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`每日准时率，共 ${n} 天有送达记录`}>
      {[0, .5, .9, 1].map(v => <g key={v}><line className={v === .9 ? 'grid goal' : 'grid'} x1={L} x2={W - R} y1={y(v)} y2={y(v)}/><text className="axis" x={L - 6} y={y(v) + 4} textAnchor="end">{Math.round(v * 100)}%</text></g>)}
      {segs.map((d, i) => <path key={i} className="trend-line" d={d}/>)}
      {rows.map((r, i) => { const v = rate(r); return v == null ? null : <g key={r.key}><circle className="trend-dot" cx={x(i)} cy={y(v)} r="4"/><circle className="trend-hit" cx={x(i)} cy={y(v)} r="12"><title>{`${r.label}：准时率 ${pct(r)}（${r.onTime}/${r.delivered} 单）`}</title></circle></g>; })}
      {rows.map((r, i) => (n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1) && <text key={r.key} className="axis" x={x(i)} y={H - 6} textAnchor="middle">{r.label}</text>)}
    </svg> : <p className="muted">暂无数据</p>}
  </figure>;
}

export function AdminPunctuality() {
  const [days, setDays] = useState<number>(14), [asap, setAsap] = useState<number>(60);
  const r = useResource<{ report: PunctualityReport }>(`/admin/punctuality?days=${days}&asap=${asap}`), rep = r.data?.report;
  return <AdminShell>
    <div className="row"><h1>准时率看板</h1>
      <div className="analytics-tools"><div className="range-chips" role="group" aria-label="统计范围">{PUNCTUALITY_DAYS.map(n => <button key={n} type="button" className="chip" aria-pressed={days === n} onClick={() => setDays(n)}>近 {n} 天</button>)}</div>
        <div className="range-chips" role="group" aria-label="尽快送达的目标时长">{ASAP_TARGETS.map(n => <button key={n} type="button" className="chip" aria-pressed={asap === n} onClick={() => setAsap(n)}>尽快 {n} 分钟</button>)}</div></div></div>
    <p className="muted">准时的定义：预约时段的订单在时段结束前送达；“尽快送达”的订单在支付后 {asap} 分钟内送达。送达时间取配送员第一次标记“已送达”（或当面核验收货码）的时刻。只统计你授权范围内的订单。</p>
    <p role="alert">{r.error}</p>{r.loading && !rep && <LoadingState label="正在统计…"/>}
    {rep && <div className="analytics punctuality">
      <div className="kpi-grid">
        <div className="kpi kpi-hero"><small>准时率</small><strong>{pct(rep.total)}</strong><span>{rep.total.onTime} / {rep.total.delivered} 单准时</span></div>
        <div className="kpi"><small>已送达</small><strong>{rep.total.delivered}<em>单</em></strong><span>近 {rep.days} 天</span></div>
        <div className="kpi"><small>平均配送时长</small><strong>{rep.total.avgMinutes ?? '—'}<em>分钟</em></strong><span>支付到送达</span></div>
        <div className="kpi"><small>接单等待（中位数）</small><strong>{rep.claimMedian ?? '—'}<em>分钟</em></strong><span>支付到配送员接单</span></div>
        <div className="kpi"><small>取件到送达（中位数）</small><strong>{rep.rideMedian ?? '—'}<em>分钟</em></strong><span>路上的时间</span></div>
      </div>
      <DayTrend rows={rep.byDay}/>
      <div className="chart-grid">
        <RateBars title="按配送员" note="竖线为 90% 参考线" rows={rep.byCourier}/>
        <RateBars title="按时段" note="预约时段 / 尽快送达" rows={rep.bySlot}/>
        <RateBars title="按楼栋" note="送达单量最多的 10 栋" rows={rep.byBuilding}/>
        <RateBars title="按天气" note="送达那一小时记录的天气；开启天气联动后才有记录" rows={rep.byWeather}/>
      </div>
      <section className="late-list"><h2>超时最多的订单</h2>
        {rep.late.length ? <table><thead><tr><th>楼栋</th><th>配送员</th><th>时段</th><th>超时</th><th>送达时间</th></tr></thead><tbody>{rep.late.map(l => <tr key={l.id}><td>{l.building}</td><td>{l.courier}</td><td>{l.slot}</td><td>{l.lateMinutes} 分钟</td><td>{new Date(l.deliveredAt * 1000).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>)}</tbody></table> : <p className="muted">这段时间没有超时送达的订单。</p>}
      </section>
    </div>}
  </AdminShell>;
}

// ---------------------------------------------------------------- 运营设置：天气联动
const LEVEL_TEXT = { CLEAR: '正常', WET: '雨雪（预计时间多留 10 分钟）', SEVERE: '恶劣天气（多留 20 分钟）' } as const;
export function WeatherPanel() {
  const r = useResource<{ weather: WeatherInfo; setting: { enabled: boolean; override: 'AUTO' | 'CLEAR' | 'WET' | 'SEVERE'; note: string } | null; fetchedAt: number | null; failedAt: number | null }>('/admin/weather');
  const [enabled, setEnabled] = useState(true), [override, setOverride] = useState<'AUTO' | 'CLEAR' | 'WET' | 'SEVERE'>('AUTO'), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const s = r.data?.setting, w = r.data?.weather;
  useEffect(() => { if (s) { setEnabled(s.enabled); setOverride(s.override); setNote(s.note); } }, [s]);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api('/admin/weather', 'PUT', { enabled, override, note: note.trim() }); toast('天气联动已保存', 'success'); await r.refresh(); }
    catch (err) { toast((err as Error).message, 'warn'); } finally { setBusy(false); }
  }
  const time = (t: number | null) => t ? new Date(t * 1000).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  return <section className="settings-card"><h2><SymbolIcon name="map"/>天气联动</h2>
    <p className="muted">每 30 分钟读取一次校园所在位置的实时天气（Open-Meteo 免费接口，非商业用途）。下雨下雪时，学生下单页和订单页会显示提示，“尽快送达”的预计时间自动多留 10 分钟；暴雨、雷雨、大雪或 8 级以上阵风时多留 20 分钟。天气预报不一定准，可以手动指定，也可以关闭。</p>
    {!s && r.data && <p role="alert">需要先执行数据库迁移 0012 才能使用天气联动。</p>}
    {w && <p className="settings-current">当前生效：<strong>{LEVEL_TEXT[w.level]}</strong>{w.source === 'MANUAL' ? '（手动指定）' : w.source === 'OBSERVED' ? '（自动）' : '（暂无实时数据，按正常处理）'}
      {w.observed && <> · 观测：{weatherLabel(w.observed.code)}{w.observed.temperature != null ? ` ${Math.round(w.observed.temperature)}°C` : ''}{w.observed.precipitation != null ? ` · 降水 ${w.observed.precipitation} mm` : ''}{w.observed.windGust != null ? ` · 阵风 ${w.observed.windGust} m/s` : ''}</>}
      <br/><small>上次读取成功：{time(r.data?.fetchedAt ?? null)}{r.data?.failedAt ? ` · 最近一次读取失败：${time(r.data.failedAt)}` : ''}</small>{w.observed && <><br/><WeatherCredit/></>}</p>}
    {s && <form onSubmit={save}>
      <label className="check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/>开启天气联动</label>
      <fieldset disabled={!enabled}><legend>天气等级</legend><div className="segmented" role="radiogroup" aria-label="天气等级">{(['AUTO', 'CLEAR', 'WET', 'SEVERE'] as const).map(v => <button key={v} type="button" role="radio" aria-checked={override === v} onClick={() => setOverride(v)}>{v === 'AUTO' ? '自动' : v === 'CLEAR' ? '正常' : v === 'WET' ? '雨雪' : '恶劣'}</button>)}</div></fieldset>
      <label>补充说明（学生可见，可留空）<input maxLength={80} value={note} disabled={!enabled} onChange={e => setNote(e.target.value)} placeholder="例如：南苑门口积水，楼下配送改到楼内大厅"/></label>
      <button disabled={busy}>{busy ? '正在保存…' : '保存天气设置'}</button>
    </form>}
  </section>;
}
