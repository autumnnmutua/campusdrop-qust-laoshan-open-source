import {useEffect,useState,type CSSProperties,type FormEvent} from 'react';
import { WeatherPanel } from './v3-admin';
import {Link,useSearchParams} from 'react-router-dom';
import {api} from './api';
import {celebrate,toast} from './effects';
import {AdminShell} from './admin-delivery';
import {ConfirmAction,EmptyState,LoadingState} from './components';
import {money,useResource} from './student-delivery';
import {downloadText,toCsv} from './csv';
import {SymbolIcon} from './campus-design';
import type {Admin} from '../shared/contracts';
import {
  COURIER_SHARE,DEFAULT_SHIFT_QUOTA,SEND_STATUS_LABELS,WEBHOOK_EVENTS,WEBHOOK_EVENT_LABELS,WEBHOOK_KINDS,WEBHOOK_KIND_LABELS,
  type MonthReport,type OrderingPause,type SendRequest,type SettlementRow,type ShiftCapacity,type WebhookEvent,type WebhookKind,
} from '../shared/operations-rules';
import {DELIVERY_SLOTS,slotLabel} from '../shared/slots';

/*
 * v2.7 admin pages: 代寄件任务, 配送员模拟结算, 月度运营报告 and 运营设置 (ordering pause, group webhook, shift capacity).
 */
const now=()=>Math.floor(Date.now()/1000);
const beijingDate=(t:number)=>new Date((t+8*3600)*1000).toISOString().slice(0,10);

// ---------------------------------------------------------------- 代寄件任务
export function AdminSends(){
  const me=useResource<{admin:Admin}>('/admin/me'),ready=!!me.data;
  const [group,setGroup]=useState<'OPEN'|'CLOSED'>('OPEN');
  const list=useResource<{sends:SendRequest[]}>(`/admin/sends${group==='CLOSED'?'?group=CLOSED':''}`,ready);
  const [busy,setBusy]=useState(''),[tracking,setTracking]=useState<Record<string,string>>({}),[reason,setReason]=useState<Record<string,string>>({}),[message,setMessage]=useState('');
  const {revalidate}=list;
  useEffect(()=>{if(!ready)return;const t=setInterval(()=>{if(!document.hidden)void revalidate().catch(()=>{});},30000);return()=>clearInterval(t);},[ready,revalidate]);
  async function act(s:SendRequest,action:'claim'|'pickup'|'drop'|'cancel'){
    setBusy(s.id);setMessage('');
    try{
      const payload=action==='drop'?{version:s.version,trackingNo:(tracking[s.id]??'').trim()}:action==='cancel'?{version:s.version,reason:(reason[s.id]??'').trim()}:{version:s.version,confirmed:true};
      await api(`/admin/sends/${s.id}/${action}`,'POST',payload);
      toast({claim:'已接下寄件',pickup:'已标记上门取件',drop:'已交到站点',cancel:'寄件已取消'}[action],'success');if(action==='drop')celebrate({count:30});
      await list.refresh();
    }catch(e){setMessage((e as Error).message);}finally{setBusy('');}
  }
  const sends=list.data?.sends??[],myId=me.data?.admin.id;
  return <AdminShell><div className="row"><div><h1>代寄件任务</h1></div><div className="range-chips" role="group" aria-label="寄件分类">{(['OPEN','CLOSED'] as const).map(g=><button key={g} type="button" className="chip" aria-pressed={group===g} onClick={()=>setGroup(g)}>{g==='OPEN'?'进行中':'已完成 / 已取消'}</button>)}</div></div>
    <p className="muted">学生预约时段后，到寝室取走包裹交到站点寄出。接单前只显示楼栋和时段；接单后才显示姓名、电话和房间号。</p>
    <p role="alert">{list.error||message}</p>{list.loading&&!list.data&&<LoadingState/>}
    {list.data&&!sends.length&&<EmptyState title={group==='OPEN'?'暂无待处理的寄件':'还没有已结束的寄件'} icon="send"/>}
    <div className="card-list send-admin">{sends.map(s=>{const mine=!!myId&&s.assignee===me.data?.admin.username;return <article key={s.id} className="parcel-card task-card">
      <div className="row"><strong>{s.buildingName}{s.roomNo?` · ${s.roomNo}`:''}</strong><span className="badge" data-status={s.status==='DROPPED'?'COMPLETED':s.status==='CANCELLED'?'CANCELLED':s.status==='PICKED_UP'?'PICKED_UP':'WAITING_PICKUP'}>{SEND_STATUS_LABELS[s.status]}</span></div>
      <p className="slot-tag"><span>上门</span>{slotLabel(s.slotDate,s.slotCode,now())}</p>
      <p>{s.carrier} · {s.packageSize==='SMALL'?'小件':'大件'} · {money(s.amountFen)}（模拟）</p>
      {s.studentName&&<p className="muted">{s.studentName} · {s.studentPhone}</p>}{s.note&&<p>备注：{s.note}</p>}
      {s.assignee&&<p className="muted">接单：{s.assignee}</p>}{s.trackingNo&&<p className="identifier">运单号 {s.trackingNo}</p>}{s.cancelReason&&s.status==='CANCELLED'&&<p className="muted">取消原因：{s.cancelReason}</p>}
      <div className="actions">
        {s.status==='WAITING_PICKUP'&&!s.hasAssignee&&<button disabled={busy===s.id} onClick={()=>void act(s,'claim')}>接单</button>}
        {s.status==='WAITING_PICKUP'&&mine&&<button disabled={busy===s.id} onClick={()=>void act(s,'pickup')}>已上门取件</button>}
        {s.status==='PICKED_UP'&&mine&&<><label className="inline-field">运单号（选填）<input value={tracking[s.id]??''} maxLength={40} onChange={e=>setTracking({...tracking,[s.id]:e.target.value})} placeholder="SF1234…"/></label><button disabled={busy===s.id} onClick={()=>void act(s,'drop')}>已交到站点</button></>}
        {(s.status==='WAITING_PICKUP'||s.status==='PICKED_UP')&&(mine||me.data?.admin.role!=='DELIVERY_STAFF')&&<ConfirmAction label="取消寄件" title="确认取消这次寄件？" canConfirm={(reason[s.id]??'').trim().length>0} validationMessage="请填写取消原因，学生会看到。" busy={busy===s.id} onConfirm={()=>act(s,'cancel')}><p>学生会收到通知并按支付金额模拟退款。已取走的包裹请先送回学生。</p><label>取消原因<textarea maxLength={120} value={reason[s.id]??''} onChange={e=>setReason({...reason,[s.id]:e.target.value})}/></label></ConfirmAction>}
      </div>
    </article>;})}</div>
  </AdminShell>;
}

// ---------------------------------------------------------------- 配送员模拟结算
export function AdminSettlement(){
  const [week,setWeek]=useState(beijingDate(now()));
  const r=useResource<{week:string;from:number;to:number;share:number;rows:SettlementRow[]}>(`/admin/settlement?week=${week}`);
  const d=r.data,total=(d?.rows??[]).reduce((s,x)=>s+x.payoutFen,0);
  const shift=(days:number)=>setWeek(beijingDate(Date.parse(`${d?.week??week}T12:00:00+08:00`)/1000+days*86400));
  function exportCsv(){if(!d)return;downloadText(`campusdrop-settlement-${d.week}.csv`,toCsv([['CampusDrop 配送员模拟结算',`${d.week} 起一周`,'模拟数据，未发生真实资金流转'],[],['配送员','送达单数','配送费（元）','代寄件','寄件费（元）','打赏（元）',`应结（元，配送与寄件按 ${Math.round(d.share*100)}%）`],...d.rows.map(x=>[x.username,x.deliveries,(x.deliveryFen/100).toFixed(2),x.sends,(x.sendFen/100).toFixed(2),(x.tipFen/100).toFixed(2),(x.payoutFen/100).toFixed(2)])]));toast('已导出结算表','success');}
  return <AdminShell><div className="row"><div><h1>配送员结算</h1></div><div className="actions"><button type="button" className="secondary" onClick={()=>shift(-7)}>‹ 上一周</button><button type="button" className="secondary" disabled={!!d&&d.to>now()} onClick={()=>shift(7)}>下一周 ›</button><button type="button" className="text-button" disabled={!d?.rows.length} onClick={exportCsv}>导出 CSV</button></div></div>
    <p className="muted">按北京时间周一至周日统计。配送费和寄件费按 {Math.round(COURIER_SHARE*100)}% 计入配送员，打赏全额计入。<strong>全部为模拟数据，不产生真实收入或转账。</strong></p>
    <p role="alert">{r.error}</p>{r.loading&&!d&&<LoadingState/>}
    {d&&<><p className="settle-week">{d.week} — {beijingDate(d.to-1)} · 合计应结 <strong>{money(total)}</strong></p>
      {d.rows.length?<div className="table-scroll" tabIndex={0}><table className="staff-table"><thead><tr><th scope="col">配送员</th><th scope="col">送达</th><th scope="col">配送费</th><th scope="col">代寄件</th><th scope="col">打赏</th><th scope="col">应结（模拟）</th></tr></thead>
        <tbody>{d.rows.map(x=><tr key={x.adminId}><td>{x.username}</td><td>{x.deliveries}</td><td>{money(x.deliveryFen)}</td><td>{x.sends} · {money(x.sendFen)}</td><td>{money(x.tipFen)}</td><td><strong>{money(x.payoutFen)}</strong></td></tr>)}</tbody></table></div>
        :<EmptyState title="这一周还没有送达记录" icon="wallet"/>}</>}
  </AdminShell>;
}

// ---------------------------------------------------------------- 月度运营报告 (printable)
export function AdminMonthReport(){
  const [params,setParams]=useSearchParams();const month=params.get('month')??beijingDate(now()).slice(0,7);
  const r=useResource<{report:MonthReport;generatedAt:number}>(`/admin/report?month=${month}`);const d=r.data?.report;
  const move=(n:number)=>{const [y,m]=month.split('-').map(Number),date=new Date(Date.UTC(y,m-1+n,1));setParams({month:date.toISOString().slice(0,7)});};
  const peak=d?Math.max(1,...d.daily.map(x=>x.count)):1;
  const slotName=(code:string)=>code==='ASAP'?'尽快送达':DELIVERY_SLOTS.find(s=>s.code===code)?.label??code;
  return <AdminShell><div className="month-report"><div className="row no-print"><div><h1>月度运营报告</h1></div><div className="actions"><button type="button" className="secondary" onClick={()=>move(-1)}>‹ 上个月</button><button type="button" className="secondary" disabled={month>=beijingDate(now()).slice(0,7)} onClick={()=>move(1)}>下个月 ›</button><button type="button" disabled={!d} onClick={()=>window.print()}>打印 / 另存为 PDF</button></div></div>
    <p role="alert">{r.error}</p>{r.loading&&!d&&<LoadingState/>}
    {d&&<article className="report-sheet" aria-label={`${d.month} 运营报告`}>
      <header><h2>CampusDrop {d.month.replace('-','年')}月运营报告</h2><p>青岛科技大学崂山校区 · 统计范围为当前账号的授权楼栋 · 生成于 {new Date((r.data!.generatedAt)*1000).toLocaleString('zh-CN',{hour12:false})}</p></header>
      <div className="report-kpis">
        <div><small>下单</small><strong>{d.orders}</strong><em>已支付 {d.paid}</em></div>
        <div><small>完成</small><strong>{d.completed}</strong><em>完成率 {d.paid?Math.round(d.completed/d.paid*100):0}%</em></div>
        <div><small>取消（已支付）</small><strong>{d.cancelled}</strong><em>异常 {d.exceptions}</em></div>
        <div><small>平均配送时长</small><strong>{d.avgMinutes??'—'}</strong><em>分钟 · 支付到送达</em></div>
        <div><small>平均评分</small><strong>{d.avgStars??'—'}</strong><em>{d.ratings} 条评价</em></div>
        {d.newStudents!==null&&<div><small>新注册学生</small><strong>{d.newStudents}</strong><em>代寄件 {d.sends} 单</em></div>}
      </div>
      <h3>每日已支付订单</h3>
      <div className="report-bars" role="img" aria-label="每日订单柱状图">{d.daily.map(x=><span key={x.day} title={`${x.day}：${x.count} 单`} style={{'--h':`${Math.round(x.count/peak*100)}%`} as CSSProperties}><i/>{Number(x.day.slice(8))%5===1&&<small>{Number(x.day.slice(8))}</small>}</span>)}</div>
      <div className="report-cols">
        <section><h3>楼栋排行</h3>{d.buildings.length?<ol>{d.buildings.map(b=><li key={b.building}><span>{b.building}</span><b>{b.count}</b></li>)}</ol>:<p className="muted">暂无数据</p>}</section>
        <section><h3>送达时段</h3>{d.slots.length?<ol>{d.slots.map(s=><li key={s.code}><span>{slotName(s.code)}</span><b>{s.count}</b></li>)}</ol>:<p className="muted">暂无数据</p>}</section>
        <section><h3>配送员送达</h3>{d.staff.length?<ol>{d.staff.map(s=><li key={s.name}><span>{s.name}</span><b>{s.delivered}</b></li>)}</ol>:<p className="muted">暂无数据</p>}</section>
      </div>
      <footer>金额相关数据均为模拟支付；本报告仅用于校园服务运营复盘。</footer>
    </article>}
  </div></AdminShell>;
}

// ---------------------------------------------------------------- 运营设置
export function AdminSettings(){
  const me=useResource<{admin:Admin}>('/admin/me'),isSuper=me.data?.admin.role==='SUPER_ADMIN';
  if(me.data&&!isSuper)return <AdminShell><h1>运营设置</h1><p>仅超级管理员可以修改运营设置。<Link to="/admin">返回配送工作台</Link></p></AdminShell>;
  return <AdminShell><h1>运营设置</h1>{isSuper&&<><PausePanel/><WeatherPanel/><WebhookPanel/><ShiftCapacityPanel/></>}</AdminShell>;
}
function PausePanel(){
  const r=useResource<{pause:OrderingPause}>('/admin/settings/pause');const [reason,setReason]=useState(''),[busy,setBusy]=useState(false);
  const pause=r.data?.pause;
  async function save(paused:boolean){setBusy(true);try{await api('/admin/settings/pause','PUT',{paused,reason:paused?reason.trim():''});toast(paused?'已暂停接单':'已恢复接单',paused?'warn':'success');setReason('');await r.refresh();}catch(e){toast((e as Error).message,'warn');}finally{setBusy(false);}}
  return <section className={`settings-card${pause?.paused?' is-paused':''}`}><h2><SymbolIcon name="pause"/>暂停接单总开关</h2>
    <p className="muted">恶劣天气、站点盘点或人手不足时使用。暂停后学生不能新下单、预约或支付，页面顶部会显示原因；已接的订单照常配送。</p>
    {pause?.paused?<><p role="status" className="pause-note">当前已暂停：{pause.reason}{pause.since?` · 自 ${new Date(pause.since*1000).toLocaleString('zh-CN',{hour12:false})}`:''}</p><button type="button" disabled={busy} onClick={()=>void save(false)}>恢复接单</button></>
      :<form className="inline-form" onSubmit={(e:FormEvent)=>{e.preventDefault();void save(true);}}><label>暂停原因（学生可见）<input maxLength={60} required value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：暴雨天气，今晚 22:00 前暂停接单"/></label><button className="danger" disabled={busy||!reason.trim()}>暂停接单</button></form>}
  </section>;
}
function WebhookPanel(){
  const r=useResource<{webhook:{kind:WebhookKind;url:string;events:WebhookEvent[]}|null}>('/admin/settings/webhook');
  const [kind,setKind]=useState<WebhookKind>('wecom'),[url,setUrl]=useState(''),[events,setEvents]=useState<WebhookEvent[]>(['NEW_ORDER','STALLED','PAUSE']),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const current=r.data?.webhook;
  useEffect(()=>{if(current){setKind(current.kind);setEvents(current.events);}},[current]);
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setMessage('');try{await api('/admin/settings/webhook','PUT',{kind,url:url.trim(),events});setUrl('');toast('群通知已保存','success');await r.refresh();}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}
  async function test(){setBusy(true);try{const res=await api<{ok:boolean}>('/admin/settings/webhook/test','POST',{confirmed:true});toast(res.ok?'测试消息已发送，请到群里查看':'发送失败，请检查机器人地址',res.ok?'success':'warn');}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}
  async function remove(){setBusy(true);try{await api('/admin/settings/webhook','DELETE');toast('群通知已关闭','info');await r.refresh();}finally{setBusy(false);}}
  return <section className="settings-card"><h2><SymbolIcon name="bell"/>配送群通知</h2>
    <p className="muted">把新订单、超时预警等提醒推送到配送团队的企业微信或飞书群。消息只包含楼栋、大小件和时段，不含学生姓名、电话、房间号和取件码。机器人地址相当于密码，保存后只显示开头几位。</p>
    {current&&<p className="settings-current">当前：{WEBHOOK_KIND_LABELS[current.kind]} · <code>{current.url}</code> · {current.events.map(e=>WEBHOOK_EVENT_LABELS[e]).join('、')}</p>}
    <form onSubmit={save}>
      <label>平台<select value={kind} onChange={e=>setKind(e.target.value as WebhookKind)}>{WEBHOOK_KINDS.map(k=><option key={k} value={k}>{WEBHOOK_KIND_LABELS[k]}</option>)}</select></label>
      <label>机器人 Webhook 地址<input type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder={kind==='wecom'?'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…':'https://open.feishu.cn/open-apis/bot/v2/hook/…'}/></label>
      <fieldset><legend>推送哪些提醒</legend>{WEBHOOK_EVENTS.map(ev=><label key={ev} className="check"><input type="checkbox" checked={events.includes(ev)} onChange={e=>setEvents(e.target.checked?[...events,ev]:events.filter(x=>x!==ev))}/>{WEBHOOK_EVENT_LABELS[ev]}</label>)}</fieldset>
      {message&&<p role="alert">{message}</p>}
      <div className="actions"><button disabled={busy||!url.trim()||!events.length}>保存</button>{current&&<><button type="button" className="secondary" disabled={busy} onClick={()=>void test()}>发送测试消息</button><button type="button" className="text-button" disabled={busy} onClick={()=>void remove()}>关闭群通知</button></>}</div>
    </form>
  </section>;
}
function ShiftCapacityPanel(){
  const r=useResource<{shiftCapacity:ShiftCapacity}>('/admin/settings/shift-capacity');
  const [value,setValue]=useState<ShiftCapacity>({enabled:false,quota:DEFAULT_SHIFT_QUOTA}),[busy,setBusy]=useState(false);
  useEffect(()=>{if(r.data)setValue(r.data.shiftCapacity);},[r.data]);
  async function save(){setBusy(true);try{await api('/admin/settings/shift-capacity','PUT',value);toast('名额规则已保存','success');await r.refresh();}catch(e){toast((e as Error).message,'warn');}finally{setBusy(false);}}
  return <section className="settings-card"><h2><SymbolIcon name="calendar"/>预约名额与排班联动</h2>
    <p className="muted">关闭时，每个时段使用固定名额（午间 40 / 傍晚 60 / 晚间 40）。开启后，名额 = 每位配送员的时段名额 × 在「作战地图」登记该时段的配送员人数；没有人排班的时段不能预约。</p>
    <label className="switch"><input type="checkbox" checked={value.enabled} onChange={e=>setValue({...value,enabled:e.target.checked})}/><span><strong>按排班计算名额</strong><small>{value.enabled?'已开启':'已关闭，使用固定名额'}</small></span></label>
    <div className="quota-grid">{DELIVERY_SLOTS.map(s=><label key={s.code}>{s.label} {s.start}–{s.end}<input type="number" min={0} max={100} value={value.quota[s.code]} disabled={!value.enabled} onChange={e=>setValue({...value,quota:{...value.quota,[s.code]:Math.max(0,Math.min(100,Number(e.target.value)||0))}})}/><small>单 / 每位配送员</small></label>)}</div>
    <button type="button" disabled={busy} onClick={()=>void save()}>保存名额规则</button>
  </section>;
}
