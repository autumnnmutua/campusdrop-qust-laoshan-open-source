import {RoundHistory,BulkPickupView} from './service-pages';
import { ConfirmAction,AdminTaskTable,SensitiveValue,LoadingState,EmptyState,CountUp,LiveIndicator } from './components';
import { useEffect,useRef,useState,type FormEvent,type ReactNode } from 'react';
import { Link,NavLink,Navigate,useLocation,useParams } from 'react-router-dom';
import { HandoffPanel } from './handoff-panel';
import { CourierCodeEntry,OrderChat,orderSlotText } from './live-ui';
import { useLiveChannel } from './live';
import type { AvailableOrder } from '../shared/delivery';
import type { Admin,AdminRole,Building } from '../shared/contracts';
import { nextStatuses } from '../domain/commerce';
import {CAMPUS_ID,STATUS_LABELS,TASK_GROUP_LABELS} from '../shared/constants';
import type {Order,OrderStatus} from '../shared/delivery';
import { api } from './api';
import { exportTasksCsv } from './csv';
import { StalledOrders } from './admin-alerts';
import { flagTitle,toast } from './effects';
import { SymbolIcon } from './campus-design';
import { money,useResource } from './student-delivery';
import { DeliveryPhotoView } from './order-extras';
import { DROP_PLACE_LABELS,type RoutePlan } from '../shared/campus-map';
import { slotLabel } from '../shared/slots';
export function AdminShell({children}:{children:ReactNode}){const me=useResource<{admin:Admin}>('/admin/me');const {pathname}=useLocation();useLiveChannel(me.data?'admin':null);
  // On phones the nav is a swipeable row; keep the current tab visible after navigating.
  useEffect(()=>{const nav=document.querySelector<HTMLElement>('.admin-nav'),active=nav?.querySelector<HTMLElement>('a.active');if(nav&&active&&nav.scrollWidth>nav.clientWidth)nav.scrollLeft=active.offsetLeft-(nav.clientWidth-active.offsetWidth)/2;},[pathname,me.data]);
  if(me.loading&&!me.data)return <LoadingState/>;if(me.error)return <section><p className="eyebrow">CAMPUSDROP / 工作空间</p><h1>{me.unauthorized?'请先登录管理员':'工作台暂时无法打开'}</h1>{me.unauthorized?<p className="muted">管理员工作台仅对已授权账号开放，登录后自动返回。</p>:<p role="alert">{me.error}</p>}<Link className="button" to="/admin/login">管理员登录</Link></section>;if(me.data&&!me.data.admin.phone)return <Navigate to="/admin/account" replace/>;const super_=me.data?.admin.role==='SUPER_ADMIN';
  return <section className="admin-section"><aside className="admin-sidebar"><nav className="admin-nav" aria-label="管理员导航">
    <p className="admin-nav-group">配送</p><NavLink to="/admin" end>配送任务</NavLink><NavLink to="/admin/map">作战地图</NavLink><NavLink to="/admin/batches">批次管理</NavLink><NavLink to="/admin/sends">代寄件</NavLink><NavLink to="/admin/tickets">售后工单</NavLink>
    <p className="admin-nav-group">运营</p><NavLink to="/admin/analytics">数据看板</NavLink><NavLink to="/admin/punctuality">准时率</NavLink><NavLink to="/admin/settlement">结算</NavLink><NavLink to="/admin/report">月报</NavLink>
    {super_&&<><p className="admin-nav-group">管理</p><NavLink to="/admin/settings">运营设置</NavLink><NavLink to="/admin/announcements">公告管理</NavLink><NavLink to="/admin/admins">管理员</NavLink><NavLink to="/admin/audit">审计日志</NavLink><NavLink to="/admin/recovery">账号恢复</NavLink><NavLink to="/admin/errors">错误监控</NavLink></>}
    <p className="admin-nav-group">账号</p><NavLink to="/admin/account">我的授权</NavLink></nav>
    {me.data&&<div className="admin-identity"><strong>{me.data.admin.username}</strong>{ADMIN_ROLE_LABELS[me.data.admin.role]??me.data.admin.role} · 一人一号，授权范围内协作</div>}
  </aside><div className="admin-content">{children}</div></section>;}
const ADMIN_ROLE_LABELS:Record<string,string>={SUPER_ADMIN:'超级管理员',ZONE_ADMIN:'区域管理员',BUILDING_ADMIN:'楼栋管理员',DELIVERY_STAFF:'配送人员'};
export function TaskCard({order,refresh,select,onSelect}:{order:Order;refresh:()=>Promise<void>;select?:boolean;onSelect?:(checked:boolean)=>void}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[reason,setReason]=useState('OTHER'),[detail,setDetail]=useState(''),[exception,setException]=useState<OrderStatus|null>(null),[releaseReason,setReleaseReason]=useState('');
  useEffect(()=>{setException(null);setDetail('');setReleaseReason('');},[order.id,order.version]);
  async function advance(status:OrderStatus){setBusy(true);try{if(status==='CANCELLED')await api(`/admin/orders/${order.id}/release`,'POST',{version:order.version,confirmed:true,reason:releaseReason.trim()});else await api(`/admin/orders/${order.id}/status`,'PATCH',{status,version:order.version,...(['FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(status)?{exceptionCode:reason,exceptionNote:detail}:{})});setError('');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <article className="parcel-card task-card" data-order-id={order.id}><div className="row"><strong>{order.dropPlace?<>{DROP_PLACE_LABELS[order.dropPlace]}<small className="muted"> · {order.dormSnapshot.buildingName}</small></>:<>{order.dormSnapshot.buildingName} · {order.dormSnapshot.roomNo}</>}</strong><span key={order.status} className="badge just-advanced" data-status={order.status}>{STATUS_LABELS[order.status]}</span></div>{order.groupId&&(order.groupSize??0)>1&&<p className="group-note"><span className="group-chip">合并 {order.groupSize} 件</span>同一位同学的合并配送：取件、出发、送达会同步到同组包裹；当面核验一次收货码即全部签收。异常只标记当前这件。</p>}
    <p>{order.packageSize==='SMALL'?'小件':'大件'} / {order.deliveryMode==='ROOM'?'到寝':'楼下'} · {money(order.amountFen)}</p><p className="muted">{order.stationSnapshot.canonicalName} · 联系电话 {order.dormSnapshot.phone}</p>{orderSlotText(order)&&<p className="slot-tag"><span>预约</span>{orderSlotText(order)}</p>}{order.dropPlace&&<p className="slot-tag place-tag"><span>地点</span>送到{DROP_PLACE_LABELS[order.dropPlace]}，不上楼</p>}{order.proxyName&&<p className="proxy-tag">代收人：<strong>{order.proxyName}</strong>（同学本人不在时交给 TA）</p>}<p>备注：{order.note||'暂无备注'}</p>{order.exceptionNote&&<p role="alert">问题说明：{order.exceptionNote}</p>}
    {onSelect&&order.status==='WAITING_PICKUP'&&<label className="check"><input type="checkbox" checked={select} onChange={e=>onSelect(e.target.checked)}/>加入取件批次</label>}
    {!['COMPLETED','CANCELLED'].includes(order.status)&&<SensitiveValue orderId={order.id} version={order.version}/>}
    {exception&&<div className="exception-form"><h3>{STATUS_LABELS[exception]}说明</h3><label htmlFor={`reason-${order.id}`}>异常原因</label><select id={`reason-${order.id}`} value={reason} onChange={e=>setReason(e.target.value)}><option value="OTHER">其他异常</option><option value="CODE_INVALID">取件码无效</option><option value="SIZE_MISMATCH">大小件不符</option><option value="UNREACHABLE">无法联系</option></select><label>问题说明（选填，学生可见）<textarea maxLength={240} value={detail} onChange={e=>setDetail(e.target.value)} placeholder="例如：包裹不在货架、寝室无人接收"/></label><div className="actions"><button disabled={busy} onClick={()=>void advance(exception)}>确认标记</button><button className="secondary" disabled={busy} onClick={()=>{setException(null);setDetail('');}}>取消标记</button></div></div>}
    <CourierExtras order={order} refresh={refresh}/><CourierCodeEntry order={order} refresh={refresh}/>{!['COMPLETED','CANCELLED'].includes(order.status)&&<OrderChat orderId={order.id} admin unread={order.chatUnreadCourier??0}/>}<RoundHistory order={order}/><HandoffPanel order={order} refresh={refresh}/><div className="actions task-actions">{nextStatuses(order.status,order.deliveryMode).filter(s=>s!=='COMPLETED').map(s=>s==='CANCELLED'?<ConfirmAction key={s} label="退回接单市场" title="确认退回接单市场？" canConfirm={releaseReason.trim().length>0} validationMessage="请填写退回理由，学生和下一位接单人都会看到。" busy={busy} onConfirm={()=>advance(s)}><p>学生会看到退单原因，其他配送员可以重新接单。若已取到包裹，请先完成交接或放回取件站点。</p><label>退单说明<textarea maxLength={240} value={releaseReason} onChange={e=>setReleaseReason(e.target.value)}/></label></ConfirmAction>:<button key={s} className={['CANCELLED','FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(s)?'secondary':''} disabled={busy} onClick={()=>{if(['FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(s)){setException(s);setDetail('');setReason('OTHER');}else void advance(s);}}>{STATUS_LABELS[s]}</button>)}</div><p role="status">{error}</p>
  </article>;
}
function AvailableTasks({onClaim,revision}:{onClaim:()=>Promise<void>;revision:number}){
 const [cursor,setCursor]=useState(''),[back,setBack]=useState<string[]>([]),[building,setBuilding]=useState(''),[size,setSize]=useState(''),[mode,setMode]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const query=new URLSearchParams({pageSize:'12',...(cursor?{cursor}:{}),...(building?{building}:{}),...(size?{packageSize:size}:{}),...(mode?{deliveryMode:mode}:{})});
 const resource=useResource<{orders:AvailableOrder[];nextCursor:string|null;hasMore:boolean;total:number;newestAt:number|null}>(`/admin/available?${query}`),buildings=useResource<{buildings:Building[]}>('/dorm-buildings');
 useEffect(()=>{void resource.refresh();},[revision,resource.refresh]);
 // Auto-refresh every 30 s (also in a background tab, so the title badge can say new orders arrived). "New" is judged
 // from the newest creation time across the whole filtered market, so orders landing beyond page 1 still count and
 // orders that merely moved up a page after a claim do not.
 const seen=useRef<{newestAt:number|null;total:number}|null>(null),queryKey=new URLSearchParams({building,size,mode}).toString();
 useEffect(()=>{seen.current=null;},[queryKey]);
 useEffect(()=>{
  const d=resource.data;if(!d)return;
  const prev=seen.current;seen.current={newestAt:d.newestAt,total:d.total};
  if(!prev||d.newestAt===null||(prev.newestAt!==null&&d.newestAt<=prev.newestAt))return;
  const fresh=Math.max(1,d.total-prev.total);
  toast(`新增 ${fresh} 单待接订单`,'info',d.hasMore?'待接订单按下单先后排列，新订单可能在后面的页':'已出现在待接订单列表中');flagTitle(fresh,'新订单');
 },[resource.data]);
 const {revalidate}=resource;
 useEffect(()=>{const t=setInterval(()=>{void revalidate().catch(()=>{});},30000);return()=>clearInterval(t);},[revalidate]);
 function reset(){setCursor('');setBack([]);}
 async function claim(id:string){setBusy(true);try{await api(`/admin/orders/${id}/claim`,'POST',{confirmed:true});setMessage('接单成功，已加入我的任务');toast('接单成功','success','已加入我的任务，可在下方查看');await onClaim();}catch(e){setMessage((e as Error).message);}finally{await resource.refresh();setBusy(false);}}
 return <section><div className="row"><h2 className="market-heading">待接订单{resource.data&&<small className="market-total">共 {resource.data.total} 单</small>}<LiveIndicator label="每 30 秒自动刷新"/></h2><button className="text-button" onClick={()=>{reset();void resource.refresh();}}>刷新待接订单</button></div><p>服务端筛选 · 每页12条 · 接单后才显示联系方式与取件码。</p><div className="filters"><label>市场楼栋<select value={building} onChange={e=>{setBuilding(e.target.value);reset();}}><option value="">全部授权范围</option>{buildings.data?.buildings.map(b=><option key={b.code} value={b.code}>{b.displayName}</option>)}</select></label><label>市场包裹大小<select value={size} onChange={e=>{setSize(e.target.value);reset();}}><option value="">全部</option><option value="SMALL">小件</option><option value="LARGE">大件</option></select></label><label>市场配送方式<select value={mode} onChange={e=>{setMode(e.target.value);reset();}}><option value="">全部</option><option value="ROOM">到寝</option><option value="DOWNSTAIRS">楼下</option></select></label></div><p role="status">{message}</p><p role="alert">{resource.error}</p>{resource.loading&&!resource.data&&<LoadingState/>}<div className="card-list market-grid">{resource.data?.orders.map(o=><article className="parcel-card market-card" data-order-id={o.id} key={o.id}><strong>{o.dropPlace?DROP_PLACE_LABELS[o.dropPlace]:o.buildingName}</strong>{o.groupId&&(o.groupSize??0)>1&&<span className="group-chip">合并 {o.groupSize} 件 · 一起接走</span>}<p>{o.stationName}{o.slotDate&&o.slotCode?` · 预约${slotLabel(o.slotDate,o.slotCode,Math.floor(Date.now()/1000))}`:''}</p><p>{o.packageSize==='SMALL'?'小件':'大件'} · {o.deliveryMode==='ROOM'?'到寝':'楼下'} · {money(o.amountFen)}</p><button disabled={busy} onClick={()=>void claim(o.id)}>接单</button></article>)}</div>{resource.data?.orders.length===0&&<p>本页暂无待接订单，请刷新或调整筛选。</p>}<div className="actions"><button className="secondary" disabled={!back.length} onClick={()=>{setCursor(back.at(-1)!);setBack(back.slice(0,-1));}}>待接上一页</button><span>第 {back.length+1} 页</span><button className="secondary" disabled={!resource.data?.nextCursor} onClick={()=>{setBack([...back,cursor]);setCursor(resource.data!.nextCursor!);}}>待接下一页</button></div></section>;
}
export function AdminTasks(){
  const [marketRevision,setMarketRevision]=useState(0);
  const [filters,setFilters]=useState({group:'ALL',status:'',building:'',packageSize:'',deliveryMode:''});
  const [cursor,setCursor]=useState(''),[back,setBack]=useState<string[]>([]);
  const page=back.length+1;function setPage(next:number){if(next===1){setCursor('');setBack([]);}else if(next<page){setCursor(back.at(-1)!);setBack(back.slice(0,-1));}else if(tasks.data?.nextCursor){setBack([...back,cursor]);setCursor(tasks.data.nextCursor);}}
  const query=new URLSearchParams(Object.entries(filters).filter(([,v])=>v));query.set('pageSize','30');if(cursor)query.set('cursor',cursor);
  // Ask for workspace data only once the admin session is confirmed, so signed-out visits make a single /admin/me call.
  const me=useResource<{admin:Admin}>('/admin/me'),ready=!!me.data;
  const tasks=useResource<{orders:Order[];nextCursor:string|null}>(`/admin/tasks?${query}`,ready);
  const buildings=useResource<{buildings:Building[]}>('/admin/dorm-buildings',ready);
  const stats=useResource<{counts:{status:OrderStatus;count:number}[]}>('/admin/dashboard',ready);
  const [selected,setSelected]=useState<string[]>([]),[assignee,setAssignee]=useState(''),[assignees,setAssignees]=useState<{id:string;username:string}[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(me.data&&me.data.admin.role!=='DELIVERY_STAFF')api<{admins:{id:string;username:string}[]}>('/admin/assignees').then(r=>{setAssignees(r.admins);setAssignee(me.data!.admin.id);}).catch(e=>setMessage(e.message));},[me.data]);
  async function refresh(){setMarketRevision(v=>v+1);setSelected([]);await tasks.refresh();await stats.refresh();}
  async function batch(){setBusy(true);try{await api('/admin/batches','POST',{orderIds:selected,assigneeAdminId:assignee});setMessage('批次已创建，可前往批次管理查看');await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <AdminShell><h1>配送工作台</h1><StalledOrders compact/>{me.data&&me.data.admin.role!=='DELIVERY_STAFF'&&assignees.length>0&&<AutoPlan assignees={assignees} defaultAssignee={me.data.admin.id} onCreated={refresh}/>}<AvailableTasks onClaim={refresh} revision={marketRevision}/><h2>我的授权任务</h2><p className="muted">模拟订单 · 只显示你负责的任务</p><div className="stats">{stats.data?.counts.map(c=><span key={c.status} data-status={c.status}>{STATUS_LABELS[c.status]} <strong><CountUp value={c.count} from={0}/></strong></span>)}</div>
    <div className="filters"><div><label htmlFor="task-group">订单分类</label><select id="task-group" value={filters.group} onChange={e=>{setFilters({...filters,group:e.target.value,status:''});setPage(1);setSelected([]);}}>{Object.entries(TASK_GROUP_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div><div><label htmlFor="task-status">具体状态</label><select id="task-status" disabled={filters.group!=='ALL'} value={filters.status} onChange={e=>{setFilters({...filters,status:e.target.value});setPage(1);setSelected([]);}}><option value="">全部已支付任务</option>{Object.entries(STATUS_LABELS).filter(([k])=>k!=='WAITING_PAYMENT').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
      <label>楼栋<select value={filters.building} onChange={e=>{setFilters({...filters,building:e.target.value});setPage(1);setSelected([]);}}><option value="">全部授权楼栋</option>{buildings.data?.buildings.map(b=><option key={b.code} value={b.code}>{b.displayName}</option>)}</select></label>
      <label>大小件<select value={filters.packageSize} onChange={e=>{setFilters({...filters,packageSize:e.target.value});setPage(1);setSelected([]);}}><option value="">全部</option><option value="SMALL">小件</option><option value="LARGE">大件</option></select></label>
      <label>配送方式<select value={filters.deliveryMode} onChange={e=>{setFilters({...filters,deliveryMode:e.target.value});setPage(1);setSelected([]);}}><option value="">全部</option><option value="ROOM">到寝</option><option value="DOWNSTAIRS">楼下</option></select></label></div>
    <p role="alert">{tasks.error||me.error||buildings.error||stats.error}</p>{(tasks.error||me.error)&&<Link to="/admin/login">管理员登录</Link>}
    {me.data?.admin.role!=='DELIVERY_STAFF'&&assignees.length>0&&<div className="batch-tools"><button className="secondary" disabled={busy} onClick={()=>setSelected((tasks.data?.orders??[]).filter(o=>o.status==='WAITING_PICKUP').slice(0,20).map(o=>o.id))}>全选本页待取件（最多20单）</button><button className="text-button" disabled={busy} onClick={()=>setSelected([])}>清空批次选择</button><label htmlFor="batch-assignee">批次负责人</label><select id="batch-assignee" value={assignee} onChange={e=>setAssignee(e.target.value)}>{assignees.map(a=><option key={a.id} value={a.id}>{a.username}</option>)}</select><button disabled={busy||selected.length===0||selected.length>20} onClick={()=>void batch()}>生成取件批次（{selected.length}/20）</button></div>}
    <p role="status">{message}</p>{tasks.loading&&!tasks.data&&<LoadingState/>}{tasks.data?.orders.length===0&&<EmptyState title="当前任务已清空"><p>暂无符合筛选条件的订单，可以调整筛选或稍后刷新。</p></EmptyState>}
    <BulkPickupView orders={tasks.data?.orders??[]}/><AdminTaskTable orders={tasks.data?.orders??[]} renderTask={o=><TaskCard key={o.id} order={o} refresh={refresh} select={selected.includes(o.id)} onSelect={me.data?.admin.role==='DELIVERY_STAFF'?undefined:checked=>setSelected(checked?(selected.length<20?[...selected,o.id]:selected):selected.filter(id=>id!==o.id))}/>}/>
    <div className="actions"><button className="secondary" disabled={page===1} onClick={()=>{setPage(page-1);setSelected([]);}}>上一页</button><span>第 {page} 页</span><button className="secondary" disabled={!tasks.data?.nextCursor} onClick={()=>{setPage(page+1);setSelected([]);}}>下一页</button><button className="text-button" onClick={()=>void refresh()}>刷新任务</button><Link className="text-button" to="/admin/route-sheet">打印配送路线单</Link><button className="text-button" disabled={!tasks.data?.orders.length} onClick={()=>{exportTasksCsv(tasks.data?.orders??[]);toast(`已导出本页 ${tasks.data?.orders.length??0} 条任务`,'success','表格不含电话和取件码');}}>导出本页 CSV</button></div>
  </AdminShell>;
}
export function Batches(){
  const {data,error,loading}=useResource<{batches:{id:string;stationCode:string;assigneeName:string;orderCount:number}[]}>('/admin/batches');
  return <AdminShell><h1>取件与配送批次</h1><p role="alert">{error}</p>{loading&&!data&&<LoadingState/>}{data?.batches.length===0&&<p>还没有批次，请在配送任务中勾选待取件订单。</p>}<div className="card-list">{data?.batches.map(b=><article className="parcel-card" key={b.id}><strong>{b.assigneeName} · {b.orderCount} 单</strong><p>站点 {b.stationCode}</p><Link to={`/admin/batches/${b.id}`}>打开批次</Link></article>)}</div></AdminShell>;
}
export function BatchDetail(){
  const {id}=useParams();const resource=useResource<{orders:Order[]}>(`/admin/batches/${id}`);const [detail,setDetail]=useState(''),[status,setStatus]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const orders=resource.data?.orders??[];const common=orders.length?nextStatuses(orders[0].status,orders[0].deliveryMode).filter(s=>s!=='CANCELLED'&&s!=='COMPLETED').filter(s=>orders.every(o=>nextStatuses(o.status,o.deliveryMode).includes(s))):[];
  async function apply(){setBusy(true);try{const r=await api<{results:{ok:boolean}[]}>(`/admin/batches/${id}/status`,'PATCH',{status,versions:Object.fromEntries(orders.map(o=>[o.id,o.version])),...(['FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(status)?{exceptionCode:'OTHER',exceptionNote:detail}:{})});setMessage(`成功 ${r.results.filter(x=>x.ok).length} 单；未更新 ${r.results.filter(x=>!x.ok).length} 单。未更新的订单请刷新后逐单检查。`);setStatus('');await resource.refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <AdminShell><h1>批次详情</h1><p>按区域和楼栋排列。仅操作当前授权范围内的订单。</p><p role="alert">{resource.error}</p>{resource.loading&&!resource.data&&<LoadingState/>}<label htmlFor="batch-next">批量推进</label><select id="batch-next" value={status} onChange={e=>setStatus(e.target.value)}><option value="">选择共同的下一状态</option>{common.map(s=><option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>{['FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(status)&&<label>本批次问题说明<textarea maxLength={240} value={detail} onChange={e=>setDetail(e.target.value)}/></label>}<button disabled={!status||busy} onClick={()=>void apply()}>更新本批次</button><p role="status">{message}</p><div className="task-grid">{orders.map(o=><TaskCard key={o.id} order={o} refresh={resource.refresh}/>)}</div></AdminShell>;
}
export function AdminAccounts(){
  const list=useResource<{admins:{id:string;username:string;role:AdminRole;status:string}[]}>('/admin/admins');const buildings=useResource<{buildings:Building[]}>('/dorm-buildings');
  const [role,setRole]=useState<AdminRole>('ZONE_ADMIN'),[zone,setZone]=useState<'SOUTH'|'NORTH'>('SOUTH'),[codes,setCodes]=useState<string[]>([]),[editing,setEditing]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const form=new FormData(e.currentTarget);
    const scopes=role==='SUPER_ADMIN'||role==='DELIVERY_STAFF'?[]:role==='ZONE_ADMIN'?[{campusId:CAMPUS_ID,zone,buildingCode:null}]:codes.map(code=>({campusId:CAMPUS_ID,zone:code.startsWith('SOUTH')?'SOUTH':'NORTH',buildingCode:code}));
    try{await api(editing?`/admin/admins/${editing}/scopes`:'/admin/admins',editing?'PUT':'POST',{role,scopes,...(!editing?{username:form.get('username'),password:form.get('password')}:{})});setMessage('管理员设置已保存');setEditing('');await list.refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function disable(id:string){try{await api(`/admin/admins/${id}/disable`,'POST');await list.refresh();}catch(e){setMessage((e as Error).message);}}
  return <AdminShell><h1>管理员与授权</h1><p role="alert">{list.error}</p>{list.loading&&!list.data&&<LoadingState/>}{list.data&&<><div className="card-list">{list.data.admins.map(a=><article key={a.id} className="parcel-card"><strong>{a.username}</strong><p>{a.role} · {a.status}</p><div className="actions">{a.role!=='SUPER_ADMIN'&&<><button className="secondary" onClick={()=>{setEditing(a.id);setRole(a.role);setCodes([]);}}>重新分配权限</button><button className="secondary" disabled={a.status==='DISABLED'} onClick={()=>void disable(a.id)}>停用账号</button></>}</div></article>)}</div>
    <h2>{editing?'重新分配权限':'创建管理员'}</h2><form onSubmit={save}>{!editing&&<><label>新管理员用户名<input name="username" required minLength={3} maxLength={32}/></label><label>新管理员密码<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label></>}
      <label htmlFor="admin-role">角色</label><select id="admin-role" value={role} onChange={e=>{setRole(e.target.value as AdminRole);setCodes([]);}}>{(['SUPER_ADMIN','ZONE_ADMIN','BUILDING_ADMIN','DELIVERY_STAFF'] as const).map(r=><option key={r}>{r}</option>)}</select>
      {role==='ZONE_ADMIN'&&<><label htmlFor="admin-zone">负责区域</label><select id="admin-zone" value={zone} onChange={e=>setZone(e.target.value as 'SOUTH'|'NORTH')}><option value="SOUTH">南苑</option><option value="NORTH">北苑</option></select></>}
      {role==='BUILDING_ADMIN'&&<fieldset><legend>负责楼栋</legend>{buildings.data?.buildings.map(b=><label className="check" key={b.code}><input type="checkbox" checked={codes.includes(b.code)} onChange={e=>setCodes(e.target.checked?[...codes,b.code]:codes.filter(c=>c!==b.code))}/>{b.displayName}</label>)}</fieldset>}
      <button disabled={busy}>{busy?'保存中…':'保存管理员'}</button>{editing&&<button type="button" className="text-button" onClick={()=>setEditing('')}>取消修改</button>}
    </form></>}<p role="status">{message}</p></AdminShell>;
}
export function Audit(){
  const {data,error,loading}=useResource<{logs:{id:string;action:string;actorId:string;resourceId:string;metadata:string;createdAt:number}[]}>('/admin/audit');
  return <AdminShell><h1>操作审计</h1><p>展示最近 100 条，取件码只保留脱敏值。</p><p role="alert">{error}</p>{loading&&!data&&<LoadingState/>}{data?.logs.length===0&&<EmptyState title="还没有审计记录"/>}<div className="card-list">{data?.logs.map(log=><article className="parcel-card" key={log.id}><strong>{log.action}</strong><small>{new Date(log.createdAt*1000).toLocaleString()}</small><p className="identifier">操作者：{log.actorId}</p><p className="identifier">资源：{log.resourceId}</p><code>{log.metadata}</code></article>)}</div></AdminShell>;
}

export function AdminOrderDetail(){const {id}=useParams();const r=useResource<{order:Order}>(`/admin/orders/${id}`);return <AdminShell><h1>订单详情</h1><Link to="/admin/tickets">返回售后工作台</Link><p role="alert">{r.error}</p>{r.loading&&!r.data&&<LoadingState/>}{r.data&&<TaskCard order={r.data.order} refresh={r.refresh}/>}</AdminShell>;}

// ---------------------------------------------------------------- courier extras on the task card (v2.7)

/** Compress a phone photo to a JPEG under ~190 KB (longest side ≤ 1280 px) before uploading. */
async function compressPhoto(file:File):Promise<Blob>{
  const bitmap=await createImageBitmap(file);
  let scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
  for(let attempt=0;attempt<6;attempt++){
    const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
    canvas.getContext('2d')?.drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const quality of [.78,.66,.54]){
      const blob=await new Promise<Blob|null>(done=>canvas.toBlob(done,'image/jpeg',quality));
      if(blob&&blob.size<=190*1024){bitmap.close();return blob;}
    }
    scale*=.75;
  }
  bitmap.close();throw new Error('照片过大，请靠近一点重新拍摄');
}
/** "快到了" notice and the delivery photo (送达拍照存证), shown to the courier while the order is out or just delivered. */
function CourierExtras({order,refresh}:{order:Order;refresh:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const canPhoto=['OUT_FOR_DELIVERY','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED'].includes(order.status);
  if(!canPhoto)return null;
  async function near(){setBusy(true);setMessage('');try{const r=await api<{sent:boolean;message:string}>(`/admin/orders/${order.id}/near`,'POST',{version:order.version});toast(r.message,r.sent?'success':'info');await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function upload(file:File){
    setBusy(true);setMessage('');
    try{
      const blob=await compressPhoto(file);
      const response=await fetch(`/api/v1/admin/orders/${order.id}/photo`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'image/jpeg'},body:blob});
      const result=await response.json().catch(()=>null) as {error?:{message?:string}}|null;
      if(!response.ok)throw new Error(response.status===413&&!result?.error?'当前部署方式不支持上传照片（需 Workers 直连部署）':result?.error?.message??'上传失败，请重试');
      toast('送达照片已上传','success','同学可以在订单详情里查看');await refresh();
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="courier-extras">
    {order.status==='OUT_FOR_DELIVERY'&&<button type="button" className="secondary" disabled={busy||!!order.nearNotifiedAt} onClick={()=>void near()}><SymbolIcon name="bell"/>{order.nearNotifiedAt?'已通知同学快到了':'快到了，通知同学'}</button>}
    <label className={`photo-capture button secondary${busy?' is-busy':''}`}><SymbolIcon name="camera"/>{order.hasPhoto?'重拍送达照片':'拍送达照片'}<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f);}}/></label>
    {order.hasPhoto&&<DeliveryPhotoView orderId={order.id} admin/>}
    {message&&<p role="alert">{message}</p>}
  </div>;
}

// ---------------------------------------------------------------- 一键排线 (auto batch + walking order)

type PlanResponse={station:string|null;plan:RoutePlan|null;remaining:number;orders:{id:string;dest:string;label:string;packageSize:string;deliveryMode:string}[]};
function AutoPlan({assignees,defaultAssignee,onCreated}:{assignees:{id:string;username:string}[];defaultAssignee:string;onCreated:()=>Promise<void>}){
  const [open,setOpen]=useState(false),[slot,setSlot]=useState('ASAP'),[assignee,setAssignee]=useState(defaultAssignee),[plan,setPlan]=useState<PlanResponse|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [windows,setWindows]=useState<{value:string;label:string}[]>([]);
  useEffect(()=>{if(!open)return;api<{shifts:unknown[];dates:string[]}>('/admin/shifts').then(r=>{const t=Math.floor(Date.now()/1000);setWindows(r.dates.flatMap(d=>(['NOON','EVENING','NIGHT'] as const).map(c=>({value:`${d}:${c}`,label:slotLabel(d,c,t)}))));}).catch(()=>{});},[open]);
  async function preview(){setBusy(true);setMessage('');try{setPlan(await api<PlanResponse>(`/admin/batches/plan?slot=${encodeURIComponent(slot)}`));}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  useEffect(()=>{if(open)void preview();},[open,slot]);
  async function create(){if(!plan?.orders.length)return;setBusy(true);setMessage('');try{await api('/admin/batches','POST',{orderIds:plan.orders.map(o=>o.id),assigneeAdminId:assignee});toast('已按路线生成取件批次','success',`${plan.orders.length} 单 · 约 ${plan.plan?.totalMinutes??'—'} 分钟`);setPlan(null);await onCreated();await preview();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <details className="auto-plan" open={open} onToggle={e=>setOpen((e.target as HTMLDetailsElement).open)}><summary><SymbolIcon name="map"/>一键排线 · 按路线自动分批</summary>
    <p className="muted">选一个时段，系统把待接单里同一站点的订单（最多 20 单）按校园道路排出送达顺序，确认后直接生成取件批次。距离与时间为步行估算。</p>
    <div className="filters"><label>时段<select value={slot} onChange={e=>setSlot(e.target.value)}><option value="ASAP">尽快送达（未预约）</option>{windows.map(w=><option key={w.value} value={w.value}>{w.label}</option>)}</select></label>
      <label>批次负责人<select value={assignee} onChange={e=>setAssignee(e.target.value)}>{assignees.map(a=><option key={a.id} value={a.id}>{a.username}</option>)}</select></label></div>
    {busy&&!plan&&<LoadingState/>}
    {plan&&(plan.orders.length?<>
      <ol className="plan-list">{plan.orders.map((o,i)=>{const leg=plan.plan?.legs.find(l=>l.code===o.dest);const first=plan.orders.findIndex(x=>x.dest===o.dest)===i;return <li key={o.id}><b>{i+1}</b><span>{o.label}<small>{o.packageSize==='SMALL'?'小件':'大件'} · {o.deliveryMode==='ROOM'?'到寝':'楼下'}</small></span>{first&&leg?<em>+{leg.meters} 米</em>:<em className="muted">同一站</em>}</li>;})}</ol>
      <p className="plan-total">全程约 <strong>{plan.plan?.totalMeters??0}</strong> 米 · 预计 <strong>{plan.plan?.totalMinutes??0}</strong> 分钟（含每站约 2 分钟交接）{plan.remaining>0&&` · 另有 ${plan.remaining} 单留待下一批`}{plan.plan?.unplaced.length?` · ${plan.plan.unplaced.length} 个楼栋不在平面图上，排在最后`:''}</p>
      <div className="actions"><button type="button" disabled={busy} onClick={()=>void create()}>生成取件批次（{plan.orders.length} 单）</button><button type="button" className="text-button" disabled={busy} onClick={()=>void preview()}>重新计算</button></div>
    </>:<p className="muted">这个时段没有可分批的待接订单。</p>)}
    {message&&<p role="alert">{message}</p>}
  </details>;
}
