import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {NavLink,Link,useLocation} from 'react-router-dom';
import {BounceText} from './bounce-text';
import {UnreadDot} from './service-links';
import {priceFen,upgradePriceFen} from '../domain/commerce';
import {yuan} from './format';
export function SymbolIcon({name='box'}:{name?:string}){
 const paths:Record<string,ReactNode>={box:<><path d="m3 7 9-5 9 5-9 5Z" fill="currentColor" opacity=".65" stroke="none"/><path d="m3 7 9 5v10l-9-5Z" fill="currentColor" opacity=".82" stroke="none"/><path d="m12 12 9-5v10l-9 5Z" fill="currentColor" stroke="none"/><path d="m8 4.3 9 5V14" stroke="white" strokeWidth="2.5" opacity=".85"/></>,home:<><path d="m3 10 9-8 9 8v11H3Z"/><path d="M9 21v-8h6v8"/></>,map:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></>,order:<><rect x="5" y="3" width="14" height="19" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,room:<><path d="M5 22V3h14v19M8 3l8-1v20l-8-2Z"/><path d="M12 12h1"/></>,person:<><circle cx="12" cy="6" r="3"/><path d="m9 11-3 6M9 11l6 2 4 4M10 12l1 5-4 5M11 17l6 5"/></>,help:<><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5M12 17h.01"/></>,plane:<><path d="m2 10 20-8-8 20-4-8-8-4Z"/><path d="m10 14 7-7"/></>,phone:<path d="M5 3h4l2 5-3 2a13 13 0 0 0 6 6l2-3 5 2v4c0 2-3 3-5 2C8 19 4 15 2 7 1 5 3 3 5 3Z"/>,chat:<><path d="M4 5h16v11H10l-6 5Z"/><path d="M8 9h8M8 12.5h5"/></>,pause:<><circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/></>,bell:<><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 21h4"/></>,search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></>,ticket:<><path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4Z"/><path d="M9 9.5h6M9 14.5h4"/></>,guide:<><path d="M3 5c3-1 6-1 9 1v15c-3-2-6-2-9-1Z"/><path d="M21 5c-3-1-6-1-9 1v15c3-2 6-2 9-1Z"/></>,chart:<><path d="M4 20h16"/><path d="M7 16v-5M12 16V6M17 16v-8"/></>};
 return <svg className={`symbol-icon icon-${name}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.box}</svg>;
}
/**
 * Sliding highlight behind the active rail link. Position comes from the active link's offset and is written as CSS
 * custom properties; CSS animates the transform. It snaps into place on first paint and slides on later navigation.
 */
function useRailIndicator(){
 const navRef=useRef<HTMLElement>(null);const {pathname}=useLocation();
 useLayoutEffect(()=>{
  const nav=navRef.current;if(!nav)return;
  const place=()=>{const active=nav.querySelector<HTMLElement>('a.active');nav.style.setProperty('--rail-o',active?'1':'0');if(active){nav.style.setProperty('--rail-y',`${active.offsetTop}px`);nav.style.setProperty('--rail-h',`${active.offsetHeight}px`);}};
  place();
  let ready=requestAnimationFrame(()=>nav.classList.add('is-ready'));
  // Layout changes (window resize, zoom, font load) snap the highlight; only navigation slides it. The observer's
  // initial callback is skipped so it cannot cut short the slide this navigation just started.
  let initial=true;
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{
   if(initial){initial=false;return;}
   nav.classList.remove('is-ready');place();cancelAnimationFrame(ready);ready=requestAnimationFrame(()=>nav.classList.add('is-ready'));
  });
  observer?.observe(nav);
  return ()=>{cancelAnimationFrame(ready);observer?.disconnect();};
 },[pathname]);
 return navRef;
}
/** Desktop navigation: every student destination lives here, so the top bar only carries utilities. */
const RAIL_LINKS=[['/','home','首页'],['/parcel/new','box','我要下单'],['/orders','order','我的订单'],['/map','map','校园地图'],['/messages','chat','消息'],['/tickets','ticket','售后'],['/profile','room','我的寝室'],['/guide','guide','配送说明'],['/help','help','常见问题'],['/contact','phone','配送联系']] as const;
export function CampusRail({unread=0}:{unread?:number}){const navRef=useRailIndicator();return <aside className="campus-rail"><Link className="rail-brand" to="/" aria-label="青岛科技大学崂山校区校园快递首页"><span className="brand-emblem" aria-hidden="true">QUST</span><span className="rail-brand-copy"><strong>青岛科技大学</strong><small>QUST · LAOSHAN</small></span></Link><div className="rail-campus"><span className="campus-dot"/>崂山校区<span>CampusDrop</span></div><p className="rail-label">校园服务</p><nav ref={navRef} className="has-indicator" aria-label="主导航"><span className="rail-indicator" aria-hidden="true"/>{RAIL_LINKS.map(([path,icon,label])=><NavLink key={path} to={path} end={path==='/'}><SymbolIcon name={icon}/><span>{label}</span>{path==='/messages'&&<UnreadDot count={unread}/>}<b aria-hidden="true">›</b></NavLink>)}</nav><div className="rail-bottom"><Link className="rail-admin" to="/admin/login"><SymbolIcon name="person"/>管理员工作台<span aria-hidden="true">↗</span></Link><div className="rail-landscape"><p>在青科大<br/><strong><BounceText text="让期待，近一点。" variant="hover"/></strong></p><span>LAOSHAN CAMPUS / QUST</span></div><p className="rail-disclosure">独立校园服务 · 非学校官方产品</p></div></aside>;}
export function ServicePages({kind,slot}:{kind:'guide'|'help'|'contact';slot?:ReactNode}){
 return <section className="information-page"><p className="eyebrow">CAMPUSDROP / 校园服务</p><h1>{kind==='guide'?'配送说明':kind==='help'?'常见问题':'配送联系'}</h1>{kind==='guide'?<><p>在校园里，让包裹更快抵达你的身边。当前为模拟服务，所有资金操作均未发生真实扣款。</p><h2>费用计算器</h2>{slot}<h2>简单几步，安排配送</h2><ol><li>填写寝室资料，手动登记正确的取件码。</li><li>选择大小件和配送方式，确认服务端报价后模拟支付。</li><li>管理员接单后，在订单中查看联系电话及配送进度。</li></ol><p>楼下 {yuan(priceFen('SMALL','DOWNSTAIRS'))} 起；楼下升级到寝室：小件补 {yuan(upgradePriceFen('SMALL'))}，大件补 {yuan(upgradePriceFen('LARGE'))}。下单时可选“尽快送达”或预约午间、傍晚、晚间时段（满额即止）；配送员送达时当面核对订单页的 4 位收货码，核验通过即自动签收。预计送达时间根据历史配送用时或路线距离估算，仅供参考。</p><Link to="/handoff-rules">查看包裹交接与退单规则 →</Link></>:kind==='help'?<>{slot}</>:<><div className="contact-illustration"><SymbolIcon name="phone"/></div><h2>通过订单联系接单人</h2><p>进入“我的订单”，接单后会展示配送员的联系电话，可直接拨打。异常原因、归还交接和退单进度也会在订单中显示。</p><Link className="button" to="/orders">前往我的订单</Link><p className="muted">尚未接单时请等待或刷新订单。平台暂未开设在线客服、热线或即时聊天，请勿使用测试账号中的占位电话号码联系他人。</p><Link to="/help">查看常见问题 →</Link></>}</section>;
}
