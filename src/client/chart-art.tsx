import {useEffect,useState,type CSSProperties} from 'react';
import type {CHART as ChartData} from './chart-art-data';

/**
 * The Laoshan sea chart drawn as SVG: land contours, the coastline, sea isobaths, the station → campus route and the
 * campus fix. The path data (about 22 kB gzipped) is loaded on demand, so pages that never show the chart never pay
 * for it. Each line carries its index in --i, which the intro uses to stagger the drawing.
 * The relief is invented to read as "mountains by the sea"; it is an illustration, not a map.
 */
type Chart=typeof ChartData;
let cache:Chart|null=null,pending:Promise<Chart>|null=null;
export function loadChart(){
  if(cache)return Promise.resolve(cache);
  pending??=import('./chart-art-data').then(m=>(cache=m.CHART));
  return pending;
}
export function useChart(){
  const [chart,setChart]=useState<Chart|null>(cache);
  useEffect(()=>{if(!chart)void loadChart().then(setChart).catch(()=>{});},[chart]);
  return chart;
}
const idx=(i:number)=>({'--i':i} as CSSProperties);

export function ChartArt({className='',chart:given,slice=true}:{className?:string;chart?:Chart|null;slice?:boolean}){
  const loaded=useChart();const chart=given??loaded;
  if(!chart)return <div className={`chart-art is-loading ${className}`} aria-hidden="true"/>;
  const [cx,cy]=chart.campus,[sx,sy]=chart.station;
  const top=Math.max(...chart.contours.map(c=>c.level));
  return <svg className={`chart-art ${className}`} viewBox={`0 0 ${chart.w} ${chart.h}`} preserveAspectRatio={slice?'xMidYMid slice':'xMidYMid meet'} aria-hidden="true" focusable="false">
    <g className="chart-isobaths">{chart.isobaths.map((c,i)=><path key={i} d={c.d} style={idx(i)}/>)}</g>
    <g className="chart-contours">{chart.contours.map((c,i)=><path key={i} d={c.d} pathLength={1} className={c.level>=top*.66?'is-high':c.level<=1?'is-low':undefined} style={idx(i)}/>)}</g>
    <path className="chart-coast" d={chart.coast} pathLength={1}/>
    <path className="chart-route" d={chart.route} pathLength={1}/>
    <g className="chart-station"><rect x={sx-5} y={sy-5} width="10" height="10"/></g>
    <g className="chart-fix"><circle className="chart-fix-ring" cx={cx} cy={cy} r="15"/><circle className="chart-fix-dot" cx={cx} cy={cy} r="3.6"/></g>
  </svg>;
}
