/* © 2026 专业团队 · CampusDrop v4.5.0 */
import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {AdminShell} from './admin-delivery';
import {LoadingState,EmptyState} from './components';
import {api} from './api';
import {toast} from './effects';
import {useResource} from './student-delivery';
import type {DispatchOverview} from '../shared/dispatch';
import {APPLICATION_STATUS_LABELS,APPLY_SLOT_LABELS,type CourierApplication} from '../shared/courier-apply';

/*
 * v4.5 · 楼栋分配 (super admins): which courier delivers the 小件 of each building. A paid small order goes straight to
 * that courier; 大件、超大件 and buildings left empty go to the 接单市场. "自动分配" proposes a plan (each courier gets
 * neighbouring buildings with similar workloads); the super admin can apply it or change any building by hand.
 */
const ZONE={SOUTH:'南苑',NORTH:'北苑'} as const;

export function AdminDispatch(){
  const res=useResource<DispatchOverview>('/admin/dispatch');
  const [draft,setDraft]=useState<Record<string,string|null>>({}),[moveWaiting,setMoveWaiting]=useState(true),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false);
  const data=res.data;
  useEffect(()=>{if(data)setDraft(Object.fromEntries(data.buildings.map(b=>[b.code,b.adminId])));},[data]);
  const nameOf=useMemo(()=>new Map((data?.couriers??[]).map(c=>[c.id,c.name])),[data]);
  const slot=useMemo(()=>new Map((data?.couriers??[]).map((c,i)=>[c.id,i%8])),[data]);
  const changes=(data?.buildings??[]).filter(b=>(draft[b.code]??null)!==b.adminId);
  const planChanges=data?(data.buildings.filter(b=>(data.plan.assignments[b.code]??null)!==b.adminId)):[];
  async function save(list:{buildingCode:string;adminId:string|null}[],done:string){
    if(!list.length)return;setBusy(true);
    try{const r=await api<DispatchOverview&{moved:number;skipped:number}>('/admin/dispatch','PUT',{assignments:list,moveWaiting});const detail=r.moved?`已有 ${r.moved} 单待取件的小件一并转给新负责人`:'之后付款的小件按新分配派单';toast(done,r.skipped?'warn':'success',r.skipped?`${detail}；${r.skipped} 单未转交，请核对订单状态`:detail);setPreview(false);await res.refresh();}
    catch(err){toast((err as Error).message,'warn');}finally{setBusy(false);}
  }
  const counts=new Map<string,{n:number;work:number}>();
  for(const b of data?.buildings??[]){const id=draft[b.code];if(id){const c=counts.get(id)??{n:0,work:0};c.n++;c.work+=b.orders30;counts.set(id,c);}}
  const unassigned=(data?.buildings??[]).filter(b=>!draft[b.code]).length;

  return <AdminShell><h1>楼栋分配</h1>
    <p className="muted">小件按楼栋包分配：每栋楼由一位配送员负责，同学付款后订单直接交给 TA；大件、超大件和没有负责人的楼栋进入接单市场，由配送员自行接单。负责人有事时可以把订单退回市场。</p>
    {data?.world==='DEMO'&&<p className="test-data-note"><span className="test-data-badge">体验</span>这里是本次一键体验自己的分配，不会影响真实运营。</p>}
    <p role="alert">{res.error}</p>{res.loading&&!data&&<LoadingState/>}
    {data&&(data.couriers.length===0?<EmptyState title="还没有可分配的配送员" icon="person"><p>先在 <Link to="/admin/admins">管理员与授权</Link> 创建配送员账号，或在 <Link to="/admin/applications">配送员申请</Link> 审核同学的申请。</p></EmptyState>:<>
      <div className="dispatch-couriers" role="list" aria-label="配送员负责情况">{data.couriers.map(c=>{const k=counts.get(c.id);return <article role="listitem" key={c.id} className="dispatch-courier" data-slot={slot.get(c.id)}>
        <strong><span className="dispatch-dot" aria-hidden="true"/>{c.name}{c.role==='SUPER_ADMIN'&&<small className="muted"> · 超级管理员</small>}</strong>
        <span>{k?.n??0} 栋 · 近 30 天 {k?.work??0} 单小件</span>
        <small className="muted">{c.waiting?`${c.waiting} 单包分配待取件`:'暂无待取件'}{!c.phone&&' · 未填联系电话，不能负责楼栋'}</small></article>;})}
        <article role="listitem" className="dispatch-courier is-market"><strong>接单市场</strong><span>{unassigned} 栋没有负责人</span><small className="muted">这些楼的小件和所有大件、超大件进入市场</small></article></div>

      <section className="dispatch-plan panel"><h2>自动分配</h2>
        <p className="muted">按校园步行路线把相邻的楼栋分给同一位配送员，南苑、北苑分开，并按近 30 天小件单量让每人工作量接近；尽量保留现有分配。只使用已填联系电话的配送员（不含超级管理员）。</p>
        {data.plan.groups.length===0?<p>需要至少一位已填联系电话的配送员。</p>:<>
          <button type="button" className="secondary" onClick={()=>setPreview(p=>!p)} aria-expanded={preview}>{preview?'收起方案':'查看自动方案'}</button>
          {preview&&<><ol className="dispatch-plan-list">{data.plan.groups.map(g=><li key={g.adminId} data-slot={slot.get(g.adminId)}><strong><span className="dispatch-dot" aria-hidden="true"/>{nameOf.get(g.adminId)}</strong> · {g.buildings.length} 栋 · 工作量 {g.work}<br/><small>{g.buildings.map(code=>data.buildings.find(b=>b.code===code)?.name??code).join('、')}</small></li>)}</ol>
            <p className="muted small">采用后会改动 {planChanges.length} 栋楼的负责人。</p>
            <button type="button" disabled={busy||!planChanges.length||!data.canEdit} onClick={()=>void save(data.buildings.map(b=>({buildingCode:b.code,adminId:data.plan.assignments[b.code]??null})).filter(a=>(data.buildings.find(b=>b.code===a.buildingCode)?.adminId??null)!==a.adminId),'已采用自动分配')}>{planChanges.length?'采用这个方案':'现有分配已与方案一致'}</button></>}
        </>}
      </section>

      <section className="dispatch-table"><h2>逐栋调整</h2>
        <div className="dispatch-zones">{(['SOUTH','NORTH'] as const).map(zone=>{const list=data.buildings.filter(b=>b.zone===zone);if(!list.length)return null;return <div key={zone} className="table-scroll" tabIndex={0} role="region" aria-label={`${ZONE[zone]}楼栋分配（可左右滚动）`}>
          <table className="staff-table"><caption>{ZONE[zone]}</caption><thead><tr><th scope="col">楼栋</th><th scope="col">近 30 天小件</th><th scope="col">待取件</th><th scope="col">负责配送员</th></tr></thead>
            <tbody>{list.map(b=>{const v=draft[b.code]??'';const changed=(draft[b.code]??null)!==b.adminId;return <tr key={b.code} className={changed?'is-changed':undefined} data-slot={v?slot.get(v):undefined}>
              <th scope="row"><span className="dispatch-dot" aria-hidden="true"/>{b.name}</th><td>{b.orders30}</td><td>{b.waiting||'—'}</td>
              <td><label className="sr-only" htmlFor={`d-${b.code}`}>{b.name}的负责配送员</label><select id={`d-${b.code}`} value={v} disabled={!data.canEdit} onChange={e=>setDraft({...draft,[b.code]:e.target.value||null})}>
                <option value="">接单市场（不分配）</option>{data.couriers.map(c=><option key={c.id} value={c.id} disabled={!c.phone}>{c.name}{c.role==='SUPER_ADMIN'?'（超级管理员）':''}{!c.phone?'（未填电话）':''}</option>)}</select>{changed&&<small className="muted"> 已修改</small>}</td></tr>;})}</tbody></table></div>;})}</div>
        <div className={changes.length?"dispatch-save has-changes":"dispatch-save"}><label className="check"><input type="checkbox" checked={moveWaiting} onChange={e=>setMoveWaiting(e.target.checked)}/>还没取件的包分配小件，一并转给新负责人</label>
        <div className="actions"><button type="button" disabled={busy||!changes.length||!data.canEdit} onClick={()=>void save(changes.map(b=>({buildingCode:b.code,adminId:draft[b.code]??null})),`已保存 ${changes.length} 栋楼的分配`)}>{busy?'正在保存…':changes.length?`保存 ${changes.length} 处修改`:'没有修改'}</button>
          {changes.length>0&&<button type="button" className="text-button" onClick={()=>setDraft(Object.fromEntries(data.buildings.map(b=>[b.code,b.adminId])))}>撤销修改</button>}</div></div>
      </section>
    </>)}
  </AdminShell>;
}

/*
 * v4.5 · 配送员申请 (super admins): students who want to deliver part-time. Approving creates the courier account from
 * the application (the username and password the student chose, the phone as contact) and can hand it buildings at once.
 */
export function AdminApplications(){
  const [status,setStatus]=useState('PENDING');
  const res=useResource<{applications:CourierApplication[];pending:number}>(`/admin/courier-applications?status=${status}`);
  const dispatch=useResource<DispatchOverview>('/admin/dispatch');
  const [open,setOpen]=useState(''),[note,setNote]=useState(''),[picked,setPicked]=useState<string[]>([]),[busy,setBusy]=useState(false);
  // Opening an application starts with the student's own building picked (they deliver where they live first).
  useEffect(()=>{setNote('');const own=res.data?.applications.find(x=>x.id===open)?.buildingCode;setPicked(own?[own]:[]);},[open]);
  async function review(a:CourierApplication,decision:'APPROVE'|'REJECT'){
    setBusy(true);
    try{const r=await api<{status:string;username?:string}>(`/admin/courier-applications/${a.id}/review`,'POST',{decision,note:note.trim(),buildings:decision==='APPROVE'?picked:[]});
      toast(decision==='APPROVE'?`已通过，配送员账号 ${r.username} 已开通`:'已标记为未通过','success','结果已发到同学的站内消息');setOpen('');await res.refresh();await dispatch.refresh();}
    catch(err){toast((err as Error).message,'warn');}finally{setBusy(false);}
  }
  const owner=new Map((dispatch.data?.couriers??[]).map(c=>[c.id,c.name]));
  return <AdminShell><h1>配送员申请</h1>
    <p className="muted">同学在“配送说明 → 申请当兼职配送员”提交申请。通过后用同学填写的账号名和密码开通配送员账号（联系电话为申请里的手机号），可以顺便分配负责的楼栋；不通过请写明原因。</p>
    <div className="segmented" role="radiogroup" aria-label="申请状态">{(['PENDING','APPROVED','REJECTED','ALL'] as const).map(s=><button key={s} type="button" role="radio" aria-checked={status===s} onClick={()=>setStatus(s)}>{s==='ALL'?'全部':APPLICATION_STATUS_LABELS[s]}{s==='PENDING'&&res.data?.pending?` (${res.data.pending})`:''}</button>)}</div>
    <p role="alert">{res.error}</p>{res.loading&&!res.data&&<LoadingState/>}
    {res.data&&(res.data.applications.length===0?<EmptyState title={status==='PENDING'?'没有待审核的申请':'没有记录'} icon="person"/>:<div className="card-list application-list">{res.data.applications.map(a=><article key={a.id} className="parcel-card application-card">
      <div className="row"><strong>{a.realName}<small className="muted"> · {a.studentUsername}</small></strong><span className={`badge app-${a.status.toLowerCase()}`}>{APPLICATION_STATUS_LABELS[a.status]}</span></div>
      <dl className="application-facts"><div><dt>手机</dt><dd>{a.phone}</dd></div><div><dt>学院 / 年级</dt><dd>{[a.college,a.grade].filter(Boolean).join(' · ')||'—'}</dd></div>
        <div><dt>空闲时段</dt><dd>{a.slots.map(s=>APPLY_SLOT_LABELS[s]).join('、')}</dd></div><div><dt>住在</dt><dd>{a.buildingName?`${a.buildingName}${a.roomNo?` ${a.roomNo}`:''}`:'—'}</dd></div><div><dt>意向</dt><dd>{a.zone==='SOUTH'?'南苑':a.zone==='NORTH'?'北苑':'都可以'}</dd></div>
        <div><dt>想用的账号</dt><dd><code>{a.desiredUsername}</code></dd></div><div><dt>已完成的订单（作为学生）</dt><dd>{a.completedOrders??0}</dd></div></dl>
      {a.intro&&<p className="application-intro">{a.intro}</p>}
      <p className="muted small">提交于 {new Date(a.createdAt*1000).toLocaleString('zh-CN',{hour12:false})}{a.reviewedAt?` · 处理于 ${new Date(a.reviewedAt*1000).toLocaleString('zh-CN',{hour12:false})}`:''}{a.note?` · 备注：${a.note}`:''}</p>
      {a.status==='PENDING'&&(open===a.id?<div className="application-review">
        {dispatch.data&&<fieldset><legend>通过后负责的楼栋（可不选，之后在楼栋分配里调整）</legend><div className="chip-row">{dispatch.data.buildings.filter(b=>!a.zone||b.zone===a.zone).map(b=><label key={b.code} className={picked.includes(b.code)?'chip is-on':'chip'} title={b.adminId?`现由 ${owner.get(b.adminId)??'其他配送员'} 负责，选中后转给新配送员`:'暂无负责人'}><input type="checkbox" className="sr-only" checked={picked.includes(b.code)} onChange={e=>setPicked(e.target.checked?[...picked,b.code]:picked.filter(x=>x!==b.code))}/>{b.name}{b.adminId?' ·':''}</label>)}</div><small className="muted">带 · 的楼栋已有负责人，选中后会转给新配送员。</small></fieldset>}
        <label>备注（不通过时必填，同学可见）<input maxLength={120} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：时段和现有配送员重合，下学期再联系"/></label>
        <div className="actions"><button type="button" disabled={busy} onClick={()=>void review(a,'APPROVE')}>通过并开通账号</button><button type="button" className="danger" disabled={busy||!note.trim()} onClick={()=>void review(a,'REJECT')}>不通过</button><button type="button" className="text-button" onClick={()=>setOpen('')}>收起</button></div></div>
        :<div className="actions"><button type="button" className="secondary" onClick={()=>setOpen(a.id)}>审核</button></div>)}
    </article>)}</div>)}
  </AdminShell>;
}
