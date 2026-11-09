/* © 2026 专业团队 · CampusDrop v4.5.0 */
import {locale,t} from './i18n';
import {useEffect,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {api} from './api';
import {toast} from './effects';
import {LoadingState} from './components';
import {SymbolIcon} from './campus-design';
import {copyText} from './wechat';
import {SignInPrompt,useStudentResource} from './student-delivery';
import type {Building} from '../shared/contracts';
import {APPLICATION_STATUS_LABELS,APPLY_SLOTS,APPLY_SLOT_LABELS,type CourierApplication} from '../shared/courier-apply';

/*
 * v4.5 · 申请当兼职配送员 (short link: /apply). One open application at a time. After sending it, the page follows the
 * application like a 售后工单: submitted → under review → approved / not approved / withdrawn, each step with its time,
 * and every step also arrives in the inbox. Earlier applications are listed underneath. The password chosen here becomes
 * the courier workspace password once approved (only a hash is stored).
 */
const RULES=['送达楼下时需拍照留证，再标记送达；当面交付核对 4 位收货码。','取件后不能直接退单，需先把包裹归还站点并由另一位管理员核验。','配送费中平台每件收 0.20 元，其余进入你的钱包，可申请提现（当前为模拟流程）。','负责楼栋的小件付款后会直接派给你，有事送不了可以退回接单市场。'];
type Profile={name:string;phone:string;buildingCode:string;zone:string;roomNo:string};
const when=(s:number|null)=>s?new Date(s*1000).toLocaleString(locale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';

/** The progress of one application, drawn like the order timeline: done steps filled, the current one ringed. */
function ApplyProgress({app}:{app:CourierApplication}){
  const done=app.status!=='PENDING';
  const result=app.status==='APPROVED'?{title:t('审核通过'),text:t('配送员账号 {0} 已开通，用申请时设置的密码登录配送员工作台。',{0:app.desiredUsername})}
    :app.status==='REJECTED'?{title:t('未通过'),text:t('原因：{0}',{0:app.note||t('未说明')})}
    :app.status==='WITHDRAWN'?{title:t('已撤回'),text:t('你撤回了这份申请，可以随时重新申请。')}
    :{title:t('审核结果'),text:t('通过后会开通配送员账号并分配负责的楼栋。')};
  const steps=[
    {title:t('提交申请'),text:t('账号 {0} · {1}',{0:app.desiredUsername,1:app.buildingName?`${t(app.buildingName)}${app.roomNo?` ${app.roomNo}`:''}`:t('未填楼栋')}),at:app.createdAt,state:'done'},
    {title:t('运营审核'),text:done?t('已处理'):t('运营负责人正在审核，有结果会发站内消息。'),at:done?app.reviewedAt:null,state:done?'done':'current'},
    {title:result.title,text:result.text,at:done?app.reviewedAt:null,state:done?(app.status==='APPROVED'?'done':'stopped'):'todo'},
  ];
  return <ol className="apply-progress">{steps.map((s,i)=><li key={i} className={`is-${s.state}`}><span className="apply-dot" aria-hidden="true"/><div><strong>{s.title}</strong>{s.at?<time>{when(s.at)}</time>:null}<p>{s.text}</p></div></li>)}</ol>;
}

export function CourierApply(){
  const r=useStudentResource<{application:CourierApplication|null;applications?:CourierApplication[];profile:Profile}>('/courier-applications/mine');
  const [buildings,setBuildings]=useState<Building[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[slots,setSlots]=useState<string[]>([]),[again,setAgain]=useState(false),[zone,setZone]=useState('');
  useEffect(()=>{api<{buildings:Building[]}>('/dorm-buildings').then(x=>setBuildings(x.buildings)).catch(()=>{});},[]);
  useEffect(()=>{if(r.data?.profile.zone)setZone(z=>z||r.data!.profile.zone);},[r.data]);
  const app=r.data?.application, open=app?.status==='PENDING', history=(r.data?.applications??[]).slice(1);
  const link=typeof location!=='undefined'?`${location.origin}/apply`:'/apply';
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setError('');const f=new FormData(e.currentTarget);
    if(f.get('password')!==f.get('password2')){setError(t('两次输入的密码不一致'));return;}
    setBusy(true);
    try{await api('/courier-applications/mine','POST',{realName:f.get('realName'),phone:f.get('phone'),college:f.get('college')||'',grade:f.get('grade')||'',slots,zone:f.get('zone')||null,
        buildingCode:f.get('buildingCode'),roomNo:String(f.get('roomNo')??'').trim(),intro:f.get('intro')||'',desiredUsername:String(f.get('desiredUsername')??'').trim().toLowerCase(),password:f.get('password'),agree:f.get('agree')==='on'});
      toast(t('申请已提交'),'success',t('可以在这一页查看审核进度'));setAgain(false);await r.refresh();window.scrollTo({top:0});}
    catch(err){setError((err as Error).message);}finally{setBusy(false);}
  }
  async function withdraw(){setBusy(true);try{await api('/courier-applications/mine/withdraw','POST',{});toast(t('申请已撤回'),'info');await r.refresh();}catch(err){toast((err as Error).message,'warn');}finally{setBusy(false);}}
  async function share(){toast(await copyText(link)?t('申请链接已复制'):t('复制失败，请手动复制'),'info',link);}
  if(r.unauthorized)return <section className="courier-apply"><h1>{t('申请当兼职配送员')}</h1><SignInPrompt title={t('登录后申请')} text={t('用学生账号登录后填写申请，之后可以在这一页查看审核进度。')}/></section>;
  const p=r.data?.profile;
  return <section className="courier-apply"><Link className="back-link" to="/guide">{t('← 配送说明')}</Link><h1>{t('申请当兼职配送员')}</h1>
    <p className="muted">{t('利用课余时间帮同学把包裹从驿站送到楼下或寝室。运营负责人审核通过后，会用你填写的账号开通配送员工作台，并分配你附近的楼栋。')}</p>
    <p className="apply-link"><SymbolIcon name="send"/><span>{t('申请入口')}<b>{link.replace(/^https?:\/\//,'')}</b></span><button type="button" className="text-button" onClick={()=>void share()}>{t('复制链接')}</button></p>
    <p role="alert">{r.error}</p>{r.loading&&!r.data&&<LoadingState/>}
    {app&&!again&&<article className={`apply-card is-${app.status.toLowerCase()}`} aria-labelledby="apply-status">
      <header><h2 id="apply-status">{t('我的申请')}</h2><span className={`badge app-${app.status.toLowerCase()}`}>{t(APPLICATION_STATUS_LABELS[app.status])}</span></header>
      <ApplyProgress app={app}/>
      <div className="actions">{open&&<button type="button" className="secondary" disabled={busy} onClick={()=>void withdraw()}>{t('撤回申请')}</button>}{app.status==='APPROVED'&&<Link className="button" to="/admin/login">{t('登录配送员工作台')}</Link>}{(app.status==='REJECTED'||app.status==='WITHDRAWN')&&<button type="button" onClick={()=>setAgain(true)}>{t('重新申请')}</button>}<Link className="text-button" to="/messages">{t('查看站内消息')}</Link></div>
    </article>}
    {p&&(!app||again)&&<form className="apply-form" onSubmit={submit}>
      <fieldset><legend>{t('你的信息')}</legend>
        <label>{t('真实姓名')}<input name="realName" required maxLength={20} defaultValue={p.name} autoComplete="name"/></label>
        <label>{t('手机号（配送时同学联系你用）')}<input name="phone" required inputMode="numeric" pattern="1[3-9][0-9]{9}" maxLength={11} defaultValue={p.phone} autoComplete="tel"/></label>
        <div className="form-row"><label>{t('住的楼栋')}<select name="buildingCode" required defaultValue={p.buildingCode} onChange={e=>{const b=buildings.find(x=>x.code===e.target.value);if(b)setZone(b.zone);}}><option value="" disabled>{t('请选择')}</option>{(['SOUTH','NORTH'] as const).map(z=><optgroup key={z} label={z==='SOUTH'?t('南苑'):t('北苑')}>{buildings.filter(b=>b.zone===z).map(b=><option key={b.code} value={b.code}>{t(b.displayName)}</option>)}</optgroup>)}</select></label>
          <label>{t('房间号（选填）')}<input name="roomNo" maxLength={32} defaultValue={p.roomNo} placeholder={t('例如：302')}/></label></div>
        <div className="form-row"><label>{t('学院（选填）')}<input name="college" maxLength={40}/></label><label>{t('年级（选填）')}<input name="grade" maxLength={20} placeholder={t('例如：2024 级')}/></label></div>
      </fieldset>
      <fieldset><legend>{t('空闲时段（可多选）')}</legend><div className="chip-row">{APPLY_SLOTS.map(s=><label key={s} className={slots.includes(s)?'chip is-on':'chip'}><input type="checkbox" className="sr-only" checked={slots.includes(s)} onChange={e=>setSlots(e.target.checked?[...slots,s]:slots.filter(x=>x!==s))}/>{t(APPLY_SLOT_LABELS[s])}</label>)}</div>
        <label>{t('更想送哪边（选填）')}<select name="zone" value={zone} onChange={e=>setZone(e.target.value)}><option value="">{t('都可以')}</option><option value="SOUTH">{t('南苑')}</option><option value="NORTH">{t('北苑')}</option></select></label>
        <label>{t('简单介绍（选填）')}<textarea name="intro" maxLength={200} rows={3} placeholder={t('例如：下午没课，有电动车')}/></label></fieldset>
      <fieldset><legend>{t('配送员账号')}</legend>
        <label>{t('账号名（3–32 位小写字母、数字或下划线）')}<input name="desiredUsername" required pattern="[a-zA-Z0-9_]{3,32}" maxLength={32} autoComplete="username" autoCapitalize="none"/></label>
        <div className="form-row"><label>{t('密码（至少 12 位）')}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><label>{t('再输一次')}<input name="password2" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label></div>
        <p className="muted small">{t('密码只以加密形式保存，审核通过后用它登录配送员工作台；和学生账号分开。')}</p></fieldset>
      <details className="apply-rules"><summary>{t('配送员须知')}</summary><ul>{RULES.map(x=><li key={x}>{t(x)}</li>)}</ul></details>
      <label className="check"><input type="checkbox" name="agree" required/>{t('我已阅读并同意配送员须知')}</label>
      <p role="alert">{error}</p>
      <div className="actions"><button disabled={busy||!slots.length}>{busy?t('正在提交…'):t('提交申请')}</button>{again&&<button type="button" className="text-button" onClick={()=>setAgain(false)}>{t('取消')}</button>}</div>
    </form>}
    {history.length>0&&<section className="apply-history" aria-labelledby="apply-history"><h2 id="apply-history">{t('以前的申请')}</h2>
      <ul>{history.map(h=><li key={h.id}><span>{when(h.createdAt)}</span><span>{t('账号 {0}',{0:h.desiredUsername})}</span><span className={`badge app-${h.status.toLowerCase()}`}>{t(APPLICATION_STATUS_LABELS[h.status])}</span>{h.status==='REJECTED'&&h.note?<small>{t('原因：{0}',{0:h.note})}</small>:null}</li>)}</ul></section>}
  </section>;
}
