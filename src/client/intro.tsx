import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {inWeChat} from './wechat';
import {getItem,setItem} from './storage';
import {BrandMark} from './chart-shell';
import {t} from './i18n';
import {SeaChartView} from './sea-chart/SeaChartView';
import {chartTime,coverView,holdOtherCharts,setLightOrigin,type SeaChart} from './sea-chart/renderer';

/*
 * Opening, once per browser session — "声呐成图" (charted by sonar). In deep water a sonar sweep turns once around the
 * campus; every contour it passes lights up and settles. The route from the station ignites, a light runs along it to
 * the campus fix, and the name is written in stroke, then filled. The whole screen then closes down onto the home
 * page's chart (the same live chart, at the same instant and mapping), so there is no cut. About 3 s; any tap or key
 * skips it. Skipped for reduced motion, the admin workspace, automated browsers and repeat visits; ?intro=1 replays it.
 */
const KEY='campusdrop:intro-seen';
const SWEEP_FROM=.25,SWEEP_FOR=1.5,ROUTE_FROM=1.55,ROUTE_FOR=.55,LIGHT_FROM=1.95,LIGHT_FOR=.8,LEAVE_AT=3.0,LEAVE_FOR=.75;
function shouldShow(){
  if(typeof window==='undefined')return false;
  if(new URLSearchParams(window.location.search).has('intro'))return true;
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||navigator.webdriver)return false;
  if(window.location.pathname.startsWith('/admin')||window.location.hash.startsWith('#/admin'))return false;
  // Inside WeChat every link opened from a chat is a new browser session: there the opening shows at most every 12 hours.
  if(inWeChat){const last=Number(getItem(KEY)??0);return !(last&&Date.now()-last<12*3600*1000);}
  return !getItem(KEY,'session');
}
/** Development capture (a script drives the clock): real-time safety nets are skipped so they cannot cut a frame-by-frame capture short. */
const captured=()=>import.meta.env.DEV&&typeof (window as Window&{__cdClock?:number}).__cdClock==='number';
const ease=(x:number)=>{x=Math.min(1,Math.max(0,x));return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;};
const heroBox=()=>document.querySelector('.home-hero')?.getBoundingClientRect()??null;
/** The same mapping the home hero uses (see heroView in student-delivery), from the hero's real height when present. */
function introView(){
  const band=heroBox()?.height??(window.innerWidth<=720?window.innerHeight*.84:Math.min(window.innerHeight*.86,780));
  return coverView(window.innerWidth,window.innerHeight,{focusY:window.innerWidth<=720?.8:.7,band});
}

export function IntroSplash(){
  const [show,setShow]=useState(shouldShow),[phase,setPhase]=useState<'play'|'leave'>('play');
  const [clip,setClip]=useState<CSSProperties|undefined>();const start=useRef(0);const timers=useRef<number[]>([]);const leaving=useRef<{at:number;dur:number}|null>(null);
  const finish=useCallback(()=>{timers.current.forEach(clearTimeout);holdOtherCharts(null);setShow(false);},[]);
  const leave=useCallback((fast=false)=>{
    const box=heroBox();
    if(box&&!fast){
      // Close the screen down onto the hero: clip from the full viewport to the hero's box.
      // …and fade its lower part like the hero's chart (from 58 % of the hero's height to its bottom edge).
      const top=Math.max(0,box.top),bottom=Math.min(window.innerHeight,box.bottom);
      setClip({'--ct':`${top}px`,'--cr':`${Math.max(0,window.innerWidth-box.right)}px`,'--cb':`${Math.max(0,window.innerHeight-box.bottom)}px`,'--cl':`${Math.max(0,box.left)}px`,'--fs':`${(box.top+box.height*.58).toFixed(0)}px`,'--fe':`${bottom.toFixed(0)}px`} as CSSProperties);
    }
    const dur=fast?.35:LEAVE_FOR;leaving.current={at:chartTime(),dur};
    setPhase('leave');if(!captured())timers.current.push(window.setTimeout(finish,(dur+1.5)*1000));
  },[finish]);
  const phaseRef=useRef(phase);phaseRef.current=phase;
  const onChart=useCallback((chart:SeaChart)=>{
    // The sequence runs on the frames actually drawn: it starts at the first frame (shader compilation can take a
    // second or more on a slow GPU) and a stall between frames pauses it rather than skipping ahead.
    let last=-1;
    holdOtherCharts(chart);
    chart.state={sweep:0,routeT:0,light:0,lightA:0,fix:0};
    chart.onFrame=now=>{
      if(last<0)start.current=now;else if(now-last>.25)start.current+=now-last-1/60;
      if(last<0||now-last>.25)setLightOrigin(start.current+LIGHT_FROM+LIGHT_FOR-4);
      last=now;
      const e=now-start.current;
      chart.state.fix=ease((e-.05)/.3);
      chart.state.sweep=e<SWEEP_FROM+SWEEP_FOR?ease((e-SWEEP_FROM)/SWEEP_FOR)*6.2832:7;
      chart.state.routeT=ease((e-ROUTE_FROM)/ROUTE_FOR);
      chart.state.light=ease((e-LIGHT_FROM)/LIGHT_FOR);chart.state.lightA=e>LIGHT_FROM?1:0;
      // Scheduled on the chart's clock, not a timer: the sequence never runs ahead of what has been drawn.
      if(e>=LEAVE_AT&&phaseRef.current==='play'){phaseRef.current='leave';leave();}
      if(leaving.current&&now-leaving.current.at>=leaving.current.dur)finish();
    };
    // The hero's light picks up exactly where this one stops (resting at the campus): set above, whenever the start moves.
  },[leave,finish]);
  useEffect(()=>{
    if(!show)return;
    setItem(KEY,'1','session');if(inWeChat)setItem(KEY,String(Date.now()));
    document.documentElement.classList.add('intro-open');
    // Safety net if frames are not drawn, or drawn very slowly (a background tab, a lost GPU context, a weak GPU).
    if(!captured())timers.current.push(window.setTimeout(()=>leave(),(LEAVE_AT+2.5)*1000));
    const onKey=(e:KeyboardEvent)=>{if(e.key!=='Tab')leave(true);};
    window.addEventListener('keydown',onKey);
    const list=timers.current;
    return()=>{list.forEach(clearTimeout);holdOtherCharts(null);window.removeEventListener('keydown',onKey);document.documentElement.classList.remove('intro-open');};
  },[show,leave]);
  if(!show)return null;
  return <div className={`intro is-${phase}${clip?' is-docking':''}`} style={clip} onClick={()=>leave(true)}>
    <SeaChartView className="intro-chart" view={introView} onChart={onChart} onFail={finish} interactive={false}/>
    <div className="intro-title" aria-hidden="true">
      <span className="intro-mark"><BrandMark size={52}/></span>
      <svg className="intro-name" viewBox="0 0 620 120"><text x="4" y="92">CampusDrop</text></svg>
      <span className="intro-place">{t('青岛科技大学 · 崂山校区')}</span>
    </div>
    <button type="button" className="intro-skip" onClick={e=>{e.stopPropagation();leave(true);}}>{t('跳过')}</button>
  </div>;
}
