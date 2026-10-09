import {MessageLink} from './service-links';
import {CampusRail,ServicePages} from './campus-design';
import { DormSelector } from './components';
import { Component, StrictMode, Suspense, lazy, useEffect, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Link, NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { CAMPUS_ID, loginSchema, registerSchema, type Address, type Admin, type Building, type Student } from '../shared/contracts';
import { api } from './api';
import './styles.css';
import './campus-rail.css';
import { Home,NewParcel,ParcelDetail,Orders,OrderDetail,TipPage } from './student-delivery';

const CHUNK_RELOAD_KEY='campusdrop:chunk-reload';
/** Lazily load one named page export. After a redeploy an open tab may request a chunk that no longer exists; reload once to pick up the new build. */
function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(async () => {
    try {
      const module = await load();
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return { default: module[name] as unknown as ComponentType<object> };
    } catch (error) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) { sessionStorage.setItem(CHUNK_RELOAD_KEY, '1'); window.location.reload(); return new Promise<never>(() => {}); }
      throw error;
    }
  }) as unknown as M[K];
}
const loadAdmin = () => import('./admin-delivery');
const AdminOrderDetail = lazyPage(loadAdmin, 'AdminOrderDetail'), AdminTasks = lazyPage(loadAdmin, 'AdminTasks'), Batches = lazyPage(loadAdmin, 'Batches'), BatchDetail = lazyPage(loadAdmin, 'BatchDetail'), AdminAccounts = lazyPage(loadAdmin, 'AdminAccounts'), Audit = lazyPage(loadAdmin, 'Audit');
const loadRecovery = () => import('./recovery-pages');
const RecoveryPage = lazyPage(loadRecovery, 'RecoveryPage'), RecoveryCode = lazyPage(loadRecovery, 'RecoveryCode'), RecoveryAdmin = lazyPage(loadRecovery, 'RecoveryAdmin'), ErrorMonitor = lazyPage(loadRecovery, 'ErrorMonitor');
const loadService = () => import('./service-pages');
const Inbox = lazyPage(loadService, 'Inbox'), TicketList = lazyPage(loadService, 'TicketList'), TicketNew = lazyPage(loadService, 'TicketNew'), TicketDetail = lazyPage(loadService, 'TicketDetail');

class PageErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(previous: { resetKey: string }) { if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false }); }
  render() {
    if (this.state.failed) return <section><h1>页面加载失败</h1><p role="alert">网络异常或网站刚刚更新，请刷新后重试。</p><button onClick={() => window.location.reload()}>刷新页面</button></section>;
    return this.props.children;
  }
}
const pageFallback = <section><p role="status">正在加载页面…</p></section>;

function Auth({ register = false, admin = false }: { register?: boolean; admin?: boolean }) {
  const navigate = useNavigate(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [registered,setRegistered]=useState(false);
  useEffect(() => {
    let active=true; setRegistered(false);
    void api(admin?'/admin/me':'/me').then(()=>{if(active){if(register)setRegistered(true);else navigate(admin?'/admin/account':'/profile',{replace:true});}}).catch(()=>{});
    return ()=>{active=false;};
  },[admin,register,navigate]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(busy)return; setError('');
    const form = new FormData(event.currentTarget);
    const parsed=(register?registerSchema:loginSchema).safeParse(Object.fromEntries(form));
    if(!parsed.success){
      const field=String(parsed.error.issues[0]?.path[0]??'');
      setError(field==='username'?'用户名须为 3–32 位字母、数字或下划线':field==='password'?(register?'密码须为 6–128 个字符，且不超过 256 字节':'请输入密码，最多 128 个字符'):field==='phone'?'请填写有效的 11 位手机号码':field==='name'?'请填写姓名（1–32 个字符，不含特殊控制符或尖括号）':'请检查填写内容');
      return;
    }
    setBusy(true);
    try {
      await api(admin ? '/admin/auth/login' : register ? '/auth/register' : '/auth/login', 'POST', parsed.data);
      // Confirm the browser retained the HttpOnly session before announcing a successful login.
      try { await api(admin?'/admin/me':'/me'); }
      catch { throw new Error('账号验证已成功，但登录状态未能恢复。请允许本站 Cookie 后重新登录，勿重复注册。'); }
      if(register)setRegistered(true);else navigate(admin ? '/admin/account' : '/profile',{replace:true});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if(register&&registered)return <section><h1>注册成功</h1><p role="status">账号已创建并登录。接下来可以完善寝室资料。</p><Link className="button" to="/profile">完善寝室资料</Link><Link to="/">返回首页</Link></section>;
  return <section className="auth-page"><div className="auth-scenery" aria-hidden="true"><span>每一份期待<br/>都值得准时抵达</span></div><p className="eyebrow">{admin ? '管理员入口' : '学生服务'}</p><h1>{register ? '创建你的账号' : admin ? '管理员登录' : '欢迎回来'}</h1>
    <p className="muted">青岛科技大学 · 崂山校区</p>
    <form onSubmit={submit} noValidate>
      <fieldset disabled={busy}><label>用户名<input name="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" aria-describedby="username-hint" /></label>
      <small id="username-hint">3–32 位字母、数字或下划线</small>
      <label>密码<input name="password" type="password" required minLength={register ? 6 : 1} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} /></label>
      {register && <><small>至少 6 个字符，建议使用较长的独立密码。</small>
        <label>姓名<input name="name" required maxLength={32} autoComplete="name" /></label>
        <label>配送联系电话<input name="phone" type="tel" required pattern="1[3-9][0-9]{9}" autoComplete="tel" /></label>
        <p className="muted">联系电话仅用于配送联系，不代表已完成手机号或学生身份认证。<Link to="/privacy">了解资料用途</Link></p></>}
      </fieldset><p role="alert" aria-live="assertive">{error}</p><button disabled={busy}>{busy ? '正在处理…' : register ? '注册并继续' : '登录'}</button>
    </form>
    <p><Link to="/recover">忘记密码 / 使用恢复码</Link></p>
    {!admin && <p>{register ? <Link to="/login">已有账号，去登录</Link> : <Link to="/register">创建学生账号</Link>}</p>}
  </section>;
}

function Profile() {
  const [user, setUser] = useState<Student | null>(null); const [address, setAddress] = useState<Address | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]); const [zone, setZone] = useState<'SOUTH' | 'NORTH'>('SOUTH');
  const [building, setBuilding] = useState(''); const [room, setRoom] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    Promise.all([api<{ user: Student; address: Address | null }>('/me'), api<{ buildings: Building[] }>('/dorm-buildings')])
      .then(([me, list]) => {
        if (!active) return;
        setUser(me.user); setAddress(me.address); setBuildings(list.buildings);
        if (me.address) { setZone(me.address.zone); setBuilding(me.address.buildingCode); setRoom(me.address.roomNo); }
      }).catch((e: Error) => { if (active) setMessage(e.message); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const result = await api<{ address: Address }>('/me/address', address ? 'PUT' : 'POST', { campusId: CAMPUS_ID, zone, buildingCode: building, roomNo: room });
      setAddress(result.address); setMessage('寝室资料已保存');
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api('/me/address', 'DELETE'); setAddress(null); setBuilding(''); setRoom(''); setMessage('当前寝室已移除，历史记录保留用于审计'); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function logout() {
    try { await api('/auth/logout', 'POST'); navigate('/login',{replace:true}); } catch (e) { setMessage((e as Error).message); }
  }
  if (!loaded) return <section><p role="status">正在读取资料…</p></section>;
  if (!user) return <section><h1>请先登录</h1><p role="alert">{message}</p><Link to="/login">前往登录</Link></section>;
  return <section><p className="eyebrow">我的资料</p><h1>你好，{user.name}</h1><p className="muted">{user.phone}</p>
    <Suspense fallback={null}><RecoveryCode/></Suspense><h2>你的寝室</h2><p>{address ? `${address.buildingName} · ${address.roomNo}` : '选择宿舍楼，填写房间号。'}</p>
    <form onSubmit={save}>
      <DormSelector buildings={buildings} zone={zone} building={building} room={room} onZone={setZone} onBuilding={setBuilding} onRoom={setRoom}/>
      <button disabled={busy}>{busy ? '正在处理…' : '保存寝室资料'}</button>
    </form>
    <p role="status">{message}</p><p><Link to="/">前往我的包裹 →</Link></p>
    <div className="actions">{address && <button className="secondary" disabled={busy} onClick={remove}>移除当前寝室</button>}<button className="secondary" onClick={logout}>退出登录</button></div>
  </section>;
}

function AdminHome() {
  const [phone,setPhone]=useState(''),[saving,setSaving]=useState(false);
  const [admin, setAdmin] = useState<Admin | null>(null); const [buildings, setBuildings] = useState<Building[]>([]); const [message, setMessage] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    Promise.all([api<{ admin: Admin }>('/admin/me'), api<{ buildings: Building[] }>('/admin/dorm-buildings')])
      .then(([me, list]) => { if (active) { setAdmin(me.admin); setPhone(me.admin.phone??''); setBuildings(list.buildings); } })
      .catch((e: Error) => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, []);
  async function logout() {
    try { await api('/admin/auth/logout', 'POST'); navigate('/admin/login'); } catch (e) { setMessage((e as Error).message); }
  }
  return <section><p className="eyebrow">管理员工作区</p><h1>{admin ? admin.username : '账号与授权范围'}</h1>
    <p role="status">{message || (!admin ? '正在读取…' : '')}</p>
    {admin ? <><p>角色：{{ SUPER_ADMIN: '超级管理员', ZONE_ADMIN: '区域管理员', BUILDING_ADMIN: '楼栋管理员', DELIVERY_STAFF: '配送人员' }[admin.role]}</p>
      <Suspense fallback={null}><RecoveryCode admin/></Suspense><h2>配送联系电话</h2><p>接单前请填写本人号码，接单后会向该订单的学生展示。号码仅做格式校验。</p><form onSubmit={async e=>{e.preventDefault();setSaving(true);try{const result=await api<{admin:Admin}>('/admin/me/contact','PUT',{phone});setAdmin(result.admin);setMessage('联系方式已保存');navigate('/admin',{replace:true});}catch(error){setMessage((error as Error).message);}finally{setSaving(false);}}}><label>管理员联系电话<input type="tel" inputMode="tel" autoComplete="tel" required pattern="1[3-9][0-9]{9}" maxLength={11} value={phone} onChange={e=>setPhone(e.target.value)}/></label><button disabled={saving}>保存联系方式并进入工作台</button></form>
      <h2>已授权楼栋</h2>{buildings.length ? <ul>{buildings.map(b => <li key={b.code}>{b.displayName}</li>)}</ul> : <p>暂无整栋楼权限；配送人员仅能查看分配给自己的批次和订单。</p>}<p><Link to="/admin">返回配送工作台</Link></p>
      <button className="secondary" onClick={logout}>退出管理员登录</button></> : <Link to="/admin/login">前往管理员登录</Link>}
  </section>;
}

function AccountExit(){
  const navigate=useNavigate();const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <div className="account-exit"><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/auth/logout','POST');navigate('/login',{replace:true});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>退出登录 / 切换账号</button>{error&&<p role="alert">{error}</p>}</div>;
}
function App() {
  const location=useLocation(); const admin=location.pathname.startsWith('/admin');
  useEffect(()=>{document.body.classList.toggle('student-view',!admin);},[admin]);
  useEffect(()=>{window.scrollTo(0,0);document.getElementById('main-content')?.focus({preventScroll:true});},[location.pathname]);
  return <div className="app-layout"><CampusRail/><div className="app-workspace"><a className="skip-link" href="#main-content">跳至主要内容</a><header className="topbar"><Link className="brand" to="/">青岛科技大学<span>崂山校区 · CampusDrop 校园快递</span></Link><nav><Link to="/">我的包裹</Link><Link to="/orders">订单</Link><Link to="/profile">寝室</Link>{!admin&&<MessageLink/>}<Link to="/tickets">售后</Link><Link to="/admin/login">管理入口</Link></nav></header>
    <main id="main-content" tabIndex={-1}>{!admin&&!['/login','/register','/privacy'].includes(location.pathname)&&<AccountExit/>}<PageErrorBoundary resetKey={location.pathname}><Suspense fallback={pageFallback}><Routes><Route path="/" element={<Home />} /><Route path="/login" element={<Auth />} /><Route path="/register" element={<Auth register />} /><Route path="/profile" element={<Profile />} /><Route path="/admin/login" element={<Auth admin />} /><Route path="/admin" element={<AdminTasks />} /><Route path="/admin/account" element={<AdminHome />} />
      <Route path="/parcel/new" element={<NewParcel/>}/><Route path="/parcel/:id" element={<ParcelDetail/>}/><Route path="/orders" element={<Orders/>}/><Route path="/orders/:id" element={<OrderDetail/>}/><Route path="/checkout/:orderId" element={<OrderDetail checkout/>}/><Route path="/tip/:orderId" element={<TipPage/>}/>
      <Route path="/admin/orders/:id" element={<AdminOrderDetail/>}/><Route path="/admin/tasks" element={<AdminTasks/>}/><Route path="/admin/batches" element={<Batches/>}/><Route path="/admin/batches/:id" element={<BatchDetail/>}/><Route path="/admin/admins" element={<AdminAccounts/>}/><Route path="/admin/audit" element={<Audit/>}/>
      <Route path="/messages" element={<Inbox/>}/><Route path="/tickets" element={<TicketList/>}/><Route path="/tickets/new" element={<TicketNew/>}/><Route path="/tickets/:id" element={<TicketDetail/>}/><Route path="/admin/tickets" element={<TicketList admin/>}/><Route path="/admin/tickets/:id" element={<TicketDetail admin/>}/><Route path="/recover" element={<RecoveryPage/>}/><Route path="/admin/recovery" element={<RecoveryAdmin/>}/><Route path="/admin/errors" element={<ErrorMonitor/>}/><Route path="/guide" element={<ServicePages kind="guide"/>}/><Route path="/help" element={<ServicePages kind="help"/>}/><Route path="/contact" element={<ServicePages kind="contact"/>}/><Route path="/handoff-rules" element={<section><h1>包裹交接与退单规则</h1><p>未取件可说明原因后退回市场。已取件的包裹由当前配送员继续妥善保管，不得随意放置或交给身份未确认的人。</p><p>无法继续配送时，先标记配送异常，联系学生，并将包裹归还原取件站点；填写准确存放位置、包裹完整性和交接情况。另一位有权限的管理员核验实物后，才能退回接单市场或取消退款。</p><p>不得仅凭口头承诺点击核验。遗失、损坏、站点拒收或无法联系时，保持异常状态，联系负责该区域的管理员处理；未完成交接不得停用原配送账号。</p><p>核验记录只证明管理员作出了确认，不代表系统自动验证实物。当前资金操作为模拟，未发生真实扣款或退款。</p></section>}/><Route path="/privacy" element={<section><h1>资料用途</h1><p>姓名、联系电话及寝室资料用于校园配送联系与地址管理。你可以在个人页面移除当前寝室；修改前的地址与操作记录会保留用于业务追溯。</p><p>目前为开发版本，尚未开放真实配送。正式运营前将补充数据保留期限、账号删除渠道及运营联系方式。测试请使用虚构资料。</p><p>本项目非青岛科技大学或菜鸟官方产品，不绑定菜鸟账号。</p><Link to="/register">返回注册</Link></section>} />
      <Route path="*" element={<section><h1>页面不存在</h1><Link to="/profile">返回我的寝室</Link></section>} /></Routes></Suspense></PageErrorBoundary></main>
    <nav className={admin?'mobile-tabs hidden':'mobile-tabs'} aria-label="学生导航"><NavLink to="/" end>我的包裹</NavLink><NavLink to="/orders">配送订单</NavLink><NavLink to="/profile">我的寝室</NavLink><NavLink to="/messages">消息</NavLink></nav><footer>独立校园服务项目 · 非学校或菜鸟官方产品</footer></div></div>;
}
const cloudbaseStatic=typeof __CLOUDBASE_STATIC__!=='undefined'&&__CLOUDBASE_STATIC__;
const Router=cloudbaseStatic?HashRouter:BrowserRouter;
createRoot(document.getElementById('root')!).render(<StrictMode><Router><App /></Router></StrictMode>);
