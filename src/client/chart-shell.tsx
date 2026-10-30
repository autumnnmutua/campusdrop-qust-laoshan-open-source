import {useEffect,useState} from 'react';
import {Link,NavLink,useLocation,useNavigate} from 'react-router-dom';
import {NavGlider} from './nav-glider';
import {t} from './i18n';
import {api} from './api';
import {SymbolIcon} from './campus-design';
import {UnreadDot} from './service-links';
import {PaletteButton} from './extras';
import {AmbientSwitch} from './effects-ui';
import {useStudentSession} from './session';

/**
 * The CampusDrop mark: a chart "position fix" (a ring round a point) with a short magenta route running into it.
 * The ring is where your parcel is going; the route is the delivery.
 */
export function BrandMark({size=28}:{size?:number}){
  return <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="18" cy="13" r="9" fill="none" stroke="currentColor" strokeWidth="1.6"/>
    <circle cx="18" cy="13" r="2.4" fill="currentColor"/>
    <path className="brand-mark-route" d="M3 29c4-1 6-4 8-7s3.4-3.6 5-3.9" fill="none" strokeWidth="2.2" strokeLinecap="round"/>
  </svg>;
}

export function Wordmark(){
  return <span className="wordmark"><BrandMark/><span className="wordmark-text"><b>CampusDrop</b><small>{t('崂山校区')}</small></span></span>;
}

const STUDENT_NAV=[['/',t('首页')],['/parcel/new',t('下单')],['/orders',t('订单')],['/send',t('代寄件')],['/map',t('地图')],['/messages',t('消息')],['/tickets',t('售后')]] as const;

/** Sign-out lives in the header so it is one tap away on every page, as before. */
function SignOut(){
  const navigate=useNavigate();const {session,setSession}=useStudentSession();const [busy,setBusy]=useState(false);
  if(session!=='signed-in')return null;
  return <button type="button" className="header-text-button" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/auth/logout','POST');setSession('signed-out');navigate('/login',{replace:true});}catch{/* the profile page shows the error */}finally{setBusy(false);}}}>{t('退出登录 / 切换账号')}</button>;
}

/** True while the header sits over the home page's night chart (light text, no fog behind it). */
function useOverNight(){
  const {pathname}=useLocation();const [over,setOver]=useState(pathname==='/');
  useEffect(()=>{
    if(pathname!=='/'){setOver(false);return;}
    let frame=0;const check=()=>{frame=0;const hero=document.querySelector('.home-hero');setOver(!!hero&&hero.getBoundingClientRect().bottom>72);};
    const onScroll=()=>{if(!frame)frame=requestAnimationFrame(check);};
    check();const late=window.setTimeout(check,200);
    window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll);
    return()=>{window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);window.clearTimeout(late);if(frame)cancelAnimationFrame(frame);};
  },[pathname]);
  return over;
}

export function SiteHeader({unread,admin}:{unread:number;admin:boolean}){
  const {session}=useStudentSession();const night=useOverNight();
  return <header className={night?'site-header is-night':'site-header'}>
    <Link className="site-brand" to={admin?'/admin':'/'} aria-label={admin?t('管理员工作台'):t('青岛科技大学崂山校区校园快递首页')}><Wordmark/>{admin&&<span className="site-brand-tag">{t('工作台')}</span>}</Link>
    {!admin&&<nav className="site-nav" aria-label={t('主导航')}>{STUDENT_NAV.map(([to,label])=><NavLink key={to} to={to} end={to==='/'}>{label}{to==='/messages'&&<UnreadDot count={unread}/>}</NavLink>)}<NavGlider/></nav>}
    <div className="site-tools" role="group" aria-label={t('工具栏')}>
      <PaletteButton/><AmbientSwitch/>
      {!admin&&(session==='signed-in'?<><NavLink className="site-account" to="/profile"><SymbolIcon name="person"/><span>{t('我的')}</span></NavLink><SignOut/></>:<NavLink className="site-account" to="/login"><span>{t('登录')}</span></NavLink>)}
    </div>
  </header>;
}

const TABS=[['/','box',t('包裹')],['/orders','order',t('订单')],['/messages','chat',t('消息')],['/tickets','ticket',t('售后')],['/profile','person',t('我的')]] as const;
export function MobileTabs({unread,hidden}:{unread:number;hidden:boolean}){
  return <nav className={hidden?'mobile-tabs hidden':'mobile-tabs'} aria-label={t('学生导航')}>{TABS.map(([to,icon,label])=><NavLink key={to} to={to} end={to==='/'}><span className="tab-icon"><SymbolIcon name={icon}/>{to==='/messages'&&<UnreadDot count={unread}/>}</span><span>{label}</span></NavLink>)}<NavGlider kind="tab"/></nav>;
}

export function SiteFooter(){
  const {pathname}=useLocation();const admin=pathname.startsWith('/admin');
  return <footer className="site-footer">
    <div className="site-footer-mark"><Wordmark/><p>{t('独立校园服务项目 · 非学校或菜鸟官方产品')}</p></div>
    {!admin&&<nav aria-label={t('校园服务')}><Link to="/guide">{t('配送说明')}</Link><Link to="/help">{t('常见问题')}</Link><Link to="/contact">{t('配送联系')}</Link><Link to="/privacy">{t('资料用途')}</Link><Link to="/admin/login">{t('管理员入口')}</Link></nav>}
  </footer>;
}
