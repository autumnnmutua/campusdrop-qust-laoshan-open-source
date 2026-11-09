/* © 2026 专业团队 · CampusDrop v4.5.0 */
import './zod-config';
import {useEffect,useState,type FormEvent} from 'react';
import {AdminShell} from './admin-delivery';
import {LoadingState,EmptyState} from './components';
import {api} from './api';
import {toast} from './effects';
import {money,useResource} from './student-delivery';
import {
  LEDGER_LABELS,PAYOUT_METHOD_LABELS,PLATFORM_FEE_FEN,WITHDRAW_MAX_FEN,WITHDRAW_MIN_FEN,WITHDRAW_STATUS_LABELS,
  payoutAccountSchema,withdrawSchema,type PayoutMethod,type Wallet,type Withdrawal,
} from '../shared/wallet';

/*
 * v3.9 · 我的钱包 (every admin; couriers mostly) and 提现审核 (super admins). Simulated money: the balance comes from
 * delivered parcels (fee minus the platform's 0.20 元), sends and tips; withdrawals go to a saved WeChat, Alipay or
 * bank account after a super admin approves them. Only masked account details are stored.
 */
const when=(t:number)=>new Date(t*1000).toLocaleString('zh-CN',{hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const yuanToFen=(v:string)=>Math.round(Number(v)*100);

function AccountForm({onSaved}:{onSaved:(w:Wallet)=>void}){
  const [method,setMethod]=useState<PayoutMethod>('WECHAT'),[accountName,setName]=useState(''),[account,setAccount]=useState(''),[bankName,setBank]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function save(e:FormEvent){
    e.preventDefault();setMessage('');
    const parsed=payoutAccountSchema.safeParse({method,accountName,account,...(method==='BANK'?{bankName}:{})});
    if(!parsed.success){setMessage(parsed.error.issues[0]?.message??'请检查填写内容');return;}
    setBusy(true);
    try{const r=await api<{wallet:Wallet}>('/admin/wallet/accounts','POST',parsed.data);onSaved(r.wallet);setAccount('');setBank('');toast('收款账户已保存','success','只保存脱敏后的账号');}
    catch(err){setMessage((err as Error).message);}finally{setBusy(false);}
  }
  return <form className="wallet-account-form" onSubmit={save}>
    <div className="segmented" role="radiogroup" aria-label="收款方式">{(['WECHAT','ALIPAY','BANK'] as PayoutMethod[]).map(m=><button key={m} type="button" role="radio" aria-checked={method===m} onClick={()=>setMethod(m)}>{PAYOUT_METHOD_LABELS[m]}</button>)}</div>
    <div className="form-grid">
      <label>收款人姓名<input value={accountName} onChange={e=>setName(e.target.value)} maxLength={20} required autoComplete="name"/></label>
      <label>{method==='BANK'?'银行卡号':method==='WECHAT'?'微信号或绑定手机号':'支付宝账号（手机号或邮箱）'}<input value={account} onChange={e=>setAccount(e.target.value)} maxLength={40} required inputMode={method==='BANK'?'numeric':'text'} autoComplete="off"/></label>
      {method==='BANK'&&<label>开户银行<input value={bankName} onChange={e=>setBank(e.target.value)} maxLength={20} required placeholder="例如：中国银行青岛崂山支行"/></label>}
    </div>
    <p className="muted small">模拟交易：账号只保存脱敏结果（如 6222 **** **** 1234），不会发送给任何真实支付机构。</p>
    <button className="secondary" disabled={busy}>{busy?'正在保存…':'添加收款账户'}</button>
    <p role="alert" className="field-error">{message}</p>
  </form>;
}

export function AdminWallet(){
  const res=useResource<{wallet:Wallet}>('/admin/wallet');
  const [w,setW]=useState<Wallet|null>(null);
  useEffect(()=>{if(res.data)setW(res.data.wallet);},[res.data]);
  const [accountId,setAccountId]=useState(''),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{if(w&&!w.accounts.some(a=>a.id===accountId))setAccountId(w.accounts[0]?.id??'');},[w,accountId]);
  async function withdraw(e:FormEvent){
    e.preventDefault();setMessage('');
    const parsed=withdrawSchema.safeParse({accountId,amountFen:yuanToFen(amount)});
    if(!parsed.success){setMessage(parsed.error.issues[0]?.message??'请检查金额');return;}
    if(w&&parsed.data.amountFen>w.balanceFen){setMessage('超过可提现余额');return;}
    setBusy(true);
    try{const r=await api<{wallet:Wallet;message:string}>('/admin/wallet/withdrawals','POST',parsed.data);setW(r.wallet);setAmount('');toast('提现申请已提交','success',r.message);}
    catch(err){setMessage((err as Error).message);}finally{setBusy(false);}
  }
  async function remove(id:string){try{const r=await api<{wallet:Wallet}>(`/admin/wallet/accounts/${id}`,'DELETE');setW(r.wallet);toast('已删除收款账户','info');}catch(err){toast((err as Error).message,'warn');}}
  return <AdminShell><h1>我的钱包</h1>
    <p className="muted">每送达一件（配送或代寄件）平台抽成 {money(PLATFORM_FEE_FEN)}，其余配送费按原价计入；学生的打赏全额计入。学生签收（确认收货或核验收货码）后入账。<strong>全部为模拟交易，不产生真实收入或转账。</strong></p>
    <p role="alert">{res.error}</p>{res.loading&&!w&&<LoadingState/>}
    {w&&<>
      <div className="kpi-grid wallet-kpis">
        <div className="kpi wallet-balance"><small>可提现余额</small><strong>{money(w.balanceFen)}</strong><span>{w.pendingFen?`另有 ${money(w.pendingFen)} 审核中`:'随时可以申请提现'}</span></div>
        <div className="kpi"><small>累计收入</small><strong>{money(w.earnedFen)}</strong><span>{w.parcels} 件 · 含打赏 {money(w.tipsFen)}</span></div>
        <div className="kpi"><small>平台抽成</small><strong>{money(w.feeFen)}</strong><span>每件 {money(PLATFORM_FEE_FEN)}</span></div>
        <div className="kpi"><small>已提现</small><strong>{money(w.withdrawnFen)}</strong><span>累计到账（模拟）</span></div>
      </div>
      <div className="chart-row wallet-row">
        <section className="panel wallet-withdraw" aria-labelledby="wd-title"><h2 id="wd-title">申请提现</h2>
          {w.accounts.length?<form onSubmit={withdraw}>
            <fieldset className="wallet-accounts"><legend>到账账户</legend>{w.accounts.map(a=><label key={a.id} className={accountId===a.id?'wallet-account is-on':'wallet-account'}>
              <input type="radio" name="wd-account" checked={accountId===a.id} onChange={()=>setAccountId(a.id)}/>
              <span><strong>{a.method==='BANK'?a.bankName:PAYOUT_METHOD_LABELS[a.method]}</strong><small>{a.accountMasked} · {a.accountName}</small></span>
              <button type="button" className="text-button" onClick={()=>void remove(a.id)}>删除</button></label>)}</fieldset>
            <label>提现金额（元）<div className="wallet-amount"><input type="number" min={WITHDRAW_MIN_FEN/100} max={Math.min(WITHDRAW_MAX_FEN,w.balanceFen)/100} step={0.01} value={amount} onChange={e=>setAmount(e.target.value)} required/><button type="button" className="text-button" disabled={w.balanceFen<WITHDRAW_MIN_FEN} onClick={()=>setAmount((Math.min(w.balanceFen,WITHDRAW_MAX_FEN)/100).toFixed(2))}>全部提现</button></div></label>
            <p className="muted small">单次 1–5000 元，最多 3 笔同时审核；超级管理员审核通过后到账（模拟）。</p>
            <button disabled={busy||w.balanceFen<WITHDRAW_MIN_FEN}>{busy?'正在提交…':'申请提现'}</button>
            <p role="alert" className="field-error">{message}</p>
          </form>:<p className="muted">先在右侧添加一个收款账户（微信、支付宝或银行卡）。</p>}
        </section>
        <section className="panel" aria-labelledby="acc-title"><h2 id="acc-title">收款账户</h2><AccountForm onSaved={setW}/></section>
      </div>
      <section className="panel" aria-labelledby="wl-title"><h2 id="wl-title">提现记录</h2>
        {w.withdrawals.length?<ul className="wallet-list">{w.withdrawals.map(x=><li key={x.id}><span><strong>{money(x.amountFen)}</strong><small>{x.accountLabel} · {when(x.createdAt)}</small>{x.note&&<small className="muted">说明：{x.note}</small>}</span><em className={`wd-status is-${x.status.toLowerCase()}`}>{WITHDRAW_STATUS_LABELS[x.status]}</em></li>)}</ul>:<p className="muted">还没有提现记录。</p>}
      </section>
      <section className="panel" aria-labelledby="led-title"><h2 id="led-title">收支明细</h2>
        {w.entries.length?<div className="table-scroll" tabIndex={0} role="region" aria-label="收支明细（可左右滚动）"><table className="staff-table"><thead><tr><th scope="col">时间</th><th scope="col">类型</th><th scope="col">配送费 / 金额</th><th scope="col">平台抽成</th><th scope="col">入账</th></tr></thead>
          <tbody>{w.entries.map(x=><tr key={x.id}><td>{when(x.createdAt)}</td><td>{LEDGER_LABELS[x.kind]}</td><td>{money(x.grossFen)}</td><td>{x.feeFen?`-${money(x.feeFen)}`:'—'}</td><td className={x.amountFen<0?'is-debit':'is-credit'}>{x.amountFen<0?'-':'+'}{money(Math.abs(x.amountFen))}</td></tr>)}</tbody></table></div>
          :<EmptyState title="还没有收支记录" icon="wallet"><p>接单并送达后，学生签收即入账。</p></EmptyState>}
      </section>
    </>}
  </AdminShell>;
}

export function AdminWithdrawals(){
  const [all,setAll]=useState(false);
  const res=useResource<{withdrawals:Withdrawal[];summary:{platformFeeFen:number;parcels:number;courierBalancesFen:number;pendingFen:number;paidFen:number}}>(`/admin/withdrawals${all?'?status=ALL':''}`);
  const me=useResource<{admin:{demo?:boolean}}>('/admin/me');
  const [notes,setNotes]=useState<Record<string,string>>({}),[busy,setBusy]=useState('');
  async function review(x:Withdrawal,action:'PAY'|'REJECT'){
    setBusy(x.id);
    try{const r=await api<{paidRef:string|null}>(`/admin/withdrawals/${x.id}/review`,'POST',{action,note:notes[x.id]??''});toast(action==='PAY'?'已确认打款（模拟）':'已退回','success',r.paidRef?`流水号 ${r.paidRef}`:undefined);await res.refresh();}
    catch(err){toast((err as Error).message,'warn');}finally{setBusy('');}
  }
  const s=res.data?.summary;
  return <AdminShell><div className="row"><div><h1>提现审核</h1></div><div className="range-chips" role="group" aria-label="显示范围"><button type="button" className="chip" aria-pressed={!all} onClick={()=>setAll(false)}>待审核</button><button type="button" className="chip" aria-pressed={all} onClick={()=>setAll(true)}>全部</button></div></div>
    <p className="muted">配送员申请提现后在这里确认打款或退回；退回的金额回到配送员余额。{me.data?.admin.demo?'一键体验中只处理本次体验的配送员。':''}<strong>模拟交易，不会产生真实转账。</strong></p>
    <p role="alert">{res.error}</p>{res.loading&&!res.data&&<LoadingState/>}
    {s&&<div className="kpi-grid wallet-kpis">
      <div className="kpi"><small>平台抽成累计</small><strong>{money(s.platformFeeFen)}</strong><span>{s.parcels} 件 × {money(PLATFORM_FEE_FEN)}</span></div>
      <div className="kpi"><small>配送员余额合计</small><strong>{money(s.courierBalancesFen)}</strong><span>尚未提现</span></div>
      <div className="kpi"><small>待审核</small><strong>{money(s.pendingFen)}</strong><span>提交后已从余额扣除</span></div>
      <div className="kpi"><small>已打款（模拟）</small><strong>{money(s.paidFen)}</strong><span>累计</span></div>
    </div>}
    {res.data&&(res.data.withdrawals.length?<ul className="card-list wallet-review">{res.data.withdrawals.map(x=><li key={x.id} className="parcel-card">
      <div className="row"><strong>{x.username} · {money(x.amountFen)}</strong><em className={`wd-status is-${x.status.toLowerCase()}`}>{WITHDRAW_STATUS_LABELS[x.status]}</em></div>
      <p className="muted small">{x.accountLabel} · 申请于 {when(x.createdAt)}{x.reviewedAt?` · 处理于 ${when(x.reviewedAt)}`:''}{x.paidRef?` · 流水号 ${x.paidRef}`:''}</p>
      {x.note&&<p className="small">说明：{x.note}</p>}
      {x.status==='PENDING'&&<div className="actions"><input aria-label={`退回原因（${x.username}）`} placeholder="退回时填写原因" value={notes[x.id]??''} maxLength={120} onChange={e=>setNotes({...notes,[x.id]:e.target.value})}/>
        <button disabled={busy===x.id} onClick={()=>void review(x,'PAY')}>确认打款（模拟）</button><button className="secondary" disabled={busy===x.id} onClick={()=>void review(x,'REJECT')}>退回</button></div>}
    </li>)}</ul>:<EmptyState title={all?'还没有提现记录':'没有待审核的提现'} icon="wallet"/>)}
  </AdminShell>;
}
