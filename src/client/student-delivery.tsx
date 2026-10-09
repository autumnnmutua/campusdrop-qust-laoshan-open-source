import {RoundHistory} from './service-links';
function randomClientId(){if(crypto.randomUUID)return crypto.randomUUID();return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&(15>>Number(c)/4)).toString(16));}
import {SymbolIcon} from './campus-design';
import { ChoiceSelector,ConfirmAction,PickupCodeInput,ParcelCard,DeliveryModeSelector,PriceSummary,OrderTimeline,MockPaymentDialog,TipSheet,EmptyState,LoadingState } from './components';
import { useCallback,useEffect,useRef,useState,type FormEvent } from 'react';
import { Link,useNavigate,useParams,useLocation } from 'react-router-dom';
import { api } from './api';
import { useLiveOrder } from './live-order';
import { CARRIERS,MOCK_MESSAGE,parcelSchema,STATUS_LABELS,type DeliveryMode,type Order,type OrderEvent,type Parcel,type Payment,type Station } from '../shared/delivery';
export const money=(fen:number)=>`¥${(fen/100).toFixed(2)}`;
export function useResource<T>(path:string){
  const location=useLocation();
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const generation=useRef(0);
  const refresh=useCallback(async()=>{const version=++generation.current;setLoading(true);try{const next=await api<T>(path);if(version===generation.current){setData(next);setError('');}}catch(e){if(version===generation.current){setData(null);setError((e as Error).message);}}finally{if(version===generation.current)setLoading(false);}},[path]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh,location.key]);
  /** Background refresh: keeps current data on failure and throws so callers (polling) can react, e.g. to 401. */
  const revalidate=useCallback(async()=>{const version=generation.current;const next=await api<T>(path);if(version===generation.current){setData(next);setError('');}},[path]);
  return {data,error,loading,refresh,revalidate,setError};
}
export function Notice({error}:{error:string}){return error?<p role="alert">{error} <Link to="/login">学生登录</Link></p>:null;}
function orderProgress(status:Order['status']){return status==='COMPLETED'||status.startsWith('DELIVERED')?3:status==='OUT_FOR_DELIVERY'?2:status==='PICKED_UP'?1:0;}
/** Remembers what an order looked like when first shown, so only later changes get the step-advance animation. */
function useOrderBaseline(order:Order|undefined){
 const [baseline,setBaseline]=useState<{id:string;status:Order['status']}|null>(null);
 if(order&&baseline?.id!==order.id)setBaseline({id:order.id,status:order.status});
 return order&&baseline?.id===order.id?baseline:null;
}
function CurrentOrderPreview(){
 const {data,revalidate}=useResource<{orders:Order[]}>('/orders?pageSize=1');const order=data?.orders[0];
 useLiveOrder(order?.status,revalidate);
 const baseline=useOrderBaseline(order);
 if(!order)return null;
 const progress=orderProgress(order.status),startProgress=baseline?orderProgress(baseline.status):progress,statusChanged=!!baseline&&baseline.status!==order.status;
 return <article className="current-order"><div className="row"><strong>当前订单</strong><span key={order.status} className={statusChanged?'badge just-advanced':'badge'}>{STATUS_LABELS[order.status]}</span></div><p>{order.dormSnapshot.buildingName} · {order.packageSize==='SMALL'?'小件':'大件'} · {money(order.amountFen)}</p>{!['CANCELLED','FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(order.status)&&<ol className="compact-progress" aria-label="当前订单阶段">{['已下单','已取件','配送中','已送达'].map((label,index)=><li key={label} className={(index<=progress?'reached':'')+(index>startProgress&&index<=progress?' just-advanced':'')}><span>{index<=progress?'✓':index+1}</span>{label}</li>)}</ol>}{order.serviceNotice&&<p className="muted">{order.serviceNotice}</p>}<Link to={`/orders/${order.id}`}>查看订单详情 ›</Link></article>;
}
function QuickEntry(){
 const navigate=useNavigate();const [code,setCode]=useState(''),[size,setSize]=useState('SMALL'),[mode,setMode]=useState<DeliveryMode>('DOWNSTAIRS');
 return <form className="quick-entry" onSubmit={e=>{e.preventDefault();navigate('/parcel/new',{state:{pickupCode:code,packageSize:size,deliveryMode:mode}});}}><PickupCodeInput value={code} onChange={setCode}/><div className="quick-choice-grid"><ChoiceSelector label="包裹类型" value={size} onChange={setSize} options={[{value:'SMALL',label:'小件',icon:'box'},{value:'LARGE',label:'大件',icon:'box'}]}/><DeliveryModeSelector value={mode} onChange={setMode}/></div><div className="rate-grid">{[['小件 · 楼下',2],['小件 · 到寝',3],['大件 · 楼下',5],['大件 · 到寝',7]].map(([label,price])=><div key={label}><small>{label}</small><strong>¥{price}<em>元</em></strong></div>)}</div><button className="launch-order" type="submit"><SymbolIcon name="plane"/>立即下单<span aria-hidden="true">›</span></button><small className="quick-footnote">下一步确认站点与包裹资料，费用以服务端报价为准</small></form>;
}
export function Home(){
  const {data,error,loading,refresh,setError}=useResource<{parcels:Parcel[]}>('/parcels');
  const [busy,setBusy]=useState(''),[expanded,setExpanded]=useState(false),[removed,setRemoved]=useState<string[]>([]),[feedback,setFeedback]=useState('');
  const parcels=(data?.parcels??[]).filter(p=>p.status!=='CANCELLED'&&!removed.includes(p.id));
  async function remove(id:string){setBusy(id);try{await api(`/parcels/${id}`,'DELETE');setRemoved(ids=>[...ids,id]);setFeedback('包裹已移除');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  return <section className="student-home"><div className="home-hero"><div className="hero-copy"><p className="hero-school">青岛科技大学<span>崂山校区 · CAMPUSDROP</span></p><h1>校园快递配送</h1><p className="hero-subtitle">让每一份包裹<br/>更快抵达你的身边</p><div className="hero-features"><span><SymbolIcon name="box"/>手动登记</span><span><SymbolIcon name="person"/>校园配送</span><span><SymbolIcon name="order"/>进度可查</span></div></div><span className="hero-note">把时间留给校园生活</span></div>
    <div className="home-dashboard"><div className="home-quick"><div className="panel-heading"><SymbolIcon/><h2>快速下单</h2><small>简单几步 · 安排配送</small></div><p>选择寝室、填写取件码，剩下的交给配送流程。</p><Link className="address-shortcut" to="/profile"><SymbolIcon name="room"/><span>我的收货寝室<small>下单前请确认地址与联系电话</small></span><b>切换 ›</b></Link><QuickEntry/></div>
    <div className="home-live"><CurrentOrderPreview/><div className="panel-heading"><SymbolIcon name="order"/><h2>我的包裹</h2><Link to="/orders">全部订单 ›</Link></div><Notice error={error==='请先登录'?'':error}/>{error==='请先登录'&&<EmptyState title="登录后，查看你的包裹"><p>登记包裹、查看配送进度，让期待更近一步。</p><Link className="button secondary" to="/login">学生登录</Link></EmptyState>}{loading&&!data&&<LoadingState/>}{data&&parcels.length===0&&<EmptyState title="下一件快递，从这里开始"><p>登记取件码后，就能安排配送。</p><Link to="/parcel/new">添加第一件快递 →</Link></EmptyState>}<p role="status">{feedback}</p><div className="card-list">{(expanded?parcels:parcels.slice(0,3)).map(p=><ParcelCard key={p.id} parcel={p} busy={busy===p.id} onRemove={()=>void remove(p.id)}/>)}</div>{parcels.length>3&&<button className="secondary" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起包裹':`更多包裹（还有 ${parcels.length-3} 件）`}</button>}<div className="service-shortcuts"><Link to="/guide"><SymbolIcon name="order"/><strong>配送说明</strong><small>计费 · 范围 · 交接</small></Link><Link to="/help"><SymbolIcon name="help"/><strong>常见问题</strong><small>使用指南与解答</small></Link><Link to="/contact"><SymbolIcon name="phone"/><strong>配送联系</strong><small>找到订单接单人</small></Link></div><div className="campus-message"><SymbolIcon name="plane"/><p>传递的不止包裹<br/><strong>更是校园里的温度</strong></p></div></div></div>
  </section>;
}
export function NewParcel(){
  const {data,error,loading}=useResource<{stations:Station[]}>('/stations');
  const location=useLocation(),draft=location.state as {pickupCode?:unknown;packageSize?:unknown;deliveryMode?:unknown}|null;
  const [packageSize,setPackageSize]=useState(draft?.packageSize==='LARGE'?'LARGE':'SMALL');
  const [code,setCode]=useState(typeof draft?.pickupCode==='string'?draft.pickupCode.slice(0,20):''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const navigate=useNavigate();

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage('');const form=new FormData(e.currentTarget);
    const parsed=parcelSchema.safeParse({pickupCode:code,stationCode:form.get('stationCode'),packageSize:form.get('packageSize'),...(form.get('carrier')?{carrier:form.get('carrier')}:{}),note:form.get('note')});
    if(!parsed.success){setMessage('请检查取件码格式和备注，备注不能超过 120 字或包含 HTML');return;}
    setBusy(true);try{const result=await api<{parcel:Parcel}>('/parcels','POST',parsed.data);navigate(`/parcel/${result.parcel.id}`,{state:{deliveryMode:draft?.deliveryMode==='ROOM'?'ROOM':'DOWNSTAIRS'}});}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <section><Link to="/">← 我的包裹</Link><h1>添加快递</h1><p className="muted">请确认你有权委托领取该包裹。</p><Notice error={error}/>{loading&&!data&&<LoadingState/>}
    <form onSubmit={submit}><PickupCodeInput value={code} onChange={setCode}/>
      <label htmlFor="station">取件站点</label><select id="station" name="stationCode" required>{data?.stations.map(s=><option key={s.code} value={s.code}>{s.canonicalName}</option>)}</select>
      <ChoiceSelector label="包裹大小" name="packageSize" value={packageSize} onChange={setPackageSize} options={[{value:'SMALL',label:'小件',icon:'box',hint:'轻便包裹'},{value:'LARGE',label:'大件',icon:'box',hint:'较大包裹'}]}/>
      <label htmlFor="carrier">承运商（选填）</label><select id="carrier" name="carrier"><option value="">暂不填写</option>{CARRIERS.map(c=><option key={c}>{c}</option>)}</select>
      <label htmlFor="parcel-note">备注（选填）</label><textarea id="parcel-note" name="note" maxLength={120} rows={3}/><small>最多 120 字，请勿填写额外取件凭证。</small>
      <p role="alert">{message}</p><button disabled={busy||!data?.stations.length}>{busy?'正在登记…':'保存包裹'}</button>
    </form><p><Link to="/orders">已有订单？前往继续支付或查看配送</Link></p>
  </section>;
}
export function ParcelDetail(){
  const {id}=useParams();const {data,error,loading}=useResource<{parcel:Parcel}>(`/parcels/${id}`);
  const location=useLocation();
  const [mode,setMode]=useState<DeliveryMode>(location.state?.deliveryMode==='ROOM'?'ROOM':'DOWNSTAIRS'),[amount,setAmount]=useState<number|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const navigate=useNavigate();const size=data?.parcel.packageSize;
  useEffect(()=>{let current=true;setAmount(null);if(size)api<{amountFen:number}>('/quotes','POST',{packageSize:size,deliveryMode:mode}).then(r=>{if(current)setAmount(r.amountFen);}).catch(e=>{if(current)setMessage(e.message);});return()=>{current=false;};},[size,mode]);
  async function order(){setBusy(true);try{const r=await api<{order:Order}>('/orders','POST',{parcelId:id,deliveryMode:mode});navigate(`/checkout/${r.order.id}`);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <section><Link to="/">← 我的包裹</Link><h1>安排配送</h1><Notice error={error}/>{loading&&!data&&<LoadingState/>}{data&&<><p className="pickup-code">{data.parcel.pickupCode}</p><p>{size==='SMALL'?'小件':'大件'} · 请再次核对取件码</p>
    <DeliveryModeSelector value={mode} onChange={setMode}/><PriceSummary amount={amount}/>
    <p className="muted">按已保存的寝室配送，<Link to="/profile">修改寝室</Link>。</p>
    <button disabled={busy||amount===null||data.parcel.status!=='ACTIVE'} onClick={()=>void order()}>{busy?'正在创建…':'确认并下单'}</button></>}
    <p role="alert">{message}</p><Link to="/orders">查看已有订单</Link>
  </section>;
}
function OrderActions({order,refresh,onMessage}:{order:Order;refresh:()=>Promise<void>;onMessage:(message:string)=>void}){
  const [note,setNote]=useState(order.note),[busy,setBusy]=useState(false);
  useEffect(()=>setNote(order.note),[order.note]);
  async function act(action:'note'|'cancel'|'hide'|'upgrade'){
    setBusy(true);
    try {
      const result=await api<{message?:string;refund?:{amountFen:number}}>(`/orders/${order.id}/${action}`,action==='note'?'PATCH':'POST',{version:order.version,confirmed:true,...(action==='note'?{note}:{})});
      onMessage(action==='cancel'?`配送已取消，已模拟退款 ${money(result.refund?.amountFen??0)}，未发生真实资金流转`:action==='hide'?'订单已隐藏，退款和审计记录保留':result.message??(action==='note'?'备注已修改':'配送方式已更新'));await refresh();
    } catch(error){onMessage((error as Error).message);await refresh();}finally{setBusy(false);}
  }
  return <div className="order-actions"><p className="muted">备注：{order.note||'暂无备注'}</p><details><summary>修改备注</summary><label>新备注<textarea maxLength={120} value={note} onChange={e=>setNote(e.target.value)} disabled={busy}/></label><ConfirmAction label="保存备注" title="确认修改备注？" busy={busy} onConfirm={()=>act('note')}><p>{note||'将清空备注'}</p></ConfirmAction></details>
    <div className="actions">{order.status.startsWith('DELIVERED')?<Link to={`/orders/${order.id}`}>已送达，请确认收货</Link>:['CANCELLED','COMPLETED'].includes(order.status)?<ConfirmAction label="隐藏订单" title="确认隐藏订单？" busy={busy} onConfirm={()=>act('hide')}><p>仅从列表移除，不发起新的退款；退款和审计记录仍然保留。</p></ConfirmAction>:<ConfirmAction label="取消配送" title="确认取消配送并模拟退款？" busy={busy} onConfirm={()=>act('cancel')}><p>订单将取消配送并按实际模拟支付金额退款，当前可退 {money(order.refundableFen)}。订单会保留，方便查看退款结果。</p>{order.custodyState==='STAFF'&&<p>包裹已取出，请先联系配送员完成归还与核验，系统才允许取消。</p>}</ConfirmAction>}
    {order.deliveryMode==='DOWNSTAIRS'&&['WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY'].includes(order.status)&&<ConfirmAction label={`改为送到寝室 · 补${(order.upgradeQuoteFen??(order.packageSize==='LARGE'?200:100))/100}元`} title="确认升级配送并模拟补付？" busy={busy} onConfirm={()=>act('upgrade')}><p>额外模拟支付 {money(order.upgradeQuoteFen??(order.packageSize==='LARGE'?200:100))}，改为送到已保存的寝室；未发生真实扣款。</p></ConfirmAction>}</div></div>;

}
function DeliveryContact({order}:{order:Order}){return <div className="delivery-contact">{order.serviceNotice&&<p role="status">{order.serviceNotice}</p>}{order.assigneePhone&&<p>接单人联系电话：<a href={`tel:${order.assigneePhone}`}>{order.assigneePhone}</a></p>}{order.exceptionNote&&<p role="alert">配送问题说明：{order.exceptionNote}</p>}</div>;}
export function Orders(){
  const [cursor,setCursor]=useState(''),[back,setBack]=useState<string[]>([]);
  const {data,error,loading,refresh}=useResource<{orders:Order[];nextCursor:string|null}>(`/orders?pageSize=20${cursor?'&cursor='+encodeURIComponent(cursor):''}`);const [message,setMessage]=useState('');
  return <section><div className="row"><h1>我的订单</h1><button className="text-button" onClick={()=>void refresh()}>刷新</button></div><Notice error={error}/><p role="status">{message}</p>{loading&&!data&&<LoadingState/>}{data?.orders.length===0&&<p>暂无订单，<Link to="/parcel/new">添加快递</Link>。</p>}
    <div className="card-list">{data?.orders.map(o=><article key={o.id} className="parcel-card"><div className="row"><span className="badge">{STATUS_LABELS[o.status]}</span><strong>{money(o.amountFen)}</strong></div><p>{o.dormSnapshot.buildingName} · {o.dormSnapshot.roomNo}</p><p>{o.packageSize==='SMALL'?'小件':'大件'} / {o.deliveryMode==='ROOM'?'到寝':'楼下'}</p><Link to={o.status==='WAITING_PAYMENT'?`/checkout/${o.id}`:`/orders/${o.id}`}>{o.status==='WAITING_PAYMENT'?'继续模拟支付':'查看进度'}</Link><RoundHistory order={o}/><DeliveryContact order={o}/><OrderActions order={o} refresh={refresh} onMessage={setMessage}/></article>)}</div>
    <div className="actions"><button className="secondary" disabled={!back.length} onClick={()=>{setCursor(back.at(-1)!);setBack(back.slice(0,-1));}}>订单上一页</button><span>第 {back.length+1} 页</span><button className="secondary" disabled={!data?.nextCursor} onClick={()=>{setBack([...back,cursor]);setCursor(data!.nextCursor!);}}>订单下一页</button></div>
  </section>;
}
export interface Details {order:Order;events:OrderEvent[];payments:Payment[]}
export function OrderDetail({checkout=false}:{checkout?:boolean}){
  const params=useParams();const id=params.id??params.orderId;const {data,error,refresh,revalidate,loading}=useResource<Details>(`/orders/${id}`);
  useLiveOrder(data?.order.status,revalidate);const baseline=useOrderBaseline(data?.order);const statusChanged=!!baseline&&!!data&&baseline.status!==data.order.status;
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function pay(){setBusy(true);try{await api(`/orders/${id}/mock-pay`,'POST');setMessage('');await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function cancel(){setBusy(true);try{await api(`/orders/${id}/cancel`,'POST',{version:data!.order.version,confirmed:true});setMessage('订单已取消');await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <section><Link to="/orders">← 我的订单</Link><h1>{checkout&&data?.order.status==='WAITING_PAYMENT'?'确认模拟支付':'配送进度'}</h1><Notice error={error}/>{loading&&!data&&<LoadingState/>}{data&&<>
    <span key={data.order.status} className={statusChanged?'badge just-advanced':'badge'}>{STATUS_LABELS[data.order.status]}</span><p className="price">{money(data.order.amountFen)}</p><p>{data.order.dormSnapshot.buildingName} · {data.order.dormSnapshot.roomNo}</p><p>{data.order.stationSnapshot.canonicalName}</p><p>{data.order.deliveryMode==='ROOM'?'送到寝室':'送到楼下'}</p><p>备注：{data.order.note||'暂无备注'}</p>{data.order.upgradeFen>0&&<p>含升级配送模拟补款 {money(data.order.upgradeFen)}</p>}
    {data.order.status==='WAITING_PAYMENT'&&<div className="actions"><MockPaymentDialog amount={data.order.amountFen} busy={busy} onPay={pay}/><button className="secondary" disabled={busy} onClick={()=>void cancel()}>取消订单</button></div>}
    {data.payments.some(p=>p.type==='DELIVERY')&&<p className="success">模拟支付成功，未发生真实扣款</p>}
    {data.order.exceptionCode&&<p role="alert">异常原因：{{CODE_INVALID:'取件码无效',SIZE_MISMATCH:'大小件不符',UNREACHABLE:'暂时无法联系',OTHER:'其他异常'}[data.order.exceptionCode]??'其他异常'}，请联系管理员处理。</p>}
    <RoundHistory order={data.order}/>{['DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'].includes(data.order.status)&&<ConfirmAction label="确认收货" title="确认已经收到包裹？" busy={busy} onConfirm={async()=>{setBusy(true);try{await api(`/orders/${id}/receive`,'POST',{version:data.order.version,confirmed:true});await refresh();setMessage('收货已确认，谢谢使用');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}><p>请核对实际包裹。未收到或有问题时，请先发起售后。</p></ConfirmAction>}<p><Link to={`/tickets/new?orderId=${data.order.id}`}>发起售后工单</Link> · <Link to="/tickets">我的售后</Link></p><DeliveryContact order={data.order}/>{data.payments.filter(p=>p.type==='REFUND').map(p=><p className="success" key={p.id}>已模拟退款 {money(p.amountFen)}，未发生真实资金流转</p>)}<OrderTimeline events={data.events}/>
    {data.order.status==='COMPLETED'&&<Link className="button" to={`/tip/${data.order.id}`}>感谢配送 · 模拟打赏</Link>}
    <button className="text-button" onClick={()=>void refresh()}>刷新配送进度</button>
    </>}{message&&<p role="status">{message}</p>}
  </section>;
}
export function TipPage(){
  const {orderId}=useParams();const {data,error,refresh,loading}=useResource<Details>(`/orders/${orderId}`);
  const [amount,setAmount]=useState('2'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const storageKey=`campusdrop-tip-${orderId}`;const key=useRef(sessionStorage.getItem(storageKey)||randomClientId());
  async function tip(){
    if(!/^\d{1,3}(\.\d{1,2})?$/.test(amount)){setMessage('请输入 0.01–100 元，最多两位小数');return;}
    const fen=Math.round(Number(amount)*100);if(fen<1||fen>10000){setMessage('金额应在 0.01–100 元之间');return;}
    setBusy(true);sessionStorage.setItem(storageKey,key.current);
    try{await api(`/orders/${orderId}/tips/mock-pay`,'POST',{amountFen:fen,idempotencyKey:key.current});setMessage('打赏成功，未发生真实扣款');await refresh();}
    catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const tipped=data?.payments.some(p=>p.type==='TIP');
  return <section><Link to={`/orders/${orderId}`}>← 订单详情</Link><h1>感谢这次配送</h1><Notice error={error}/>{loading&&!data&&<LoadingState/>}<p>{MOCK_MESSAGE}</p>
    {tipped?<p className="success">已收到你的模拟打赏，谢谢！</p>:<TipSheet amount={amount} onChange={setAmount} busy={busy} disabled={data?.order.status!=='COMPLETED'} onSubmit={()=>void tip()}/>}
    <p role="status">{message}</p>
  </section>;
}
