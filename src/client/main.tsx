import {MessageLink,UnreadDot,useUnreadCount} from './service-links';
import {StudentSessionProvider,isUnauthorized,useStudentSession} from './session';
import {CampusRail,ServicePages,SymbolIcon} from './campus-design';
import { DormSelector, LoadingState, SuccessMark } from './components';
import { Component, StrictMode, Suspense, lazy, useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Link, NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import {CAMPUS_ID} from '../shared/constants';
import type {Address,Admin,Building,Student} from '../shared/contracts';
import { api } from './api';
import './styles/index.css';
import { AmbientLayer, AmbientSwitch, Toaster } from './effects-ui';
import { BounceText } from './bounce-text';
import { CommandPalette, NetworkStatus, NotifyToggle, PaletteButton, useEasterEgg } from './extras';
import { AnnouncementBanner, FaqSearch, FeeCalculator, FootprintPanel, Onboarding } from './engagement-ui';
import { usePageEnter, useRipple, useScrollReveal, useScrolledClass } from './motion';
import { Home,NewParcel,ParcelDetail,Orders,OrderDetail,TipPage,SignInPrompt } from './student-delivery';
import { getItem, removeItem, setItem } from './storage';
import { useLiveChannel } from './live';
import { IntroSplash } from './intro';

const CHUNK_RELOAD_KEY='campusdrop:chunk-reload';
/** Lazily load one named page export. After a redeploy an open tab may request a chunk that no longer exists; reload once to pick up the new build. */
function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(async () => {
    try {
      const module = await load();
      removeItem(CHUNK_RELOAD_KEY, 'session');
      return { default: module[name] as unknown as ComponentType<object> };
    } catch (error) {
      // Reload at most once per tab; if session storage is unavailable, do not risk a reload loop.
      if (!getItem(CHUNK_RELOAD_KEY, 'session') && setItem(CHUNK_RELOAD_KEY, '1', 'session')) { window.location.reload(); return new Promise<never>(() => {}); }
      throw error;
    }
  }) as unknown as M[K];
}
const loadAdmin = () => import('./admin-delivery');
const AdminOrderDetail = lazyPage(loadAdmin, 'AdminOrderDetail'), AdminTasks = lazyPage(loadAdmin, 'AdminTasks'), Batches = lazyPage(loadAdmin, 'Batches'), BatchDetail = lazyPage(loadAdmin, 'BatchDetail'), AdminAccounts = lazyPage(loadAdmin, 'AdminAccounts'), Audit = lazyPage(loadAdmin, 'Audit');
const loadInsights = () => import('./admin-insights');
const AdminAnalytics = lazyPage(loadInsights, 'AdminAnalytics'), AdminAnnouncements = lazyPage(loadInsights, 'AdminAnnouncements');
const loadRecovery = () => import('./recovery-pages');
const RecoveryPage = lazyPage(loadRecovery, 'RecoveryPage'), RecoveryCode = lazyPage(loadRecovery, 'RecoveryCode'), RecoveryAdmin = lazyPage(loadRecovery, 'RecoveryAdmin'), ErrorMonitor = lazyPage(loadRecovery, 'ErrorMonitor');
const RouteSheet = lazyPage(() => import('./route-sheet'), 'RouteSheet');
const CampusMapPage = lazyPage(() => import('./campus-map'), 'CampusMapPage');
const AdminLiveMap = lazyPage(() => import('./admin-map'), 'AdminLiveMap');
const AccountDelete = lazyPage(() => import('./account-delete'), 'AccountDelete');
const loadExtras = () => import('./receipt');
const OrderReceipt = lazyPage(loadExtras, 'OrderReceipt');
const loadGame = () => import('./game');
const PlayPage = lazyPage(loadGame, 'PlayPage'), ParcelGame = lazyPage(loadGame, 'ParcelGame');
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
const pageFallback = <section><LoadingState label="正在加载页面…"/><p className="loading-wave" aria-hidden="true"><BounceText text="正在加载…" variant="wave"/></p></section>;

const fieldMessages=(register:boolean):Record<string,string>=>({username:'用户名须为 3–32 位字母、数字或下划线',password:register?'密码须为 6–128 个字符，且不超过 256 字节':'请输入密码，最多 128 个字符',name:'请填写姓名（1–32 个字符，不含特殊控制符或尖括号）',phone:'请填写有效的 11 位手机号码'});

function Auth({ register = false, admin = false }: { register?: boolean; admin?: boolean }) {
  const navigate = useNavigate(); const {session,setSession}=useStudentSession(); const [error, setError] = useState(''); const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({}); const [busy, setBusy] = useState(false); const [registered,setRegistered]=useState(false);
  // /login and /register render the same component instance, so clear per-form state when switching between them.
  useEffect(()=>{setRegistered(false);setError('');setFieldErrors({});},[admin,register]);
  // Warm the lazily loaded form schemas so submitting does not wait on them.
  useEffect(()=>{void import('./validation');},[]);
  // Students: reuse the app-wide session check instead of a second /me request (a guaranteed 401 for visitors).
  useEffect(()=>{if(!admin&&session==='signed-in'&&!registered)navigate('/profile',{replace:true});},[admin,session,registered,navigate]);
  useEffect(() => {
    if(!admin)return;
    let active=true;
    void api('/admin/me').then(()=>{if(active)navigate('/admin/account',{replace:true});}).catch(()=>{});
    return ()=>{active=false;};
  },[admin,navigate]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(busy)return; setError('');
    const formElement=event.currentTarget;const form = new FormData(formElement);
    const {loginSchema,registerSchema}=await import('./validation');
    const parsed=(register?registerSchema:loginSchema).safeParse(Object.fromEntries(form));
    if(!parsed.success){
      // Report every invalid field next to its input, then move focus to the first one.
      const messages=fieldMessages(register),next:Record<string,string>={};
      for(const issue of parsed.error.issues){const field=String(issue.path[0]??'');if(messages[field])next[field]??=messages[field];}
      setFieldErrors(next);
      const first=Object.keys(messages).find(field=>next[field]);
      if(first)formElement.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();else setError('请检查填写内容');
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await api(admin ? '/admin/auth/login' : register ? '/auth/register' : '/auth/login', 'POST', parsed.data);
      // Confirm the browser retained the HttpOnly session before announcing a successful login.
      try { await api(admin?'/admin/me':'/me'); }
      catch { throw new Error('账号验证已成功，但登录状态未能恢复。请允许本站 Cookie 后重新登录，勿重复注册。'); }
      if(!admin)setSession('signed-in');
      if(register)setRegistered(true);else navigate(admin ? '/admin/account' : '/profile',{replace:true});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const field=(name:string,hint?:string)=>({'aria-invalid':fieldErrors[name]?true:undefined,'aria-describedby':[hint,fieldErrors[name]&&`${name}-error`].filter(Boolean).join(' ')||undefined});
  const fieldError=(name:string)=>fieldErrors[name]&&<small className="field-error" id={`${name}-error`}>{fieldErrors[name]}</small>;
  // Typing in a flagged field clears its message; the rest stay until the next submit.
  const clearField=(event:FormEvent<HTMLFormElement>)=>{const name=(event.target as HTMLInputElement).name;if(fieldErrors[name])setFieldErrors(prev=>{const next={...prev};delete next[name];return next;});};
  if(register&&registered)return <section className="auth-success"><SuccessMark/><h1><BounceText text="注册成功"/></h1><p role="status">账号已创建并登录。接下来可以完善寝室资料。</p><Link className="button" to="/profile">完善寝室资料</Link><Link to="/">返回首页</Link></section>;
  return <section className="auth-page"><div className="auth-scenery" aria-hidden="true"><span>每一份期待<br/>都值得准时抵达</span></div><p className="eyebrow">{admin ? '管理员入口' : '学生服务'}</p><h1>{register ? '创建你的账号' : admin ? '管理员登录' : '欢迎回来'}</h1>
    <p className="muted">青岛科技大学 · 崂山校区</p>
    <form onSubmit={submit} onInput={clearField} noValidate>
      <fieldset disabled={busy}><label>用户名<input name="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" autoComplete="username" {...field('username','username-hint')} /></label>
      <small id="username-hint">3–32 位字母、数字或下划线</small>{fieldError('username')}
      <label>密码<input name="password" type="password" {...field('password')} required minLength={register ? 6 : 1} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} /></label>
      {fieldError('password')}
      {register && <><small>至少 6 个字符，建议使用较长的独立密码。</small>
        <label>姓名<input name="name" required maxLength={32} autoComplete="name" {...field('name')} /></label>{fieldError('name')}
        <label>配送联系电话<input name="phone" type="tel" required pattern="1[3-9][0-9]{9}" autoComplete="tel" {...field('phone')} /></label>{fieldError('phone')}
        <p className="muted">联系电话仅用于配送联系，不代表已完成手机号或学生身份认证。<Link to="/privacy">了解资料用途</Link></p></>}
      </fieldset><p role="alert" aria-live="assertive">{error}</p><button className={busy?'is-busy':undefined} disabled={busy}>{busy ? '正在处理…' : register ? '注册并继续' : '登录'}</button>
    </form>
    <p><Link to="/recover">忘记密码 / 使用恢复码</Link></p>
    {!admin && <p>{register ? <Link to="/login">已有账号，去登录</Link> : <Link to="/register">创建学生账号</Link>}</p>}
  </section>;
}

function Profile() {
  const [user, setUser] = useState<Student | null>(null); const [address, setAddress] = useState<Address | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]); const [zone, setZone] = useState<'SOUTH' | 'NORTH'>('SOUTH');
  const [building, setBuilding] = useState(''); const [room, setRoom] = useState('');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [needsLogin,setNeedsLogin]=useState(false);
  const navigate = useNavigate(); const {session,setSession}=useStudentSession();
  useEffect(() => {
    let active = true;
    // Known visitors go straight to the sign-in prompt without requesting private data.
    if(session==='signed-out'){setNeedsLogin(true);setLoaded(true);return;}
    if(session==='unknown')return;
    Promise.all([api<{ user: Student; address: Address | null }>('/me'), api<{ buildings: Building[] }>('/dorm-buildings')])
      .then(([me, list]) => {
        if (!active) return;
        setNeedsLogin(false); setUser(me.user); setAddress(me.address); setBuildings(list.buildings);
        if (me.address) { setZone(me.address.zone); setBuilding(me.address.buildingCode); setRoom(me.address.roomNo); }
      }).catch((e: Error) => { if (!active) return; if(isUnauthorized(e)){setNeedsLogin(true);setSession('signed-out');}else setMessage(e.message); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [session,setSession]);
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
    try { await api('/auth/logout', 'POST'); setSession('signed-out'); navigate('/login',{replace:true}); } catch (e) { setMessage((e as Error).message); }
  }
  if (!loaded) return <section><LoadingState label="正在读取资料…"/></section>;
  if (needsLogin) return <section><p className="eyebrow">我的寝室</p><h1>管理收货寝室</h1><SignInPrompt title="登录后设置寝室" text="保存宿舍楼与房间号后，下单时会自动带入配送地址。"/></section>;
  if (!user) return <section><h1>资料暂时无法读取</h1><p role="alert">{message}</p><button className="secondary" onClick={()=>window.location.reload()}>刷新重试</button></section>;
  return <section><p className="eyebrow">我的资料</p><h1>你好，{user.name}</h1><p className="muted">{user.phone}</p>
    <FootprintPanel/><NotifyToggle/><Suspense fallback={null}><RecoveryCode/></Suspense><h2>你的寝室</h2><p>{address ? `${address.buildingName} · ${address.roomNo}` : '选择宿舍楼，填写房间号。'}</p>
    <form onSubmit={save}>
      <DormSelector buildings={buildings} zone={zone} building={building} room={room} onZone={setZone} onBuilding={setBuilding} onRoom={setRoom}/>
      <button disabled={busy}>{busy ? '正在处理…' : '保存寝室资料'}</button>
    </form>
    <p role="status">{message}</p><p><Link to="/">前往我的包裹 →</Link></p>
    <div className="actions">{address && <button className="secondary" disabled={busy} onClick={remove}>移除当前寝室</button>}<button className="secondary" onClick={logout}>退出登录</button></div>
    <Suspense fallback={null}><AccountDelete/></Suspense>
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
  const navigate=useNavigate();const {session,setSession}=useStudentSession();const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(session!=='signed-in')return null;
  return <div className="account-exit"><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/auth/logout','POST');setSession('signed-out');navigate('/login',{replace:true});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>退出登录 / 切换账号</button>{error&&<p role="alert">{error}</p>}</div>;
}
/**
 * Notification clicks: an open tab gets a message from the service worker; a fresh tab opens at /?go=<path>, which
 * works the same with browser and hash routing. Only same-site paths are followed.
 */
function useDeepLinks(){
  const navigate=useNavigate();
  useEffect(()=>{
    const safe=(path:unknown):path is string=>typeof path==='string'&&/^\/(?![/\\])/.test(path);
    const go=new URLSearchParams(window.location.search).get('go');
    if(safe(go)){window.history.replaceState(window.history.state,'',window.location.pathname+window.location.hash);navigate(go,{replace:true});}
    if(!('serviceWorker' in navigator))return;
    const onMessage=(event:MessageEvent)=>{if(event.data?.type==='campusdrop:navigate'&&safe(event.data.url))navigate(event.data.url);};
    navigator.serviceWorker.addEventListener('message',onMessage);
    return()=>navigator.serviceWorker.removeEventListener('message',onMessage);
  },[navigate]);
}
function App() {
  const location=useLocation(); const admin=location.pathname.startsWith('/admin'); const mainRef=useRef<HTMLElement>(null);
  useEasterEgg(!admin);
  usePageEnter(mainRef,location.pathname,true); useScrollReveal(mainRef,location.pathname,true); useScrolledClass(); useRipple();
  useEffect(()=>{document.body.classList.toggle('student-view',!admin);document.body.classList.toggle('admin-view',admin);},[admin]);
  useEffect(()=>{window.scrollTo(0,0);document.getElementById('main-content')?.focus({preventScroll:true});},[location.pathname]);
  const unread=useUnreadCount();const {session}=useStudentSession();
  useLiveChannel(!admin&&session==='signed-in'?'student':null);
  useDeepLinks();
  // Destinations live in the rail (desktop) and the tab bar (phones); the top bar only carries utilities.
  return <div className="app-layout"><IntroSplash/><CampusRail unread={unread}/><div className="app-workspace"><div key={location.key} className="route-progress" aria-hidden="true"/><a className="skip-link" href="#main-content">跳至主要内容</a><header className="topbar"><Link className="brand" to="/">青岛科技大学<span>崂山校区 · CampusDrop 校园快递</span></Link><nav aria-label="工具栏">{!admin&&<MessageLink unread={unread}/>}<PaletteButton/>{!admin&&<AmbientSwitch/>}<NavLink className="topbar-admin" to="/admin/login">管理入口</NavLink></nav></header>
    <main id="main-content" ref={mainRef} tabIndex={-1}>{!admin&&!['/login','/register','/privacy'].includes(location.pathname)&&<><AnnouncementBanner/><AccountExit/></>}<PageErrorBoundary resetKey={location.pathname}><Suspense fallback={pageFallback}><Routes><Route path="/" element={<Home />} /><Route path="/login" element={<Auth />} /><Route path="/register" element={<Auth register />} /><Route path="/profile" element={<Profile />} /><Route path="/admin/login" element={<Auth admin />} /><Route path="/admin" element={<AdminTasks />} /><Route path="/admin/account" element={<AdminHome />} />
      <Route path="/parcel/new" element={<NewParcel/>}/><Route path="/parcel/:id" element={<ParcelDetail/>}/><Route path="/orders" element={<Orders/>}/><Route path="/orders/:id" element={<OrderDetail/>}/><Route path="/orders/:id/receipt" element={<OrderReceipt/>}/><Route path="/play" element={<PlayPage/>}/><Route path="/checkout/:orderId" element={<OrderDetail checkout/>}/><Route path="/tip/:orderId" element={<TipPage/>}/>
      <Route path="/admin/orders/:id" element={<AdminOrderDetail/>}/><Route path="/admin/tasks" element={<AdminTasks/>}/><Route path="/admin/batches" element={<Batches/>}/><Route path="/admin/batches/:id" element={<BatchDetail/>}/><Route path="/admin/admins" element={<AdminAccounts/>}/><Route path="/admin/audit" element={<Audit/>}/><Route path="/admin/analytics" element={<AdminAnalytics/>}/><Route path="/admin/announcements" element={<AdminAnnouncements/>}/><Route path="/map" element={<CampusMapPage/>}/><Route path="/admin/map" element={<AdminLiveMap/>}/><Route path="/admin/route-sheet" element={<RouteSheet/>}/>
      <Route path="/messages" element={<Inbox/>}/><Route path="/tickets" element={<TicketList/>}/><Route path="/tickets/new" element={<TicketNew/>}/><Route path="/tickets/:id" element={<TicketDetail/>}/><Route path="/admin/tickets" element={<TicketList admin/>}/><Route path="/admin/tickets/:id" element={<TicketDetail admin/>}/><Route path="/recover" element={<RecoveryPage/>}/><Route path="/admin/recovery" element={<RecoveryAdmin/>}/><Route path="/admin/errors" element={<ErrorMonitor/>}/><Route path="/guide" element={<ServicePages kind="guide" slot={<FeeCalculator/>}/>}/><Route path="/help" element={<ServicePages kind="help" slot={<FaqSearch/>}/>}/><Route path="/contact" element={<ServicePages kind="contact"/>}/><Route path="/handoff-rules" element={<section><h1>包裹交接与退单规则</h1><p>未取件可说明原因后退回市场。已取件的包裹由当前配送员继续妥善保管，不得随意放置或交给身份未确认的人。</p><p>无法继续配送时，先标记配送异常，联系学生，并将包裹归还原取件站点；填写准确存放位置、包裹完整性和交接情况。另一位有权限的管理员核验实物后，才能退回接单市场或取消退款。</p><p>不得仅凭口头承诺点击核验。遗失、损坏、站点拒收或无法联系时，保持异常状态，联系负责该区域的管理员处理；未完成交接不得停用原配送账号。</p><p>核验记录只证明管理员作出了确认，不代表系统自动验证实物。当前资金操作为模拟，未发生真实扣款或退款。</p></section>}/><Route path="/privacy" element={<section><h1>资料用途</h1><p>姓名、联系电话及寝室资料用于校园配送联系与地址管理。你可以在个人页面移除当前寝室；修改前的地址与操作记录会保留用于业务追溯。</p><p>目前为开发版本，尚未开放真实配送。正式运营前将补充数据保留期限、账号删除渠道及运营联系方式。测试请使用虚构资料。</p><p>本项目非青岛科技大学或菜鸟官方产品，不绑定菜鸟账号。</p><Link to="/register">返回注册</Link></section>} />
      <Route path="*" element={<section className="not-found"><p className="eyebrow">404 · 页面不存在</p><h1><BounceText text="这个地址没有找到内容" variant="wave"/></h1><p className="muted">链接可能已失效，或页面已经调整。</p><Link className="button" to="/">返回首页</Link><Suspense fallback={null}><ParcelGame title="迷路了？先玩一局接包裹"/></Suspense></section>} /></Routes></Suspense></PageErrorBoundary></main>
    <nav className={admin?'mobile-tabs hidden':'mobile-tabs'} aria-label="学生导航">{([['/','box','包裹'],['/orders','order','订单'],['/messages','chat','消息'],['/tickets','ticket','售后'],['/profile','person','我的']] as const).map(([to,icon,label])=><NavLink key={to} to={to} end={to==='/'}><span className="tab-icon"><SymbolIcon name={icon}/>{to==='/messages'&&<UnreadDot count={unread}/>}</span><span>{label}</span></NavLink>)}</nav><footer>独立校园服务项目 · 非学校或菜鸟官方产品<span aria-hidden="true"> · </span><Link to="/admin/login">管理员入口</Link></footer></div><AmbientLayer enabled={!admin}/><Toaster/><NetworkStatus/><CommandPalette/>{!admin&&<Onboarding autoOpen={location.pathname==='/'}/>}</div>;
}
const cloudbaseStatic=typeof __CLOUDBASE_STATIC__!=='undefined'&&__CLOUDBASE_STATIC__;
const Router=cloudbaseStatic?HashRouter:BrowserRouter;
// Offline shell, asset cache and web push. Development builds skip it so hot reload is never served from a cache.
if(import.meta.env.PROD&&'serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{});});
createRoot(document.getElementById('root')!).render(<StrictMode><Router><StudentSessionProvider><App /></StudentSessionProvider></Router></StrictMode>);
