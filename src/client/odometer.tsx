import {useEffect,useState,type CSSProperties} from 'react';
import {prefersReducedMotion} from './motion';

/**
 * A rolling-drum figure, like a meter: each digit is a column of 0–9 that rolls to its value, the columns further right
 * rolling longer, so a price that changes from ¥2.50 to ¥3.00 visibly turns over. Other characters (¥ . ,) stand still.
 * The figure is read out once, as text; the drums are decorative. With reduced motion the figure simply changes.
 */
export function Odometer({value,format,className=''}:{value:number;format:(n:number)=>string;className?:string}){
  const text=format(value);
  // Start from zeros on first paint so the drums roll in, then follow the value.
  const [shown,setShown]=useState(()=>prefersReducedMotion()?text:text.replace(/\d/g,'0'));
  useEffect(()=>{const id=requestAnimationFrame(()=>setShown(text));return()=>cancelAnimationFrame(id);},[text]);
  const chars=shown.split('');let digitIndex=0;const digits=chars.filter(c=>/\d/.test(c)).length;
  return <span className={`odometer ${className}`}><span className="sr-only">{text}</span><span aria-hidden="true">{chars.map((c,i)=>{
    if(!/\d/.test(c))return <span key={`s${i}`} className="odo-sym">{c}</span>;
    const k=digitIndex++,d=Number(c);
    // Keyed from the right, so adding a leading digit does not reshuffle the drums under it.
    return <span key={`d${digits-k}`} className="odo-col"><span className="odo-reel" style={{'--d':d,'--k':k} as CSSProperties}>{'0123456789'.split('').map(n=><span key={n}>{n}</span>)}</span></span>;
  })}</span></span>;
}
