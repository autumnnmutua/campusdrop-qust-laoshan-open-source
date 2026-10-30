import {useLayoutEffect,useRef,useSyncExternalStore,type ElementType} from 'react';
import {getItem,setItem} from './storage';

/*
 * 文字跳动 (bouncing text). One component, four uses — see docs/text-bounce-design.md for where each one is used:
 *   drop  — letters fall in and bounce once on first render (brand moments: the home title)
 *   pop   — every letter jumps once whenever `trigger` changes (an order status that just changed, success moments)
 *   wave  — a gentle, continuous wave (loading text, the 404 heading; never on content people read for long)
 *   hover — each letter hops while the pointer is over it (desktop only; combined with drop on the home title)
 * Screen readers get the plain text once; the per-letter spans are aria-hidden. Nothing moves under
 * prefers-reduced-motion or when the visitor switches 文字跳动 off in the 氛围 menu.
 */
export type BounceVariant='drop'|'pop'|'wave'|'hover'|'drop hover';
const KEY='campusdrop:bounce';
const listeners=new Set<()=>void>();
function read(){return getItem(KEY)!=='off';}
let enabled=typeof window==='undefined'?true:read();
function apply(){if(typeof document!=='undefined')document.documentElement.classList.toggle('no-bounce',!enabled);}
apply();
export function setBounceEnabled(on:boolean){enabled=on;setItem(KEY,on?'on':'off');apply();listeners.forEach(l=>l());}
export const isBounceEnabled=()=>enabled;
export function useBounceEnabled(){return useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l);},()=>enabled,()=>true);}

/** Latin words stay together (so English titles wrap between words); CJK characters and spaces stay single. */
function words(chars:string[]):[number,string[]][]{
  // Closing punctuation (。，！？…) never starts a line, so it is kept with the character before it.
  const latin=/[A-Za-z0-9'’.,!?-]/,closing=/[，。！？、；：”’）》」』…]/,out:[number,string[]][]=[];
  chars.forEach((ch,i)=>{const last=out.at(-1);if(last&&((latin.test(ch)&&latin.test(last[1].at(-1)!))||closing.test(ch)))last[1].push(ch);else out.push([i,[ch]]);});
  return out;
}
export function BounceText({text,variant='pop',trigger,playOnMount=true,as:Tag='span',className}:{text:string;variant?:BounceVariant;trigger?:unknown;playOnMount?:boolean;as?:ElementType;className?:string}){
  const ref=useRef<HTMLElement>(null),lastTrigger=useRef(trigger);
  const chars=Array.from(text);
  // Stagger through a CSS custom property (CSSOM, allowed by the style-src 'self' CSP).
  useLayoutEffect(()=>{ref.current?.querySelectorAll<HTMLElement>('.bt-c').forEach((el,i)=>el.style.setProperty('--i',String(i)));},[text]);
  // pop: restart the one-shot animation each time the trigger value changes. Comparing with the previous value (not a
  // "first render" flag) keeps StrictMode's double effect run from replaying it on mount.
  useLayoutEffect(()=>{
    if(Object.is(lastTrigger.current,trigger))return;lastTrigger.current=trigger;
    const el=ref.current;if(!el||!variant.includes('pop'))return;
    el.classList.remove('bt-play');void el.offsetWidth;el.classList.add('bt-play');
  },[trigger,variant]);
  const play=variant.includes('pop')&&playOnMount?' bt-play':'';
  return <Tag ref={ref} className={`bt ${variant.split(' ').map(v=>`bt-${v}`).join(' ')}${play}${className?' '+className:''}`}>
    <span className="sr-only">{text}</span>
    <span className="bt-chars" aria-hidden="true">{words(chars).map(([start,word])=>word.length>1
      ?<span key={start} className="bt-w">{word.map((ch,j)=><span key={j} className="bt-c">{ch}</span>)}</span>
      :<span key={start} className="bt-c">{word[0]===' '?' ':word[0]}</span>)}</span>
  </Tag>;
}
