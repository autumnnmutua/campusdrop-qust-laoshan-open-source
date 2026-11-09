/* © 2026 专业团队 · CampusDrop v4.5.0 */
import './zod-config';
import {useEffect,useState,type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {AdminShell} from './admin-delivery';
import {LoadingState,EmptyState} from './components';
import {api} from './api';
import {toast} from './effects';
import {useResource} from './student-delivery';

/*
 * v3.9 · 账号管理 (super admins): student accounts — search, mark test accounts (left out of 实测报告) and clear an
 * account (the same anonymisation as the student's own 注销; orders stay as anonymous records). Staff accounts are
 * managed on 管理员与授权. Inside the one-click demo the page lists the demo's own accounts and is read-only.
 */
interface StudentAccount{id:string;username:string;name:string;phoneMasked:string;createdAt:number;status:string;testAccount:boolean;orders:number;openOrders:number;lastOrderAt:number|null}
const day=(t:number|null)=>t?new Date(t*1000).toLocaleDateString('zh-CN'):'—';

export function AdminStudentAccounts(){
  const [q,setQ]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1);
  const res=useResource<{students:StudentAccount[];page:number;hasMore:boolean;total:number}>(`/admin/accounts/students?q=${encodeURIComponent(query)}&page=${page}`);
  const me=useResource<{admin:{demo?:boolean}}>('/admin/me');
  const readOnly=Boolean(me.data?.admin.demo);
  const [busy,setBusy]=useState(''),[confirm,setConfirm]=useState('');
  useEffect(()=>{setConfirm('');},[query,page]);
  function search(e:FormEvent){e.preventDefault();setPage(1);setQuery(q.trim());}
  async function flag(s:StudentAccount){
    setBusy(s.id);
    try{await api(`/admin/accounts/students/${s.id}/test-flag`,'POST',{testAccount:!s.testAccount});toast(s.testAccount?'已取消测试账号标记':'已标记为测试账号','success',s.testAccount?'之后的订单会计入实测报告':'这个账号的订单不再计入实测报告');await res.refresh();}
    catch(err){toast((err as Error).message,'warn');}finally{setBusy('');}
  }
  async function remove(s:StudentAccount){
    setBusy(s.id);
    try{await api(`/admin/accounts/students/${s.id}/delete`,'POST',{confirmed:true});toast(`已注销 ${s.username}`,'success','订单保留为匿名记录');setConfirm('');await res.refresh();}
    catch(err){toast((err as Error).message,'warn');}finally{setBusy('');}
  }
  return <AdminShell><h1>账号管理</h1>
    <p className="muted">学生账号在这里查找、标记测试账号或注销；配送员和管理员账号在 <Link to="/admin/admins">管理员与授权</Link> 管理。注销与学生自己注销相同：清除姓名、手机号、地址和登录，订单保留为匿名记录，不能恢复。</p>
    {readOnly&&<p className="demo-readonly-note">一键体验：这里只显示本次体验的账号，只能查看。</p>}
    <form className="account-search" role="search" onSubmit={search}><label className="sr-only" htmlFor="acc-q">搜索用户名或姓名</label><input id="acc-q" type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="搜索用户名或姓名" maxLength={32}/><button className="secondary">搜索</button></form>
    <p role="alert">{res.error}</p>{res.loading&&!res.data&&<LoadingState/>}
    {res.data&&<>
      <p className="muted small">共 {res.data.total} 个学生账号{query?`，“${query}”的结果在下面`:''}。</p>
      {res.data.students.length?<div className="table-scroll" tabIndex={0} role="region" aria-label="学生账号（可左右滚动）"><table className="staff-table account-table">
        <thead><tr><th scope="col">用户名</th><th scope="col">姓名</th><th scope="col">手机</th><th scope="col">注册</th><th scope="col">订单</th><th scope="col">最近下单</th><th scope="col">状态</th>{!readOnly&&<th scope="col">操作</th>}</tr></thead>
        <tbody>{res.data.students.map(s=><tr key={s.id}>
          <td><strong>{s.username}</strong></td><td>{s.name}</td><td>{s.phoneMasked}</td><td>{day(s.createdAt)}</td>
          <td>{s.orders}{s.openOrders?<small className="muted"> · {s.openOrders} 进行中</small>:''}</td><td>{day(s.lastOrderAt)}</td>
          <td>{s.status==='DISABLED'?'已停用':'正常'}{s.testAccount&&<span className="test-data-badge">测试账号</span>}</td>
          {!readOnly&&<td><div className="actions">
            <button className="text-button" disabled={busy===s.id} onClick={()=>void flag(s)}>{s.testAccount?'取消测试标记':'标记为测试'}</button>
            {confirm===s.id?<><button className="danger" disabled={busy===s.id||s.openOrders>0} onClick={()=>void remove(s)}>确认注销</button><button className="text-button" onClick={()=>setConfirm('')}>取消</button></>
              :<button className="text-button" disabled={busy===s.id} title={s.openOrders?'还有进行中的订单，处理完才能注销':undefined} onClick={()=>setConfirm(s.id)}>注销</button>}
          </div>{confirm===s.id&&s.openOrders>0&&<small className="field-error">还有 {s.openOrders} 个进行中的订单，处理完才能注销。</small>}</td>}
        </tr>)}</tbody></table></div>:<EmptyState title={query?'没有找到匹配的账号':'还没有学生账号'} icon="person"/>}
      {(page>1||res.data.hasMore)&&<div className="actions pager"><button className="secondary" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>上一页</button><span className="muted small">第 {page} 页</span><button className="secondary" disabled={!res.data.hasMore} onClick={()=>setPage(p=>p+1)}>下一页</button></div>}
    </>}
  </AdminShell>;
}
