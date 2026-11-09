/* © 2026 专业团队 · CampusDrop v4.5.0 */
import {useState,type FormEvent} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {api} from './api';
import {t} from './i18n';
import {slotText} from './i18n-labels';
import {money} from './format';
import {toast} from './effects';
import {SymbolIcon} from './campus-design';
import {DROP_PLACE_LABELS} from '../shared/campus-map';
import {AGENT_MAX_CHARS,type AgentDraft,type AgentPlan,type AgentStep} from '../shared/agent';
import type {Order} from '../shared/delivery';
import { sizeLabel } from '../shared/delivery';
import type {OrderGroup} from '../shared/v3';

/*
 * v3.6 · drafts the agent prepared (智能体助手 / 一句话下单). A draft is only a proposal: "确认下单" creates it through
 * the ordinary order endpoints and opens checkout; "修改" opens the usual page with everything adjustable.
 */
const STEP_ICON:Record<AgentStep['tool'],string>={understand:'chat',list_parcels:'box',list_slots:'bell',quote:'order',draft:'send',list_orders:'order'};

export function AgentSteps({steps}:{steps:AgentStep[]}){
  if(!steps.length)return null;
  return <details className="agent-steps"><summary>{t('智能体步骤（{0} 步）',{0:steps.length})}</summary>
    <ol>{steps.map((s,i)=><li key={i} className={s.ok?'is-ok':'is-warn'}><SymbolIcon name={STEP_ICON[s.tool]}/><span><strong>{t(s.label)}</strong><small>{s.detail}</small></span></li>)}</ol>
  </details>;
}

function where(d:AgentDraft){return d.dropPlace?t('送到{0}',{0:t(DROP_PLACE_LABELS[d.dropPlace])}):d.deliveryMode==='ROOM'?t('送到寝室'):t('送到楼下');}
function when(d:AgentDraft){return d.slotDate&&d.slotCode?slotText(d.slotDate,d.slotCode,Math.floor(Date.now()/1000)):t('尽快送达');}

export function AgentDraftCard({draft,onDone}:{draft:AgentDraft;onDone?:()=>void}){
  const navigate=useNavigate(),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
  const group=draft.parcelIds.length>1;
  const slot=draft.slotDate&&draft.slotCode?{slotDate:draft.slotDate,slotCode:draft.slotCode}:{};
  const place=draft.dropPlace?{dropPlace:draft.dropPlace}:{};
  async function confirm(){
    if(busy||done)return;setBusy(true);setError('');
    try{
      if(group){const r=await api<{group:OrderGroup}>('/order-groups','POST',{parcelIds:draft.parcelIds,deliveryMode:draft.deliveryMode,...slot,...place});setDone(true);onDone?.();toast('订单已创建','success',t('请完成模拟支付'));navigate(`/checkout-group/${r.group.id}`);}
      else{const r=await api<{order:Order}>('/orders','POST',{parcelId:draft.parcelIds[0],deliveryMode:draft.deliveryMode,...slot,...place});setDone(true);onDone?.();toast('订单已创建','success',t('请完成模拟支付'));navigate(`/checkout/${r.order.id}`);}
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <article className={done?'agent-draft is-done':'agent-draft'}>
    <header><strong>{group?t('合并配送 · {0} 件',{0:draft.parcels.length}):draft.parcels[0].packageSize==='LARGE'?t('大件'):t('小件')}</strong><b>{money(draft.amountFen)}</b></header>
    <dl>
      <div><dt>{t('取件站点')}</dt><dd>{t(draft.stationName)}</dd></div>
      <div><dt>{t('送到')}</dt><dd>{where(draft)}</dd></div>
      <div><dt>{t('时间')}</dt><dd>{when(draft)}</dd></div>
      <div><dt>{t('包裹')}</dt><dd>{draft.parcels.map(p=>`${t(sizeLabel(p.packageSize))}${p.carrier?` · ${t(p.carrier)}`:''}`).join('，')}</dd></div>
    </dl>
    {error&&<p role="alert" className="field-error">{error}</p>}
    <div className="actions">{done?<span className="muted">{t('已创建')}</span>:<><button type="button" className={busy?'is-busy':undefined} disabled={busy} onClick={()=>void confirm()}>{busy?t('正在创建…'):t('确认下单')}</button>
      <Link className="button secondary" to={group?'/parcel/merge':`/parcel/${draft.parcelIds[0]}`} state={{deliveryMode:draft.deliveryMode}} onClick={onDone}>{t('修改')}</Link></>}</div>
  </article>;
}

export function AgentDrafts({drafts,steps,onDone}:{drafts:AgentDraft[];steps:AgentStep[];onDone?:()=>void}){
  return <div className="agent-drafts">{drafts.map(d=><AgentDraftCard key={d.parcelIds.join(',')} draft={d} onDone={onDone}/>)}<AgentSteps steps={steps}/></div>;
}

const EXAMPLES=['晚上送寝室','明天中午送楼下','尽快送，放图书馆门口'];
/** 一句话下单: one sentence → drafts. `parcelIds` limits the plan to those parcels (e.g. the one just saved). */
export function OneSentenceOrder({parcelIds,title}:{parcelIds?:string[];title?:string}){
  const [text,setText]=useState(''),[busy,setBusy]=useState(false),[plan,setPlan]=useState<AgentPlan|null>(null),[error,setError]=useState('');
  async function submit(e?:FormEvent,value=text){
    e?.preventDefault();const q=value.trim();if(!q||busy)return;
    setBusy(true);setError('');setPlan(null);
    try{const r=await api<{plan:AgentPlan}>('/agent/plan','POST',{message:q,...(parcelIds?.length?{parcelIds}:{})});setPlan(r.plan);}
    catch(err){setError((err as Error).message);}finally{setBusy(false);}
  }
  return <section className="one-sentence panel" aria-labelledby="one-sentence-title">
    <h2 id="one-sentence-title"><SymbolIcon name="chat"/>{title??t('一句话下单')}</h2>
    <p className="muted">{t('说清楚怎么送、什么时候送，智能体会查包裹、查时段、算好价钱，生成订单等你确认。')}</p>
    <form onSubmit={submit}><label className="sr-only" htmlFor="one-sentence-input">{t('一句话下单')}</label>
      <input id="one-sentence-input" value={text} maxLength={AGENT_MAX_CHARS} onChange={e=>setText(e.target.value)} placeholder={t('例如：把南十的两件合并，晚上送寝室')} autoComplete="off"/>
      <button className={busy?'is-busy':undefined} disabled={busy||!text.trim()}>{busy?t('正在安排…'):t('安排')}</button></form>
    <div className="assistant-chips">{EXAMPLES.map(x=><button key={x} type="button" className="chip" disabled={busy} onClick={()=>{setText(t(x));void submit(undefined,x);}}>{t(x)}</button>)}</div>
    {error&&<p role="alert" className="field-error">{error}</p>}
    {plan&&<div className="one-sentence-result" aria-live="polite"><p>{plan.answer}</p><AgentDrafts drafts={plan.drafts} steps={plan.steps}/>
      <small className="assistant-source">{plan.source==='MODEL'?t('由大模型 {0} 调用工具规划，仅供参考，请核对后确认',{0:plan.model??''}):t('本站未配置大模型或大模型暂不可用，以上由规则解析生成，请核对后确认')}</small></div>}
  </section>;
}
