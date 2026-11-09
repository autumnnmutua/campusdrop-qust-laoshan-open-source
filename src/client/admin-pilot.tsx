/* © 2026 专业团队 · CampusDrop v4.5.0 */
import './zod-config';
import {useId,useState} from 'react';
import {AdminShell} from './admin-delivery';
import {CountUp,LoadingState} from './components';
import {useResource} from './student-delivery';
import {money} from './format';
import {downloadText,toCsv} from './csv';
import {PILOT_ASAP_TARGET,PILOT_PERIODS,type PilotDay,type PilotReport} from '../shared/pilot';

/*
 * v3.8 · 实测报告. The numbers a trial has to show — who used it and came back, on-time deliveries and how long they
 * took, ratings, problems and money — with the definitions written underneath, a daily chart, a weekly table and a CSV
 * export. Inside the one-click demo the page reads the demo's test data and says so.
 */
const pct=(v:number|null,d=1)=>v===null?'—':`${(v*100).toFixed(d)}%`;
function Tile({label,value,suffix,format,hint}:{label:string;value:number|null;suffix?:string;format?:(n:number)=>string;hint?:string}){
  return <div className="kpi"><small>{label}</small><strong>{value===null?'—':<><CountUp value={value} from={0} format={format}/>{suffix&&<em>{suffix}</em>}</>}</strong>{hint&&<span>{hint}</span>}</div>;
}

/** Orders per day as bars (one series, hover / focus shows the day). */
function DailyChart({daily}:{daily:PilotDay[]}){
  const id=useId(),[hover,setHover]=useState<number|null>(null);
  const max=Math.max(1,...daily.map(d=>d.orders)),w=720,h=180,pad=28,step=(w-pad*2)/Math.max(1,daily.length),bw=Math.max(2,Math.min(22,step-4));
  const ticks=[0,Math.ceil(max/2),max];
  const shown=hover===null?null:daily[hover];
  return <figure className="chart pilot-daily"><figcaption><strong>每日订单</strong><small>已支付订单 · 悬停查看当天</small></figcaption>
    <div className="pilot-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h+24}`} role="img" aria-labelledby={`${id}-d`} onMouseLeave={()=>setHover(null)}>
        <desc id={`${id}-d`}>{`每日订单数，共 ${daily.length} 天，最多 ${max} 单`}</desc>
        {ticks.map(v=>{const y=h-(v/max)*(h-16);return <g key={v} className="pilot-grid"><line x1={pad} x2={w-pad} y1={y} y2={y}/><text x={pad-6} y={y+4} textAnchor="end">{v}</text></g>;})}
        {daily.map((d,i)=>{const x=pad+i*step+(step-bw)/2,bh=(d.orders/max)*(h-16);return <g key={d.date} className={hover===i?'pilot-bar is-on':'pilot-bar'}>
          <rect className="hit" x={pad+i*step} y={0} width={step} height={h} onMouseEnter={()=>setHover(i)} onFocus={()=>setHover(i)} tabIndex={-1}/>
          <rect className="bar" x={x} y={h-bh} width={bw} height={Math.max(bh,d.orders?2:0)} rx={Math.min(4,bw/2)}/>
          {(i===0||i===daily.length-1||i%7===0)&&<text className="pilot-x" x={x+bw/2} y={h+16} textAnchor="middle">{d.date.slice(5).replace('-','/')}</text>}
        </g>;})}
      </svg>
      {shown&&<div className="pilot-tip" role="status" style={{left:`${Math.min(82,Math.max(4,(pad+hover!*step)/w*100))}%`}}><strong>{shown.date.slice(5).replace('-','/')}</strong><span>{shown.orders} 单 · {shown.users} 人</span><span>新用户 {shown.newUsers} · 准时 {shown.delivered?`${Math.round(shown.onTime/shown.delivered*100)}%`:'—'}</span></div>}
    </div>
    <details className="pilot-table-toggle"><summary>查看每日数据表</summary>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="每日数据（可左右滚动）"><table><thead><tr><th scope="col">日期</th><th scope="col">订单</th><th scope="col">下单人数</th><th scope="col">新用户</th><th scope="col">已送达</th><th scope="col">准时</th></tr></thead>
        <tbody>{daily.map(d=><tr key={d.date}><th scope="row">{d.date}</th><td>{d.orders}</td><td>{d.users}</td><td>{d.newUsers}</td><td>{d.delivered}</td><td>{d.onTime}</td></tr>)}</tbody></table></div>
    </details>
  </figure>;
}

function exportCsv(r:PilotReport){
  const kpi:[string,string|number][]=[['统计区间',`${new Date(r.from*1000).toLocaleDateString('zh-CN')} – ${new Date(r.to*1000).toLocaleDateString('zh-CN')}`],['数据类型',r.testData?'测试数据（一键体验）':'实测数据（已排除体验与测试账号）'],
    ['下单用户',r.users],['新用户',r.newUsers],['复购用户（2 天及以上下单）',r.repeatUsers],['复购率',pct(r.repeatRate)],['有效订单（已支付）',r.orders],['一次支付多件的订单',r.multiOrders],
    ['准时率',pct(r.onTimeRate)],['尽快送达中位时长（分钟）',r.asapMedian??''],['尽快送达 P90（分钟）',r.asapP90??''],['接单中位时长（分钟）',r.claimMedian??''],['路上中位时长（分钟）',r.rideMedian??''],
    ['异常率',pct(r.exceptionRate)],['支付后取消率',pct(r.cancelRate)],['评价率',pct(r.ratedShare)],['平均评分',r.avgStars??''],['售后工单',r.tickets],['每百单售后',r.ticketsPer100??''],['售后处理中位时长（小时）',r.resolveMedianHours??''],
    ['配送费原价合计（元）',(r.grossFen/100).toFixed(2)],['多件满减（元）',(r.bundleFen/100).toFixed(2)],['优惠券（元）',(r.couponFen/100).toFixed(2)],['实收（元）',(r.paidFen/100).toFixed(2)],['退款（元）',(r.refundFen/100).toFixed(2)],['打赏（元）',(r.tipFen/100).toFixed(2)],
    ['参与配送员',r.couriers],['人均每天送达（单）',r.perCourierDay??'']];
  const rows:(string|number)[][]=[['指标','数值'],...kpi,[],['日期','订单','下单人数','新用户','已送达','准时'],...r.daily.map(d=>[d.date,d.orders,d.users,d.newUsers,d.delivered,d.onTime])];
  downloadText(`campusdrop-${r.testData?'test-data':'trial'}-report-${new Date().toISOString().slice(0,10)}.csv`,toCsv(rows));
}

export function AdminPilot(){
  const [days,setDays]=useState<number>(0);
  const res=useResource<{report:PilotReport}>(`/admin/pilot-report?days=${days}`);
  const r=res.data?.report,starTotal=r?r.stars.reduce((a,b)=>a+b,0):0;
  return <AdminShell><div className="row"><div><h1>实测报告 {r?.testData&&<span className="test-data-badge">测试数据</span>}</h1></div>
    <div className="analytics-tools"><div className="range-chips" role="group" aria-label="统计范围">{PILOT_PERIODS.map(n=><button key={n} type="button" className="chip" aria-pressed={days===n} onClick={()=>setDays(n)}>{n?`近 ${n} 天`:'全部'}</button>)}</div>
      <button type="button" className="text-button" disabled={!r} onClick={()=>r&&exportCsv(r)}>导出 CSV</button></div></div>
    {r?.testData?<p className="test-data-note">一键体验中：以下为测试数据，用来展示实测阶段会统计哪些指标；真实上线后这里只统计真实订单。</p>
      :<p className="muted">统计你授权范围内已支付的真实订单，已排除一键体验和测试账号。实测阶段可以每周导出一次留档。</p>}
    <p role="alert">{res.error}</p>{res.loading&&!r&&<LoadingState label="正在汇总数据…"/>}
    {r&&r.orders===0&&<p className="muted">这段时间还没有已支付的订单。</p>}
    {r&&r.orders>0&&<div className="analytics pilot">
      <h2 className="pilot-group">用户与复购</h2>
      <div className="kpi-grid">
        <Tile label="下单用户" value={r.users} suffix="人" hint={`其中新用户 ${r.newUsers} 人`}/>
        <Tile label="复购率" value={r.repeatRate===null?null:r.repeatRate*100} suffix="%" format={n=>n.toFixed(1)} hint={`${r.repeatUsers} 人在 2 天及以上下过单`}/>
        <Tile label="有效订单" value={r.orders} suffix="单" hint={`人均 ${r.ordersPerUser??'—'} 单 · 一次支付多件 ${r.multiOrders} 单`}/>
      </div>
      <h2 className="pilot-group">履约质量</h2>
      <div className="kpi-grid">
        <Tile label="准时率" value={r.onTimeRate===null?null:r.onTimeRate*100} suffix="%" format={n=>n.toFixed(1)} hint={`${r.onTime}/${r.delivered} 单 · 预约占 ${pct(r.bookedShare,0)}`}/>
        <Tile label="尽快送达 · 中位时长" value={r.asapMedian} suffix="分钟" format={n=>n.toFixed(0)} hint={`P90 ${r.asapP90??'—'} 分钟 · 支付到送达`}/>
        <Tile label="接单 / 路上中位时长" value={r.claimMedian} suffix="分钟" format={n=>n.toFixed(0)} hint={`路上 ${r.rideMedian??'—'} 分钟（取件到送达）`}/>
        <Tile label="异常率" value={r.exceptionRate===null?null:r.exceptionRate*100} suffix="%" format={n=>n.toFixed(1)} hint={`${r.exceptions} 单 · 支付后取消 ${pct(r.cancelRate)}`}/>
      </div>
      <h2 className="pilot-group">评价与售后</h2>
      <div className="kpi-grid">
        <Tile label="平均评分" value={r.avgStars} suffix="★" format={n=>n.toFixed(2)} hint={`评价率 ${pct(r.ratedShare,0)}（${r.rated} 条）`}/>
        <Tile label="每百单售后" value={r.ticketsPer100} suffix="件" format={n=>n.toFixed(1)} hint={`共 ${r.tickets} 件 · 已解决 ${r.ticketsResolved} 件`}/>
        <Tile label="售后处理中位时长" value={r.resolveMedianHours} suffix="小时" format={n=>n.toFixed(1)} hint="创建到最后一次回复（已解决的工单）"/>
      </div>
      <h2 className="pilot-group">费用与人力</h2>
      <div className="kpi-grid">
        <Tile label="实收（模拟）" value={Math.round(r.paidFen/100)} suffix="元" hint={`${money(r.paidFen)} · 原价 ${money(r.grossFen)} · 退款 ${money(r.refundFen)}`}/>
        <Tile label="优惠支出" value={Math.round((r.bundleFen+r.couponFen)/100)} suffix="元" hint={`多件满减 ${money(r.bundleFen)} · 优惠券 ${money(r.couponFen)}`}/>
        <Tile label="人均每天送达" value={r.perCourierDay} suffix="单" format={n=>n.toFixed(1)} hint={`${r.couriers} 位配送员参与 · 打赏 ${money(r.tipFen)}`}/>
      </div>
      <DailyChart daily={r.daily}/>
      <div className="chart-row pilot-row">
        <figure className="chart"><figcaption><strong>按周对比</strong><small>每 7 天一列，看增长和稳定性</small></figcaption>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="按周对比（可左右滚动）"><table><thead><tr><th scope="col">周</th><th scope="col">订单</th><th scope="col">下单人数</th><th scope="col">新用户</th><th scope="col">准时率</th><th scope="col">评分</th><th scope="col">售后</th></tr></thead>
            <tbody>{r.weekly.map(w=><tr key={w.from}><th scope="row">{w.label}<small className="muted">{w.from.slice(5).replace('-','/')}–{w.to.slice(5).replace('-','/')}</small></th><td>{w.orders}</td><td>{w.users}</td><td>{w.newUsers}</td><td>{pct(w.onTimeRate)}</td><td>{w.avgStars?.toFixed(2)??'—'}</td><td>{w.tickets}</td></tr>)}</tbody></table></div>
        </figure>
        <figure className="chart rating-summary"><figcaption><strong>评分分布</strong><small>{starTotal} 条</small></figcaption>
          <ol className="rating-dist">{[5,4,3,2,1].map(s=>{const n=r.stars[s-1];return <li key={s}><span>{s} ★</span><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect className="bar-track" width="100" height="8" rx="4"/><rect className="bar-fill rating" width={starTotal?Math.max(n?3:0,n/starTotal*100):0} height="8" rx="4"/></svg><strong>{n}</strong></li>;})}</ol>
        </figure>
      </div>
      <details className="pilot-defs" open><summary>统计口径</summary><ul>
        <li>有效订单：已完成模拟支付的订单，按支付时间计入；支付后取消的也算（单独列出取消率）。</li>
        <li>新用户：第一次支付落在统计区间内的账号；复购：在 2 个及以上不同日期下过单的账号。</li>
        <li>准时：预约时段的订单在时段结束前送达；“尽快送达”的订单在支付后 {PILOT_ASAP_TARGET} 分钟内送达（与准时率看板一致）。</li>
        <li>中位时长与 P90：一半订单不超过中位数，九成订单不超过 P90；只看平均值容易被个别慢单带偏。</li>
        <li>异常：配送中出现过“取件异常”或“配送异常”的订单；售后按工单创建时间计入。</li>
        <li>金额均为模拟支付：多件满减和优惠券由平台承担，配送员按原价结算。</li>
      </ul></details>
    </div>}
  </AdminShell>;
}
