import {useEffect,useRef,useState} from 'react';
import {ChartArt} from '../chart-art';
import {SeaChart,lookForTheme,type ChartViewport} from './renderer';
import {useResolvedTheme} from '../theme';

const reducedMotion=()=>typeof window!=='undefined'&&!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let glFailed=false;

/**
 * A live sea chart on a canvas. `view` maps the canvas' CSS box to the chart sheet; it is recomputed on resize.
 * Pointer movement over `pointerTarget` (default: the canvas' parent) bends the contours like a sonar lens and a tap
 * sends a ring outwards. With reduced motion a single still frame is drawn; without WebGL the SVG chart is shown and
 * onFail is called (the opening uses it to step aside at once).
 */
export function SeaChartView({className='',view,onChart,onFail,interactive=true,pointerTarget}:{className?:string;view:(w:number,h:number)=>ChartViewport;onChart?:(chart:SeaChart)=>void;onFail?:()=>void;interactive?:boolean;pointerTarget?:()=>HTMLElement|null}){
  const ref=useRef<HTMLCanvasElement>(null);const [failed,setFailed]=useState(glFailed);
  const look=lookForTheme(useResolvedTheme());const lookRef=useRef(look);lookRef.current=look;const chartRef=useRef<SeaChart|null>(null);
  const viewRef=useRef(view);viewRef.current=view;
  const onChartRef=useRef(onChart);onChartRef.current=onChart;
  const onFailRef=useRef(onFail);onFailRef.current=onFail;
  useEffect(()=>{if(failed)onFailRef.current?.();},[failed]);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas||failed)return;
    const chart=SeaChart.create(canvas,{look:lookRef.current});
    if(!chart){glFailed=true;setFailed(true);return;}
    chartRef.current=chart;
    const place=()=>{const {width,height}=chart.size;chart.setView(viewRef.current(width,height));};
    place();onChartRef.current?.(chart);
    const still=reducedMotion();
    if(!still)chart.start();else chart.draw();
    const host=pointerTarget?.()??canvas.parentElement;
    const move=(e:PointerEvent)=>{const r=canvas.getBoundingClientRect();const x=e.clientX-r.left,y=e.clientY-r.top;chart.pointer(x,y,x>=0&&y>=0&&x<=r.width&&y<=r.height);};
    const leave=()=>chart.pointer(-9999,-9999,false);
    const down=(e:PointerEvent)=>{const r=canvas.getBoundingClientRect();chart.pulse(e.clientX-r.left,e.clientY-r.top);};
    if(interactive&&!still&&host){host.addEventListener('pointermove',move,{passive:true});host.addEventListener('pointerleave',leave);host.addEventListener('pointerdown',down,{passive:true});}
    const onResize=()=>{chart.measure();place();};
    window.addEventListener('resize',onResize);
    return()=>{window.removeEventListener('resize',onResize);host?.removeEventListener('pointermove',move);host?.removeEventListener('pointerleave',leave);host?.removeEventListener('pointerdown',down);chart.destroy();chartRef.current=null;};
  },[failed,interactive,pointerTarget]);
  useEffect(()=>{chartRef.current?.setLook(look);},[look]);
  if(failed)return <ChartArt className={className}/>;
  return <canvas ref={ref} className={`sea-chart ${className}`} aria-hidden="true"/>;
}
