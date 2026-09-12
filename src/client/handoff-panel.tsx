import {useState} from 'react';
import {Link} from 'react-router-dom';
import type {Admin} from '../shared/contracts';
import type {Handoff,Order} from '../shared/delivery';
import {api} from './api';
import {useResource} from './student-delivery';
import {ConfirmAction} from './components';
export function HandoffPanel({order,refresh}:{order:Order;refresh:()=>Promise<void>}){return order.status==='DELIVERY_EXCEPTION'?<HandoffForm order={order} refresh={refresh}/>:null;}
function HandoffForm({order,refresh}:{order:Order;refresh:()=>Promise<void>}){
 const me=useResource<{admin:Admin}>('/admin/me'),history=useResource<{handoffs:Handoff[];changes:{id:number;action:string;priorLocation:string;priorNote:string;reason:string}[]}>(`/admin/orders/${order.id}/handoffs`);
 const [location,setLocation]=useState(''),[note,setNote]=useState(''),[reason,setReason]=useState(''),[editing,setEditing]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const pending=history.data?.handoffs.find(h=>h.status==='PENDING');
 async function submit(action:'create'|'edit'|'confirm'|'reject'){
  setBusy(true);try{await api(`/admin/orders/${order.id}/handoffs${action==='create'?'':`/${pending!.id}${['confirm','reject'].includes(action)?`/${action}`:''}`}`,action==='edit'?'PATCH':'POST',{version:order.version,confirmed:true,...(['create','edit'].includes(action)?{location,note}:{}),...(action==='reject'?{reason}:{})});setMessage({create:'交接申请已提交，请另一位有权限的管理员核验',edit:'修改已保存，旧记录保留供追溯',confirm:'交接已核验，现在可以退回市场',reject:'交接已驳回，包裹仍由原配送员保管'}[action]);setEditing(false);await history.refresh();await refresh();}
  catch(e){setMessage((e as Error).message);await history.refresh();await refresh();}finally{setBusy(false);}
 }
 const fields=<><label>原站点存放位置<input maxLength={120} value={location} onChange={e=>setLocation(e.target.value)}/></label><label>交接与完整性说明<textarea maxLength={240} value={note} onChange={e=>setNote(e.target.value)}/></label></>;
 return <div className="order-actions"><h3>包裹归还交接</h3><Link to="/handoff-rules">阅读交接与退单规则</Link><p>归还原站点后填写位置，由另一位有权限的管理员核验；驳回不解除保管责任。</p>
 {order.custodyState==='RETURNED'?<p className="success">包裹已归还并核验，可以退回接单市场。</p>:pending?<><p>等待核验 · 存放位置：{pending.location}</p><p>交接说明：{pending.note}</p>
 {me.data?.admin.id===pending.requestedBy&&<><button className="secondary" onClick={()=>{setLocation(pending.location);setNote(pending.note);setEditing(!editing);}}>修改交接申请</button>{editing&&<>{fields}<ConfirmAction label="保存交接修改" title="确认修改交接说明？" busy={busy} onConfirm={()=>submit('edit')}><p>修改前的说明会保留，核验人须重新核对。</p></ConfirmAction></>}</>}
 {me.data&&me.data.admin.role!=='DELIVERY_STAFF'&&me.data.admin.id!==pending.requestedBy&&<><ConfirmAction label="核验归还交接" title="确认已核验实际包裹？" busy={busy} onConfirm={()=>submit('confirm')}><p>我已核对实际包裹、位置及完整性，并确认站点接收。</p></ConfirmAction><label>驳回原因<textarea maxLength={240} value={reason} onChange={e=>setReason(e.target.value)}/></label><ConfirmAction label="驳回交接申请" title="确认驳回交接？" busy={busy} onConfirm={()=>submit('reject')}><p>{reason||'必须填写原因'}。驳回后需配送员更正并重新申请。</p></ConfirmAction></>}
 </>:<>{fields}<ConfirmAction label="提交归还交接" title="确认包裹已归还原站点？" busy={busy} onConfirm={()=>submit('create')}><p>{location} · {note}</p></ConfirmAction></>}
 {history.data?.handoffs.filter(h=>h.status==='REJECTED').map(h=><p key={h.id} role="status">已驳回：{h.rejectionReason}（原位置：{h.location}）</p>)}{!!history.data?.changes.length&&<details><summary>交接修改记录</summary>{history.data.changes.map(c=><p key={c.id}>{c.action==='EDIT'?'修改前':'驳回前'}：{c.priorLocation} · {c.priorNote}{c.reason&&`；原因：${c.reason}`}</p>)}</details>}<p role="status">{message||history.error}</p></div>;
}
