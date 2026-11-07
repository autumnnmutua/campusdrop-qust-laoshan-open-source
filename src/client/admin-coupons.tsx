/* © 2026 专业团队 · CampusDrop v4.0.0 */
import './zod-config';
import {useEffect,useState,type FormEvent} from 'react';
import {AdminShell} from './admin-delivery';
import {LoadingState} from './components';
import {api} from './api';
import {toast} from './effects';
import {useResource} from './student-delivery';
import {money} from './format';
import {couponCreateSchema,couponSummary,normalizeCode,type AdminCoupon,type CouponKind,type CouponUsage,type DiscountType} from '../shared/coupons';
import type {Admin} from '../shared/contracts';
import type {DemoStatus} from '../shared/demo';
import {bundleSettingSchema,sortedTiers,tierLabel,type BundleSetting} from '../shared/bundle';

/** v3.8 · 多件满减 tiers (super admin). The demo's super admin sees them read-only. */
function BundleSettings({demo}:{demo:boolean}){
  const res=useResource<{bundle:BundleSetting}>('/admin/settings/bundle');
  const [enabled,setEnabled]=useState(true),[rows,setRows]=useState<{min:string;off:string}[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{if(res.data){setEnabled(res.data.bundle.enabled);setRows(sortedTiers(res.data.bundle).map(t=>({min:String(t.minFen/100),off:String(t.offFen/100)})));}},[res.data]);
  const tiers=rows.map(r=>({minFen:yuanToFen(r.min),offFen:yuanToFen(r.off)}));
  async function save(e:FormEvent){
    e.preventDefault();setMessage('');
    const parsed=bundleSettingSchema.safeParse({enabled,tiers});
    if(!parsed.success){setMessage(parsed.error.issues[0]?.message??'请检查填写内容');return;}
    setBusy(true);
    try{await api('/admin/settings/bundle','PUT',parsed.data);toast('多件满减已保存','success',parsed.data.enabled?sortedTiers(parsed.data).map(tierLabel).join('、'):'已关闭');await res.refresh();}
    catch(err){setMessage((err as Error).message);}finally{setBusy(false);}
  }
  return <section className="panel bundle-admin" aria-labelledby="bundle-admin-title"><h2 id="bundle-admin-title">多件满减</h2>
    <p className="muted">一次支付 2 件及以上、合计达到门槛时自动减免（取最高一档），先减满减再用优惠券；减免由平台承担，配送员按原价结算。</p>
    {demo&&<p className="demo-readonly-note">一键体验中只能查看：满减档位是全站设置，修改会影响真实订单。</p>}
    {res.loading&&!res.data?<LoadingState/>:<form onSubmit={save}>
      <label className="check"><input type="checkbox" checked={enabled} disabled={demo} onChange={e=>setEnabled(e.target.checked)}/>开启多件满减</label>
      <div className="tier-rows">{rows.map((r,i)=><div className="tier-row" key={i}>
        <label>满（元）<input type="number" min={1} max={1000} step={0.01} value={r.min} disabled={demo} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,min:e.target.value}:x))} required/></label>
        <label>减（元）<input type="number" min={0.01} max={100} step={0.01} value={r.off} disabled={demo} onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,off:e.target.value}:x))} required/></label>
        {!demo&&<button type="button" className="text-button" onClick={()=>setRows(rows.filter((_,j)=>j!==i))}>删除这一档</button>}
      </div>)}</div>
      {!demo&&<div className="actions">{rows.length<5&&<button type="button" className="secondary" onClick={()=>setRows([...rows,{min:'',off:''}])}>添加一档</button>}<button disabled={busy}>{busy?'正在保存…':'保存满减设置'}</button></div>}
      <p role="alert" className="field-error">{message}</p>
    </form>}
  </section>;
}

/*
 * v3.7.1 · 优惠券管理（超级管理员）. Choose how the coupon is handed out — a code people type, a personal coupon for
 * named accounts, or one every new account receives — and how often it may be used: once per account, or once on
 * the whole site (first come, first served). Inside the one-click demo the coupons stay in the demo.
 */
const KIND_LABEL:Record<CouponKind,string>={CODE:'优惠码',PERSONAL:'专属券',NEW_USER:'新人券'};
const USAGE_LABEL:Record<CouponUsage,string>={PER_ACCOUNT:'每个账号限用一次',ONCE_TOTAL:'全站只能用一次'};
const yuanToFen=(v:string)=>Math.round(Number(v)*100);

export function AdminCoupons(){
  const list=useResource<{coupons:AdminCoupon[]}>('/admin/coupons'),me=useResource<{admin:Admin}>('/admin/me');
  const demo=Boolean(me.data?.admin.demo);
  const [demoStudent,setDemoStudent]=useState<string|null>(null);
  useEffect(()=>{if(demo)api<{status:DemoStatus}>('/demo/status').then(r=>setDemoStudent(r.status.studentUsername)).catch(()=>{});},[demo]);
  const [name,setName]=useState(''),[kind,setKind]=useState<CouponKind>('CODE'),[usage,setUsage]=useState<CouponUsage>('PER_ACCOUNT'),[code,setCode]=useState('');
  const [type,setType]=useState<DiscountType>('RATE'),[rate,setRate]=useState('8'),[off,setOff]=useState('1'),[minSpend,setMinSpend]=useState('0'),[maxOff,setMaxOff]=useState('');
  const [total,setTotal]=useState(''),[auto,setAuto]=useState(false),[days,setDays]=useState('30'),[endDate,setEndDate]=useState(''),[users,setUsers]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{if(kind==='NEW_USER')setUsage('PER_ACCOUNT');if(kind!=='CODE')setAuto(false);},[kind]);
  useEffect(()=>{if(kind==='PERSONAL'&&demoStudent&&!users)setUsers(demoStudent);},[kind,demoStudent,users]);
  const rateValue=Math.round(Number(rate)*10),preview=couponSummary({discountType:type,discountValue:type==='RATE'?rateValue:yuanToFen(off),minSpendFen:yuanToFen(minSpend||'0'),maxDiscountFen:type==='RATE'&&maxOff?yuanToFen(maxOff):null});
  async function create(e:FormEvent){
    e.preventDefault();setMessage('');
    const payload={name:name.trim(),kind,usage,...(kind==='CODE'?{code:normalizeCode(code),autoApply:auto}:{}),discountType:type,discountValue:type==='RATE'?rateValue:yuanToFen(off),
      minSpendFen:yuanToFen(minSpend||'0'),...(type==='RATE'&&maxOff?{maxDiscountFen:yuanToFen(maxOff)}:{}),...(usage==='PER_ACCOUNT'&&total?{totalLimit:Number(total)}:{}),
      ...(kind!=='CODE'&&days?{validDays:Number(days)}:{}),...(endDate?{endsAt:Math.floor(new Date(`${endDate}T23:59:59+08:00`).getTime()/1000)}:{}),
      ...(kind==='PERSONAL'?{usernames:users.split(/[\s,，、]+/).map(u=>u.trim()).filter(Boolean)}:{})};
    const parsed=couponCreateSchema.safeParse(payload);
    if(!parsed.success){setMessage(parsed.error.issues[0]?.message??'请检查填写内容');return;}
    setBusy(true);
    try{await api('/admin/coupons','POST',parsed.data);toast('优惠券已创建','success',kind==='CODE'?`优惠码 ${normalizeCode(code)}`:undefined);setName('');setCode('');await list.refresh();}
    catch(err){setMessage((err as Error).message);}finally{setBusy(false);}
  }
  async function toggle(c:AdminCoupon){
    try{await api(`/admin/coupons/${c.id}/status`,'PUT',{status:c.status==='ACTIVE'?'DISABLED':'ACTIVE'});toast(c.status==='ACTIVE'?'已停用':'已启用','info',c.name);await list.refresh();}
    catch(err){toast((err as Error).message,'warn');}
  }
  return <AdminShell><h1>优惠券与满减</h1>
    <p className="muted">优惠券只抵扣配送费，付款时学生可以输入优惠码，或由系统自动选用最省钱的一张；每张券每个账号只能用一次，订单取消退款后退回。{demo&&'（一键体验：这里新建的券只对本次体验的账号有效。）'}</p>
    <BundleSettings demo={demo}/>
    <section className="panel coupon-admin-form"><h2>新建优惠券</h2>
      <form onSubmit={create}>
        <label>名称<input value={name} onChange={e=>setName(e.target.value)} maxLength={40} required placeholder="例如：期末周配送券"/></label>
        <fieldset className="radio-row"><legend>发放方式</legend>
          {(['CODE','PERSONAL','NEW_USER'] as CouponKind[]).map(k=><label key={k} className="check"><input type="radio" name="kind" checked={kind===k} onChange={()=>setKind(k)}/>{k==='CODE'?'优惠码（学生输入使用）':k==='PERSONAL'?'专属券（发到指定账号）':'新人券（新注册账号自动获得）'}</label>)}
        </fieldset>
        <fieldset className="radio-row"><legend>使用规则</legend>
          <label className="check"><input type="radio" name="usage" checked={usage==='PER_ACCOUNT'} onChange={()=>setUsage('PER_ACCOUNT')}/>每个账号限用一次</label>
          <label className="check"><input type="radio" name="usage" checked={usage==='ONCE_TOTAL'} disabled={kind==='NEW_USER'} onChange={()=>setUsage('ONCE_TOTAL')}/>全站只能用一次（先到先得）</label>
        </fieldset>
        {kind==='CODE'&&<><label>优惠码<input value={code} onChange={e=>setCode(e.target.value)} maxLength={20} required autoCapitalize="characters" placeholder="3–20 位字母或数字，不区分大小写"/></label>
          <label className="check"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/>结算时自动匹配（所有学生不用输码也能用）</label></>}
        {kind==='PERSONAL'&&<label>学生用户名（多个用空格或逗号分隔，最多 100 个）<textarea value={users} onChange={e=>setUsers(e.target.value)} rows={2} placeholder="例如：zhangsan lisi"/>{demo&&demoStudent&&<small>体验同学的用户名是 {demoStudent}，已帮你填好。</small>}</label>}
        <fieldset className="radio-row"><legend>优惠方式</legend>
          <label className="check"><input type="radio" name="type" checked={type==='RATE'} onChange={()=>setType('RATE')}/>打折</label>
          <label className="check"><input type="radio" name="type" checked={type==='AMOUNT'} onChange={()=>setType('AMOUNT')}/>立减</label>
        </fieldset>
        <div className="form-grid">
          {type==='RATE'?<label>折扣（折）<input type="number" min={1} max={9.5} step={0.5} value={rate} onChange={e=>setRate(e.target.value)} required/></label>
            :<label>立减（元）<input type="number" min={0.01} max={50} step={0.01} value={off} onChange={e=>setOff(e.target.value)} required/></label>}
          <label>满多少元可用<input type="number" min={0} max={1000} step={0.01} value={minSpend} onChange={e=>setMinSpend(e.target.value)}/></label>
          {type==='RATE'&&<label>最多减（元，可空）<input type="number" min={0.01} max={1000} step={0.01} value={maxOff} onChange={e=>setMaxOff(e.target.value)}/></label>}
          {usage==='PER_ACCOUNT'&&kind!=='NEW_USER'&&<label>总共最多用几次（可空）<input type="number" min={1} step={1} value={total} onChange={e=>setTotal(e.target.value)}/></label>}
          {kind!=='CODE'&&<label>领到后几天内有效<input type="number" min={1} max={366} step={1} value={days} onChange={e=>setDays(e.target.value)}/></label>}
          <label>截止日期（可空）<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
        </div>
        <p className="coupon-preview">预览：<strong>{name||'（未命名）'}</strong> · {preview} · {KIND_LABEL[kind]} · {USAGE_LABEL[usage]}{kind==='CODE'&&code?` · ${normalizeCode(code)}`:''}</p>
        <button disabled={busy}>{busy?'正在创建…':'创建优惠券'}</button>
        <p role="alert" className="field-error">{message}</p>
      </form>
    </section>
    <h2>已有优惠券</h2>
    {list.loading&&!list.data&&<LoadingState/>}<p role="alert">{list.error}</p>
    <div className="card-list coupon-admin-list">{list.data?.coupons.map(c=><article key={c.id} className={c.status==='ACTIVE'?'parcel-card':'parcel-card is-disabled'}>
      <div className="row"><strong>{c.name}</strong>{c.code&&<code className="coupon-code-tag">{c.code}</code>}<span className="badge">{c.status==='ACTIVE'?'启用中':'已停用'}</span></div>
      <p>{c.summary}</p>
      <p className="muted small">{KIND_LABEL[c.kind]} · {USAGE_LABEL[c.usage]}{c.autoApply?' · 自动匹配':''}{c.totalLimit&&c.totalLimit>1?` · 总量 ${c.totalLimit}`:''} · 已使用 {c.used} 次{c.kind!=='CODE'?` · 已发放 ${c.granted} 张`:''}{c.validDays?` · 领到后 ${c.validDays} 天有效`:''}{c.endsAt?` · ${new Date(c.endsAt*1000).toLocaleDateString('zh-CN')} 截止`:''}{c.minSpendFen?` · 满 ${money(c.minSpendFen)}`:''}</p>
      {c.readonly?<p className="muted small">全站预置券：体验中可以使用，不能修改。</p>:<div className="actions"><button type="button" className="secondary" onClick={()=>void toggle(c)}>{c.status==='ACTIVE'?'停用':'重新启用'}</button></div>}
    </article>)}</div>
  </AdminShell>;
}
