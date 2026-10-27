import './zod-config';
import {useId,useState,type FormEvent} from 'react';
import {downloadText,toCsv} from './csv';
import {Link} from 'react-router-dom';
import {AdminShell} from './admin-delivery';
import {ChoiceSelector,ConfirmAction,CountUp,EmptyState,LoadingState} from './components';
import {api} from './api';
import {toast} from './effects';
import {useResource} from './student-delivery';
import {StalledOrders} from './admin-alerts';
import {STATUS_LABELS} from '../shared/constants';
import type {OrderStatus} from '../shared/delivery';
import {ANNOUNCEMENT_LEVEL_LABELS,announcementCreate,type Analytics,type Announcement,type AnnouncementLevel} from '../shared/engagement';
import type {Admin} from '../shared/contracts';

const STATUS_COLORS:Partial<Record<OrderStatus,string>>={WAITING_PICKUP:'#f5a524',PICKED_UP:'#7c6cf2',OUT_FOR_DELIVERY:'#1568e9',DELIVERED_DOWNSTAIRS:'#22a6b3',DELIVERED_TO_ROOM:'#18a77a',COMPLETED:'#2fbf71',CANCELLED:'#a5b2c5',FAILED_PICKUP:'#ef5d5d',DELIVERY_EXCEPTION:'#e5484d'};
const niceMax=(n:number)=>{if(n<=4)return 4;const p=Math.pow(10,Math.floor(Math.log10(n)));const m=n/p;return (m<=2?2:m<=5?5:10)*p;};

function TrendChart({trend}:{trend:Analytics['trend']}){
  const W=640,H=210,L=34,B=28,T=14,max=niceMax(Math.max(...trend.map(t=>t.count))),step=(W-L-8)/trend.length,bw=Math.min(26,step*.62);
  const y=(v:number)=>T+(H-T-B)*(1-v/max),x=(i:number)=>L+step*i+step/2;
  const line=trend.map((t,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(t.count).toFixed(1)}`).join(' ');
  const total=trend.reduce((s,t)=>s+t.count,0);
  return <figure className="chart trend-chart"><figcaption><strong>近 {trend.length} 日订单</strong><small>共 {total} 单 · 按北京时间统计</small></figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`近 ${trend.length} 日订单趋势，共 ${total} 单`}>
      {[0,.5,1].map(f=><g key={f}><line className="grid" x1={L} x2={W-4} y1={y(max*f)} y2={y(max*f)}/><text className="axis" x={L-6} y={y(max*f)+4} textAnchor="end">{Math.round(max*f)}</text></g>)}
      {trend.map((t,i)=><g key={t.day} className="trend-bar" data-i={i}><rect x={x(i)-bw/2} y={y(t.count)} width={bw} height={Math.max(0,H-B-y(t.count))} rx={4}><title>{`${t.day}：${t.count} 单`}</title></rect>
        {((trend.length>14?i%5===(trend.length-1)%5:i%2===(trend.length-1)%2))&&<text className="axis" x={x(i)} y={H-8} textAnchor="middle">{t.day.slice(5).replace('-','/')}</text>}</g>)}
      <path className="trend-line" d={line} pathLength={1}/>
      {trend.map((t,i)=>t.count>0&&<circle key={t.day} className="trend-dot" cx={x(i)} cy={y(t.count)} r={3.5}/>)}
    </svg>
    <table className="sr-only"><caption>每日订单数</caption><tbody>{trend.map(t=><tr key={t.day}><th scope="row">{t.day}</th><td>{t.count}</td></tr>)}</tbody></table>
  </figure>;
}
function StatusDonut({statuses}:{statuses:Analytics['statuses']}){
  const total=statuses.reduce((s,x)=>s+x.count,0);let acc=0;
  return <figure className="chart donut-chart"><figcaption><strong>订单状态分布</strong><small>全部已支付订单</small></figcaption>
    <div className="donut-wrap"><svg viewBox="0 0 120 120" role="img" aria-label="订单状态分布"><circle className="donut-track" cx="60" cy="60" r="44"/>
      {total>0&&statuses.map((s,i)=>{const len=s.count/total*100,offset=acc;acc+=len;return <circle key={s.status} className="donut-seg" data-i={i} cx="60" cy="60" r="44" pathLength={100} stroke={STATUS_COLORS[s.status]??'#8aa'} strokeDasharray={`${Math.max(0,len-.6)} ${100-Math.max(0,len-.6)}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)"><title>{`${STATUS_LABELS[s.status]}：${s.count}`}</title></circle>;})}
      <text x="60" y="58" textAnchor="middle" className="donut-total">{total}</text><text x="60" y="76" textAnchor="middle" className="axis">单</text></svg>
      <ul className="legend">{statuses.map(s=><li key={s.status}><svg viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="3" fill={STATUS_COLORS[s.status]??'#8aa'}/></svg>{STATUS_LABELS[s.status]}<strong>{s.count}</strong></li>)}</ul></div>
    {!total&&<p className="muted">暂无订单</p>}
  </figure>;
}
function BarList({title,note,rows}:{title:string;note:string;rows:{label:string;value:number}[]}){
  const max=Math.max(1,...rows.map(r=>r.value));
  return <figure className="chart bar-list"><figcaption><strong>{title}</strong><small>{note}</small></figcaption>
    {rows.length?<ol>{rows.map((r,i)=><li key={r.label}><span>{r.label}</span><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect className="bar-track" width="100" height="10" rx="5"/><rect className="bar-fill" data-i={i} width={Math.max(2,r.value/max*100)} height="10" rx="5"/></svg><strong>{r.value}</strong></li>)}</ol>:<p className="muted">暂无数据</p>}
  </figure>;
}
const WEEK=['周一','周二','周三','周四','周五','周六','周日'];
/** Weekday x hour grid of order counts. Colour steps are relative to the busiest cell, with exact counts in the tooltip. */
function Heatmap({data,days}:{data:number[][];days:number}){
  const max=Math.max(1,...data.flat()),total=data.flat().reduce((s,n)=>s+n,0),cell=22,L=40,T=18;
  let peak={d:0,h:0,n:0};data.forEach((row,d)=>row.forEach((n,h)=>{if(n>peak.n)peak={d,h,n};}));
  const level=(n:number)=>n===0?0:Math.min(4,Math.ceil(n/max*4));
  return <figure className="chart heatmap"><figcaption><strong>下单时段分布</strong><small>近 {days} 天 · 北京时间{total>0?` · 高峰：${WEEK[peak.d]} ${peak.h}:00–${peak.h+1}:00（${peak.n} 单）`:''}</small></figcaption>
    <div className="heatmap-scroll" tabIndex={0} role="region" aria-label="下单时段分布（可左右滚动）"><svg viewBox={`0 0 ${L+24*cell} ${T+7*cell}`} role="img" aria-label={`按星期和小时统计的下单分布，共 ${total} 单`}>
      {[0,6,12,18,23].map(h=><text key={h} className="axis" x={L+h*cell+cell/2} y={11} textAnchor="middle">{h}时</text>)}
      {data.map((row,d)=><g key={d}><text className="axis" x={L-6} y={T+d*cell+cell/2+4} textAnchor="end">{WEEK[d]}</text>
        {row.map((n,h)=><rect key={h} className={`heat-cell l${level(n)}`} data-d={d} x={L+h*cell+1.5} y={T+d*cell+1.5} width={cell-3} height={cell-3} rx={4}><title>{`${WEEK[d]} ${h}:00–${h+1}:00：${n} 单`}</title></rect>)}</g>)}
    </svg></div>
    <p className="heat-legend" aria-hidden="true">少<span className="l0"/><span className="l1"/><span className="l2"/><span className="l3"/><span className="l4"/>多</p>
  </figure>;
}
function exportAnalytics(a:Analytics){
  const rows:(string|number)[][]=[['CampusDrop 运营数据',`近 ${a.days} 天`,new Date().toLocaleString('zh-CN')],[],['指标','数值'],
    ['今日订单',a.kpis.today],['近 7 日订单',a.kpis.last7],['进行中',a.kpis.active],['已完成',a.kpis.completed],['完成率(%)',a.kpis.completionRate??''],['平均配送时长(分钟)',a.kpis.avgDeliveryMinutes??''],['平均评分',a.kpis.avgStars??''],['评价数',a.kpis.ratingCount],
    [],['日期','订单数'],...a.trend.map(t=>[t.day,t.count]),
    [],['宿舍楼','订单数'],...a.buildings.map(b=>[b.building,b.count]),
    [],['星期 \\ 小时',...Array.from({length:24},(_,h)=>`${h}时`)],...a.heatmap.map((row,d)=>[WEEK[d],...row])];
  downloadText(`campusdrop-analytics-${a.days}d-${new Date().toISOString().slice(0,10)}.csv`,toCsv(rows));
  toast('已导出看板数据','success','包含指标、每日订单、楼栋排行和时段分布');
}
function StaffTable({staff,days}:{staff:Analytics['staff'];days:number}){
  return <figure className="chart staff-table"><figcaption><strong>配送员表现</strong><small>近 {days} 天 · 按已送达单数排序</small></figcaption>
    {staff.length?<div className="table-scroll" tabIndex={0} role="region" aria-label="配送员表现（可左右滚动）"><table><thead><tr><th scope="col">配送员</th><th scope="col">接单</th><th scope="col">已送达</th><th scope="col">送达率</th><th scope="col">平均配送时长</th><th scope="col">评分</th></tr></thead>
      <tbody>{staff.map((s,i)=><tr key={s.name}><th scope="row">{i<3&&s.delivered>0?<span className={`rank r${i+1}`} aria-label={`第 ${i+1} 名`}>{i+1}</span>:null}{s.name}</th><td>{s.orders}</td><td>{s.delivered}</td><td><span className="ratio"><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect className="bar-track" width="100" height="8" rx="4"/><rect className="bar-fill" width={s.orders?s.delivered/s.orders*100:0} height="8" rx="4"/></svg>{s.orders?Math.round(s.delivered/s.orders*100):0}%</span></td><td>{s.avgMinutes===null?'—':s.avgMinutes<1?'<1 分钟':`${s.avgMinutes} 分钟`}</td><td>{s.avgStars===null?'—':`${s.avgStars.toFixed(1)} ★（${s.ratings}）`}</td></tr>)}</tbody></table></div>
      :<p className="muted">这段时间还没有接单记录。</p>}
    <p className="muted staff-note">平均配送时长按“已取件”到“已送达”计算；评分来自学生确认收货后的评价，仅管理员可见。</p>
  </figure>;
}
function Kpi({label,value,suffix,format,hint}:{label:string;value:number|null;suffix?:string;format?:(n:number)=>string;hint?:string}){
  return <div className="kpi"><small>{label}</small><strong>{value===null?'—':<><CountUp value={value} from={0} format={format}/>{suffix&&<em>{suffix}</em>}</>}</strong>{hint&&<span>{hint}</span>}</div>;
}
export function AdminAnalytics(){
  const me=useResource<{admin:Admin}>('/admin/me');const [days,setDays]=useState(14);const r=useResource<{analytics:Analytics;generatedAt:number}>(`/admin/analytics?days=${days}`,!!me.data);
  const a=r.data?.analytics;const role=me.data?.admin.role;
  const mixTotal=a?.mix.reduce((s,m)=>s+m.count,0)??0,mix=(size:string,mode:string)=>a?.mix.find(m=>m.size===size&&m.mode===mode)?.count??0;
  const ratingTotal=a?.ratings.distribution.reduce((s,n)=>s+n,0)??0;
  return <AdminShell><div className="row"><div><p className="eyebrow">运营数据</p><h1>数据看板</h1></div><div className="analytics-tools"><div className="range-chips" role="group" aria-label="统计范围">{[7,14,30].map(n=><button key={n} type="button" className="chip" aria-pressed={days===n} onClick={()=>setDays(n)}>近 {n} 天</button>)}</div><button className="text-button" disabled={!a} onClick={()=>a&&exportAnalytics(a)}>导出 CSV</button><button className="text-button" disabled={r.loading} onClick={()=>void r.refresh()}>{r.loading?'正在刷新…':'刷新'}</button></div></div>
    <p className="muted">统计你授权范围内的已支付订单{role==='DELIVERY_STAFF'?'（配送人员仅统计分配给自己的批次）':''}。{r.data&&`更新于 ${new Date(r.data.generatedAt*1000).toLocaleTimeString('zh-CN')}`}</p>
    <p role="alert">{r.error}</p>{r.loading&&!a&&<LoadingState label="正在汇总数据…"/>}
    {a&&<div className="analytics">
      <div className="kpi-grid">
        <Kpi label="今日订单" value={a.kpis.today}/><Kpi label="近 7 日订单" value={a.kpis.last7}/><Kpi label="进行中" value={a.kpis.active} hint="待取件至待收货"/>
        <Kpi label="完成率" value={a.kpis.completionRate} suffix="%" format={n=>n.toFixed(0)} hint={`已结束 ${a.kpis.closed} 单`}/>
        <Kpi label="平均配送时长" value={a.kpis.avgDeliveryMinutes===null?null:Math.max(a.kpis.avgDeliveryMinutes,0)} suffix="分钟" format={n=>n<1?'<1':String(n)} hint={`近 ${days} 天 · 支付到送达`}/>
        <Kpi label="平均评分" value={a.kpis.avgStars} suffix="★" format={n=>n.toFixed(1)} hint={`${a.kpis.ratingCount} 条评价`}/>
      </div>
      <StalledOrders/>
      <TrendChart trend={a.trend}/>
      <Heatmap data={a.heatmap} days={a.days}/>
      <div className="chart-row"><StatusDonut statuses={a.statuses}/><BarList title="楼栋订单排行" note={`近 ${days} 天 · 前 8 名`} rows={a.buildings.map(b=>({label:b.building,value:b.count}))}/></div>
      <div className="chart-row">
        <figure className="chart mix-grid"><figcaption><strong>包裹与配送方式</strong><small>近 {days} 天 · 共 {mixTotal} 单</small></figcaption>
          <table><thead><tr><th/><th scope="col">楼下</th><th scope="col">到寝</th></tr></thead><tbody>{(['SMALL','LARGE'] as const).map(size=><tr key={size}><th scope="row">{size==='SMALL'?'小件':'大件'}</th>{(['DOWNSTAIRS','ROOM'] as const).map(mode=>{const n=mix(size,mode);return <td key={mode} className={n&&n===Math.max(...a.mix.map(m=>m.count))?'is-top':undefined}><strong>{n}</strong><small>{mixTotal?Math.round(n/mixTotal*100):0}%</small></td>;})}</tr>)}</tbody></table></figure>
        <figure className="chart rating-summary"><figcaption><strong>学生评价</strong><small>{ratingTotal} 条 · 仅管理员可见</small></figcaption>
          {ratingTotal?<><ol className="rating-dist">{[5,4,3,2,1].map(s=>{const n=a.ratings.distribution[s-1];return <li key={s}><span>{s} ★</span><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect className="bar-track" width="100" height="8" rx="4"/><rect className="bar-fill rating" width={Math.max(n?3:0,n/ratingTotal*100)} height="8" rx="4"/></svg><strong>{n}</strong></li>;})}</ol>
            {a.ratings.tags.length>0&&<p className="tag-cloud">{a.ratings.tags.map(t=><span key={t.tag} className="chip">{t.tag}<b>{t.count}</b></span>)}</p>}</>:<p className="muted">还没有学生评价。确认收货后的订单可以评价。</p>}
        </figure>
      </div>
      <StaffTable staff={a.staff} days={a.days}/>
      {a.ratings.recent.length>0&&<section className="recent-ratings"><h2>最新评价</h2><ul>{a.ratings.recent.map((x,i)=><li key={i}><span className="rating-stars" aria-label={`${x.stars} 星`}>{'★'.repeat(x.stars)}<span aria-hidden="true">{'★'.repeat(5-x.stars)}</span></span><p>{x.comment||<span className="muted">（未留言）</span>}</p><small>{x.building} · {new Date(x.createdAt*1000).toLocaleString('zh-CN')}{x.tags.length>0&&` · ${x.tags.join('、')}`}</small></li>)}</ul></section>}
    </div>}
  </AdminShell>;
}

/** Starting points for common notices; every field stays editable before publishing. */
const TEMPLATES:{name:string;level:AnnouncementLevel;title:string;body:string;duration:number}[]=[
  {name:'恶劣天气暂停',level:'PAUSE',title:'恶劣天气，今日暂停配送',body:'为保障配送员安全，今日暂停接单与配送，已接订单会在恢复后优先处理。恢复时间另行通知。',duration:2},
  {name:'提前收工',level:'NOTICE',title:'今晚提前收工',body:'今晚配送员提前收工，之后下单的包裹将在明天处理，急件请自行到站点领取。',duration:1},
  {name:'节假日安排',level:'INFO',title:'假期配送安排',body:'假期期间配送时间有调整，具体以站点通知为准。返校高峰订单较多，送达可能稍慢，请耐心等待。',duration:4},
  {name:'站点调整',level:'NOTICE',title:'取件站点临时调整',body:'站点临时调整营业安排，部分包裹取件可能延迟，配送员会在订单中更新说明。',duration:3},
];
const DURATIONS:[string,number|undefined][]=[['直到手动下线',undefined],['6 小时',6],['24 小时',24],['3 天',72],['7 天',168]];
function announcementState(a:Announcement){const now=Date.now()/1000;return a.status==='ARCHIVED'?'已下线':a.endsAt&&a.endsAt<=now?'已到期':'生效中';}
export function AdminAnnouncements(){
  const list=useResource<{announcements:(Announcement&{author:string})[]}>('/admin/announcements');
  const [level,setLevel]=useState<AnnouncementLevel>('INFO'),[title,setTitle]=useState(''),[body,setBody]=useState(''),[duration,setDuration]=useState(2),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const id=useId();
  async function publish(e:FormEvent){
    e.preventDefault();setMessage('');
    const parsed=announcementCreate.safeParse({level,title,body,...(DURATIONS[duration][1]?{durationHours:DURATIONS[duration][1]}:{})});
    if(!parsed.success){setMessage('请填写 1–40 字标题，正文不超过 200 字，且不要包含尖括号等特殊字符');return;}
    setBusy(true);try{await api('/admin/announcements','POST',parsed.data);toast('公告已发布','success','学生端首页会立即显示');setTitle('');setBody('');await list.refresh();}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}
  }
  async function archive(target:string){setBusy(true);try{await api(`/admin/announcements/${target}/archive`,'POST',{confirmed:true});toast('公告已下线','info');await list.refresh();}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}
  return <AdminShell><p className="eyebrow">运营广播</p><h1>公告管理</h1><p className="muted">公告显示在学生端顶部，最多同时展示 3 条。“暂停服务”级别会置顶且学生无法关闭，请仅在确实暂停配送时使用。</p>
    {list.unauthorized||list.error.includes('超级管理员')?<p role="alert">{list.error}</p>:<>
    <form className="announce-form" onSubmit={publish}>
      <div className="templates" role="group" aria-label="公告模板"><span>快速套用：</span>{TEMPLATES.map(t=><button key={t.name} type="button" className="chip" onClick={()=>{setLevel(t.level);setTitle(t.title);setBody(t.body);setDuration(t.duration);toast(`已套用“${t.name}”模板`,'info','发布前请按实际情况修改内容和有效期');}}>{t.name}</button>)}</div>
      <ChoiceSelector label="公告级别" value={level} onChange={v=>setLevel(v as AnnouncementLevel)} options={[{value:'INFO',label:'通知',icon:'chat',hint:'一般信息'},{value:'NOTICE',label:'提醒',icon:'bell',hint:'需要留意'},{value:'PAUSE',label:'暂停服务',icon:'pause',hint:'置顶且不可关闭'}]}/>
      <label>标题<input required maxLength={40} value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：今晚 22:00 后暂停接单"/></label><small>{title.length}/40</small>
      <label>正文（选填）<textarea maxLength={200} rows={3} value={body} onChange={e=>setBody(e.target.value)} placeholder="补充原因、恢复时间或替代安排"/></label><small>{body.length}/200</small>
      <label htmlFor={`${id}-d`}>有效期</label><select id={`${id}-d`} value={duration} onChange={e=>setDuration(Number(e.target.value))}>{DURATIONS.map(([l],i)=><option key={l} value={i}>{l}</option>)}</select>
      <p className="eyebrow">学生端预览</p>
      <div className="announcements is-preview" aria-label="公告预览"><div className={`announcement level-${level.toLowerCase()}`}><span className="announcement-tag">{ANNOUNCEMENT_LEVEL_LABELS[level]}</span><p><strong>{title||'公告标题'}</strong>{body&&<span>{body}</span>}</p></div></div>
      <p role="alert">{message}</p><button className={busy?'is-busy':undefined} disabled={busy||!title.trim()}>{busy?'正在发布…':'发布公告'}</button>
    </form>
    <h2>历史公告</h2>{list.loading&&!list.data&&<LoadingState/>}{list.data?.announcements.length===0&&<EmptyState title="还没有发布过公告" icon="chat"><p>天气、节假日或站点调整时，可以在这里通知所有同学。</p></EmptyState>}
    <div className="card-list">{list.data?.announcements.map(a=>{const state=announcementState(a);return <article key={a.id} className={`parcel-card announcement-card level-${a.level.toLowerCase()}`}><div className="row"><strong>{a.title}</strong><span className="badge" data-state={state}>{state}</span></div>{a.body&&<p>{a.body}</p>}
      <p className="muted">{ANNOUNCEMENT_LEVEL_LABELS[a.level]} · {a.author} · 发布于 {new Date(a.createdAt*1000).toLocaleString('zh-CN')}{a.endsAt?` · 至 ${new Date(a.endsAt*1000).toLocaleString('zh-CN')}`:''}</p>
      {state==='生效中'&&<ConfirmAction label="下线公告" title="确认下线这条公告？" busy={busy} onConfirm={()=>archive(a.id)}><p>下线后学生端立即不再显示，记录会保留在历史中。</p></ConfirmAction>}</article>;})}</div></>}
    <p><Link to="/admin">返回配送工作台</Link></p>
  </AdminShell>;
}
