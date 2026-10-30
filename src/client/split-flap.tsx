import {useEffect,useRef,useState} from 'react';
import {prefersReducedMotion} from './motion';

/**
 * Split-flap display (the departure board at a station): each cell flips through a few characters and lands on its
 * own, left to right. Used for the 4-digit handoff code. The value is announced by the caller's aria-label; the cells
 * are decorative. With reduced motion the cells show the value at once.
 */
const DIGITS='0123456789';
function Cell({target,index}:{target:string;index:number}){
  const [cur,setCur]=useState(target),[next,setNext]=useState(target),[tick,setTick]=useState(0);
  const first=useRef(true);
  useEffect(()=>{
    if(prefersReducedMotion()){setCur(target);setNext(target);return;}
    // On first show every cell spins up from a blank; later changes (hide / show) flip straight through.
    const flips=first.current?7+index*3:4+index;first.current=false;
    let n=0,timer=0;const start=window.setTimeout(function step(){
      n++;const last=n>=flips;const ch=last?target:target==='•'?'•':DIGITS[Math.floor(Math.random()*10)];
      setNext(ch);setTick(k=>k+1);
      timer=window.setTimeout(()=>{setCur(ch);if(!last)step();},92);
    },index*70);
    return()=>{clearTimeout(start);clearTimeout(timer);};
  },[target,index]);
  const half=(ch:string,cls:string)=><span className={`flap-half ${cls}`}><i>{ch}</i></span>;
  return <span className="flap" aria-hidden="true">
    {half(next,'top')}{half(cur,'bottom')}
    {cur!==next&&<span key={tick} className="flap-fold">{half(cur,'front')}{half(next,'back')}</span>}
  </span>;
}
export function SplitFlap({value,className='',label}:{value:string;className?:string;label:string}){
  return <p className={`split-flap ${className}`} role="img" aria-label={label}>{value.split('').map((ch,i)=><Cell key={i} index={i} target={ch}/>)}</p>;
}
