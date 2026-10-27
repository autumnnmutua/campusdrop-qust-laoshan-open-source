import dialogPolyfill from 'dialog-polyfill';
import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {SymbolIcon} from './campus-design';
import {AMBIENT_LABELS,celebrate,setAmbientMode,toast,type AmbientMode} from './effects';
import {openOnboarding} from './engagement-ui';
import {isBounceEnabled,setBounceEnabled} from './bounce-text';
import {disableNotify,enableNotify,pushEnabled,useNotifyState} from './notify';

/* ================================================================== arrival reminders toggle */
export function NotifyToggle({compact=false}:{compact?:boolean}){
  const state=useNotifyState();const [busy,setBusy]=useState(false);
  if(state==='unsupported')return compact?null:<p className="notify-toggle muted">当前浏览器不支持系统通知；订单页打开时仍会实时提示状态变化。</p>;
  async function toggle(){
    if(state==='on'){disableNotify();toast('已关闭到达提醒','info');return;}
    setBusy(true);const r=await enableNotify();setBusy(false);
    if(r==='on')toast('到达提醒已开启','success',pushEnabled()?'即使关闭网页，配送进度和配送员消息也会推送到这台设备':'订单状态变化时会弹出系统通知');
    else if(r==='denied')toast('浏览器拒绝了通知权限','warn','可以在浏览器的网站设置里允许通知后再试');
    else if(r==='blocked')toast('这个浏览器只允许已安装的应用发通知','warn','可以先“添加到主屏幕”，或改用电脑浏览器');
  }
  return <div className={`notify-toggle${compact?' compact':''}`}>
    <label className="switch"><input type="checkbox" checked={state==='on'} disabled={busy||state==='denied'} onChange={()=>void toggle()}/><span><strong>到达提醒</strong><small>{state==='denied'?'通知权限已被拒绝，请在浏览器网站设置里允许':state==='on'?(pushEnabled()?'已开启推送：即使关闭网页，状态变化和配送员消息也会通知你':'已开启：页面在后台时，状态变化会弹出系统通知'):'包裹送到楼下或寝室时，即使切到其他页面也提醒你'}</small></span></label>
  </div>;
}

/* ================================================================== network status */
/** Thin banner while the browser reports being offline; a toast once the connection is back. */
export function NetworkStatus(){
  const online=useSyncExternalStore(l=>{window.addEventListener('online',l);window.addEventListener('offline',l);return()=>{window.removeEventListener('online',l);window.removeEventListener('offline',l);};},()=>navigator.onLine,()=>true);
  const was=useRef(online);
  useEffect(()=>{if(!was.current&&online)toast('网络已恢复','success','可以继续操作了');was.current=online;},[online]);
  if(online)return null;
  return <div className="offline-banner" role="status"><span aria-hidden="true">⚡</span>网络已断开。页面内容可能不是最新的，恢复连接后请刷新或重试刚才的操作。</div>;
}

/* ================================================================== command palette */
interface Command{id:string;label:string;hint:string;keywords:string;icon:string;run:(go:(to:string)=>void)=>void}
const nav=(id:string,label:string,to:string,icon:string,keywords:string,hint=to):Command=>({id,label,hint,keywords,icon,run:go=>go(to)});
const STUDENT:Command[]=[
  nav('home','首页 · 我的包裹','/','home','shouye baoguo home 包裹 首页'),
  nav('new','添加快递','/parcel/new','box','tianjia xiadan 下单 登记 取件码 new'),
  nav('sms','粘贴短信 / 上传截图识别取件码','/parcel/new','chat','duanxin 短信 识别 批量 sms jietu 截图 图片 拍照 ocr','/parcel/new · 批量登记'),
  nav('orders','我的订单','/orders','order','dingdan 订单 进度 orders'),
  nav('profile','我的寝室与配送足迹','/profile','room','qinshi 寝室 地址 徽章 足迹 提醒 profile'),
  nav('share','生成配送足迹分享卡片','/profile','plane','fenxiang 分享 卡片 图片 足迹 share','/profile · 足迹下方'),
  nav('messages','站内消息','/messages','chat','xiaoxi 消息 通知 messages'),
  nav('tickets','我的售后','/tickets','help','shouhou 售后 工单 退款 tickets'),
  nav('ticket-new','发起售后工单','/tickets/new','help','shouhou 售后 投诉 问题'),
  nav('guide','配送说明与费用计算器','/guide','order','peisong 说明 费用 价格 计算 guide'),
  nav('help','常见问题','/help','help','wenti faq 常见问题 帮助 help'),
  nav('contact','配送联系','/contact','phone','lianxi 联系 电话 contact'),
  nav('rules','包裹交接与退单规则','/handoff-rules','order','jiaojie 交接 退单 规则'),
];
const ADMIN:Command[]=[
  nav('a-tasks','配送工作台','/admin','order','renwu 任务 接单 工作台 admin'),
  nav('a-analytics','数据看板','/admin/analytics','order','shuju 看板 统计 数据 analytics'),
  nav('a-batches','批次管理','/admin/batches','box','pici 批次 batches'),
  nav('a-route','打印配送路线单','/admin/route-sheet','order','luxian 路线 打印 配送单 route print'),
  nav('a-tickets','售后工单（管理）','/admin/tickets','help','shouhou 售后 工单'),
  nav('a-ann','公告管理','/admin/announcements','chat','gonggao 公告 通知 announcements'),
  nav('a-admins','管理员与授权','/admin/admins','person','guanliyuan 管理员 权限'),
  nav('a-audit','审计日志','/admin/audit','order','shenji 审计 日志 audit'),
  nav('a-account','我的授权与联系电话','/admin/account','person','zhanghao 账号 授权 电话'),
];
const ACTIONS:Command[]=[
  ...(['auto','snow','sakura','bokeh','leaves','off'] as AmbientMode[]).map(m=>({id:`amb-${m}`,label:`氛围：${AMBIENT_LABELS[m]}`,hint:'切换页面动效',keywords:`fenwei 氛围 动效 粒子 ${m} ${AMBIENT_LABELS[m]} ${m==='snow'?'xuehua 雪花':m==='sakura'?'yinghua 樱花':m==='leaves'?'luoye 落叶':m==='bokeh'?'guangban 光斑':m==='off'?'guanbi 关闭':'jijie 季节'}`,icon:'plane',run:()=>{setAmbientMode(m);toast(`氛围已切换为“${AMBIENT_LABELS[m]}”`,'info');}})),
  {id:'bounce',label:'开关文字跳动效果',hint:'标题、状态变化等处的文字跳动',keywords:'tiaodong 跳动 文字 动画 bounce',icon:'plane',run:()=>{const on=!isBounceEnabled();setBounceEnabled(on);toast(on?'已开启文字跳动':'已关闭文字跳动','info');}},
  {id:'onboarding',label:'重新查看新手引导',hint:'3 步了解下单流程',keywords:'yindao 引导 教程 新手 帮助',icon:'help',run:()=>openOnboarding()},
  nav('game','休息一下：接包裹小游戏','/play','box','youxi 游戏 小游戏 game play 彩蛋'),
];
let paletteOpen=false;const paletteListeners=new Set<()=>void>();
export function openCommandPalette(){paletteOpen=true;paletteListeners.forEach(l=>l());}
function closePalette(){paletteOpen=false;paletteListeners.forEach(l=>l());}
/** Ctrl/⌘ + K quick jump: pages, admin pages (on admin routes) and a few actions. Keyboard and screen-reader friendly. */
export function CommandPalette(){
  const open=useSyncExternalStore(l=>{paletteListeners.add(l);return()=>paletteListeners.delete(l);},()=>paletteOpen,()=>false);
  const ref=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);const [q,setQ]=useState(''),[index,setIndex]=useState(0);
  const navigate=useNavigate(),{pathname}=useLocation(),id=useId();const admin=pathname.startsWith('/admin');
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(paletteOpen)closePalette();else openCommandPalette();}};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[]);
  useEffect(()=>{const d=ref.current;if(!d)return;if(typeof d.showModal!=='function')dialogPolyfill.registerDialog(d);if(open&&!d.open){setQ('');setIndex(0);d.showModal();requestAnimationFrame(()=>input.current?.focus());}if(!open&&d.open)d.close();},[open]);
  const all=useMemo(()=>admin?[...ADMIN,...STUDENT.slice(0,1),...ACTIONS.filter(a=>a.id==='game')]:[...STUDENT,...ACTIONS],[admin]);
  const list=useMemo(()=>{const t=q.trim().toLowerCase();if(!t)return all;return all.filter(c=>(c.label+' '+c.keywords+' '+c.hint).toLowerCase().includes(t));},[all,q]);
  const current=Math.min(index,Math.max(0,list.length-1));
  function run(c:Command|undefined){if(!c)return;closePalette();c.run(to=>navigate(to));}
  return <dialog ref={ref} className="command-palette" aria-label="快速跳转" onClose={()=>{if(paletteOpen)closePalette();}} onClick={e=>{if(e.target===ref.current)closePalette();}}>
    <div className="palette-search"><SymbolIcon name="search"/><input ref={input} role="combobox" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={list[current]?`${id}-${list[current].id}`:undefined} aria-autocomplete="list" placeholder="搜索页面或操作，例如：订单、雪花、公告" value={q} onChange={e=>{setQ(e.target.value);setIndex(0);}}
      onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setIndex((current+1)%Math.max(1,list.length));}else if(e.key==='ArrowUp'){e.preventDefault();setIndex((current-1+list.length)%Math.max(1,list.length));}else if(e.key==='Enter'){e.preventDefault();run(list[current]);}}}/><kbd>Esc</kbd></div>
    <ul id={`${id}-list`} role="listbox" aria-label="搜索结果">{list.map((c,i)=><li key={c.id} id={`${id}-${c.id}`} role="option" aria-selected={i===current} className={i===current?'is-active':undefined} onPointerMove={()=>setIndex(i)} onClick={()=>run(c)}><SymbolIcon name={c.icon}/><span>{c.label}<small>{c.hint}</small></span><b aria-hidden="true">↵</b></li>)}</ul>
    {!list.length&&<p className="muted palette-empty">没有找到“{q}”，换个关键词试试。</p>}
    <p className="palette-foot" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>↵</kbd> 打开 <kbd>Ctrl</kbd>+<kbd>K</kbd> 随时唤起</p>
  </dialog>;
}
export function PaletteButton(){
  return <button type="button" className="palette-button" onClick={openCommandPalette} title="快速跳转（Ctrl+K）"><SymbolIcon name="search"/><span>搜索</span><kbd>Ctrl K</kbd></button>;
}

/* ================================================================== easter egg */
const KONAMI=['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
/**
 * ↑↑↓↓←→←→BA on a keyboard, or five quick taps on the home page title on a phone: a triple confetti burst and a hint
 * at the hidden game. Typing in form fields never counts.
 */
export function useEasterEgg(enabled:boolean){
  useEffect(()=>{
    if(!enabled)return;
    let pos=0,taps:number[]=[];
    const fire=()=>{
      const w=window.innerWidth,h=window.innerHeight;
      [[.2,.4],[.5,.3],[.8,.4]].forEach(([x,y],i)=>setTimeout(()=>celebrate({origin:{x:w*x,y:h*y},count:70}),i*260));
      toast('你发现了隐藏彩蛋！','success','按 Ctrl+K 搜索“游戏”，还有一个接包裹小游戏');
    };
    const onKey=(e:KeyboardEvent)=>{
      const t=e.target as HTMLElement|null;if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;
      const k=e.key.length===1?e.key.toLowerCase():e.key;
      pos=k===KONAMI[pos]?pos+1:k===KONAMI[0]?1:0;
      if(pos===KONAMI.length){pos=0;fire();}
    };
    const onTap=(e:PointerEvent)=>{
      if(!(e.target as Element|null)?.closest?.('.home-hero h1'))return;
      const now=Date.now();taps=[...taps.filter(x=>now-x<2500),now];
      if(taps.length>=5){taps=[];fire();}
    };
    window.addEventListener('keydown',onKey);document.addEventListener('pointerdown',onTap);
    return()=>{window.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onTap);};
  },[enabled]);
}
