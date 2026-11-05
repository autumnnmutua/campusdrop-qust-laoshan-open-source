import {useEffect,useId,useState,type FormEvent} from 'react';
import {api} from './api';
import {locale,t} from './i18n';
import {money} from './format';
import {SymbolIcon} from './campus-design';
import {couponSummaryEn,type CouponOption,type CouponQuote,type CouponRule} from '../shared/coupons';
const summaryOf=(o:{summary:string;rule?:CouponRule})=>locale()==='en-GB'&&o.rule?couponSummaryEn(o.rule):o.summary;

/*
 * v3.7.1 · coupons at checkout. On load the page asks for the options and preselects the cheapest one it may use
 * without a code (personal coupons, coupons applied automatically); a typed code (any case) is checked by the server
 * and chosen when it is the better deal. The server recomputes everything at payment.
 */
export interface CouponChoice {couponId:string;code?:string;discountFen:number;name:string}
export function CouponPicker({orderId,groupId,amountFen,onChange}:{orderId?:string;groupId?:string;amountFen:number;onChange:(c:CouponChoice|null)=>void}){
  const id=useId(),[quote,setQuote]=useState<CouponQuote|null>(null),[picked,setPicked]=useState<string|null>(null),[code,setCode]=useState(''),[typed,setTyped]=useState<string|undefined>(),[msg,setMsg]=useState<{ok:boolean;text:string}|null>(null),[busy,setBusy]=useState(false);
  const target=orderId?`orderId=${orderId}`:`groupId=${groupId}`;
  useEffect(()=>{let on=true;api<{quote:CouponQuote}>(`/coupons/quote?${target}`).then(r=>{if(!on)return;setQuote(r.quote);setPicked(r.quote.best);}).catch(()=>{});return()=>{on=false;};},[target,amountFen]);
  const usable=(quote?.options??[]).filter(o=>o.discountFen>0&&(o.source!=='CODE'||o.code===typed));
  const chosen=usable.find(o=>o.id===picked)??null;
  useEffect(()=>{onChange(chosen?{couponId:chosen.id,code:chosen.source==='CODE'?typed:undefined,discountFen:chosen.discountFen,name:chosen.name}:null);},[chosen?.id,chosen?.discountFen,typed]);
  async function apply(e:FormEvent){
    e.preventDefault();const c=code.trim();if(!c||busy)return;setBusy(true);setMsg(null);
    try{const r=await api<{quote:CouponQuote}>(`/coupons/quote?${target}&code=${encodeURIComponent(c)}`);setQuote(r.quote);
      if(r.quote.code?.ok){
        const opt=r.quote.options.find(o=>o.id===r.quote.code!.id),best=r.quote.options.find(o=>o.id===r.quote.best);
        setTyped(opt?.code??c.toUpperCase());setPicked(r.quote.best);
        // Keep the cheapest: a typed code is chosen only when it saves at least as much as the best coupon already held.
        setMsg({ok:true,text:r.quote.best===opt?.id?t('优惠码可用：{0}',{0:opt?summaryOf(opt):''}):t('优惠码可用（{0}），但“{1}”更省钱，已为你保留；想用优惠码可以在上面切换。',{0:opt?.summary??'',1:best?.name??''})});
      }
      else setMsg({ok:false,text:t(r.quote.code?.message??'优惠码不可用')});
    }catch(err){setMsg({ok:false,text:(err as Error).message});}finally{setBusy(false);}
  }
  const blocked=(quote?.options??[]).filter(o=>!o.discountFen&&o.source!=='CODE');
  return <section className="coupon-picker" aria-labelledby={`${id}-t`}>
    <h2 id={`${id}-t`}><SymbolIcon name="coupon"/>{t('优惠券')}</h2>
    {!quote?<p className="muted">{t('正在查找可用的优惠券…')}</p>:<>
      {usable.length?<div className="coupon-list" role="radiogroup" aria-label={t('选择优惠券')}>
        {usable.map(o=><div key={o.id}><label className={picked===o.id?'coupon-option is-on':'coupon-option'}><input type="radio" name={`${id}-c`} checked={picked===o.id} onChange={()=>setPicked(o.id)}/>
          <span><strong>{o.name}</strong><small>{summaryOf(o)}{o.expiresAt?t(' · {0} 到期',{0:new Date(o.expiresAt*1000).toLocaleDateString()}):''}</small></span><b>-{money(o.discountFen)}</b></label></div>)}
        <div><label className={picked===null?'coupon-option is-on':'coupon-option'}><input type="radio" name={`${id}-c`} checked={picked===null} onChange={()=>setPicked(null)}/><span><strong>{t('不使用优惠券')}</strong></span></label></div>
      </div>:<p className="muted">{t('暂无可自动使用的优惠券，可以输入优惠码。')}</p>}
      {quote.best&&picked===quote.best&&<p className="coupon-best"><SymbolIcon name="coupon"/>{t('已自动选择最省钱的一张')}</p>}
      {blocked.length>0&&<details className="coupon-blocked"><summary>{t('还有 {0} 张暂时不能用',{0:blocked.length})}</summary><ul>{blocked.map(o=><li key={o.id}>{o.name}<small>{t(o.reason??'')}</small></li>)}</ul></details>}
      <form className="coupon-code" onSubmit={apply}><label htmlFor={`${id}-code`}>{t('优惠码')}</label><div><input id={`${id}-code`} value={code} onChange={e=>setCode(e.target.value)} maxLength={40} autoComplete="off" autoCapitalize="characters" placeholder={t('不区分大小写，例如 qust')}/><button type="submit" className="secondary" disabled={busy||!code.trim()}>{busy?t('正在核对…'):t('使用')}</button></div>
        {msg&&<p role={msg.ok?'status':'alert'} className={msg.ok?'success small':'field-error'}>{msg.text}</p>}</form>
    </>}
  </section>;
}

/** The price lines under the picker: full price, coupon, what is paid. */
export function CouponTotal({amountFen,choice}:{amountFen:number;choice:CouponChoice|null}){
  if(!choice)return null;
  return <dl className="coupon-total"><div><dt>{t('配送费')}</dt><dd>{money(amountFen)}</dd></div><div><dt>{choice.name}</dt><dd>-{money(choice.discountFen)}</dd></div><div className="is-pay"><dt>{t('实付')}</dt><dd>{money(amountFen-choice.discountFen)}</dd></div></dl>;
}

/** “我的优惠券” on the profile page. */
export function CouponWallet(){
  const [list,setList]=useState<{id:string;name:string;summary:string;rule?:CouponRule;expiresAt:number|null;state:'AVAILABLE'|'USED'|'EXPIRED'}[]|null>(null);
  useEffect(()=>{let on=true;api<{coupons:NonNullable<typeof list>}>('/coupons').then(r=>{if(on)setList(r.coupons);}).catch(()=>{if(on)setList([]);});return()=>{on=false;};},[]);
  if(!list)return null;
  const label={AVAILABLE:t('可用'),USED:t('已使用'),EXPIRED:t('已过期')};
  return <section className="coupon-wallet panel" aria-labelledby="wallet-title"><h2 id="wallet-title"><SymbolIcon name="coupon"/>{t('我的优惠券')}</h2>
    {list.length?<ul>{list.map(c=><li key={c.id} className={`is-${c.state.toLowerCase()}`}><span><strong>{c.name}</strong><small>{summaryOf(c)}{c.expiresAt?t(' · {0} 到期',{0:new Date(c.expiresAt*1000).toLocaleDateString()}):''}</small></span><em>{label[c.state]}</em></li>)}</ul>
      :<p className="muted">{t('暂时没有优惠券。付款时也可以输入优惠码。')}</p>}
    <p className="muted small">{t('付款时会自动选用最省钱的优惠券；每张券每个账号只能用一次，订单取消退款后会退回。')}</p></section>;
}
// Re-exported for pages that only need the option type.
export type {CouponOption};
