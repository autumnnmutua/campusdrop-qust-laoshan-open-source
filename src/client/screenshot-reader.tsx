import {useEffect,useId,useRef,useState} from 'react';
import {toast} from './effects';
import {prepareImage,readCodes,type OcrProgress} from './ocr';
import {imageFiles} from './image-files';

interface Shot{id:number;name:string;preview:string;status:'queued'|'reading'|'done'|'error';codes:string[];message?:string}
const MAX_SHOTS=6;
let nextShot=1;


/**
 * Pick, paste or drop screenshots of station messages / delivery apps; each one is read on this device and the codes
 * it contains are handed to `onCodes`, which feeds them into the same review-and-register list as pasted SMS text.
 * `incoming` lets the parent pass files it received from a paste or drop on the surrounding panel.
 */
export function ScreenshotReader({onCodes,incoming,onIncomingHandled}:{onCodes:(codes:string[],label:string)=>void;incoming:File[];onIncomingHandled:()=>void}){
  const id=useId();const [shots,setShots]=useState<Shot[]>([]),[progress,setProgress]=useState<OcrProgress|null>(null);
  const queue=useRef<{shot:Shot;file:File}[]>([]),running=useRef(false),mounted=useRef(true),number=useRef(0),accepted=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const update=(sid:number,patch:Partial<Shot>)=>{if(mounted.current)setShots(list=>list.map(s=>s.id===sid?{...s,...patch}:s));};

  async function pump(){
    if(running.current)return;running.current=true;
    while(queue.current.length){
      const {shot,file}=queue.current.shift()!;update(shot.id,{status:'reading'});
      try{
        const {canvas,preview}=await prepareImage(file);update(shot.id,{preview});
        const codes=(await readCodes(canvas,p=>{if(mounted.current)setProgress(p);})).map(c=>c.pickupCode);
        update(shot.id,{status:'done',codes});
        if(codes.length)onCodes(codes,shot.name);
      }catch(e){accepted.current--;update(shot.id,{status:'error',message:(e as Error).message||'识别失败，请换一张更清晰的截图'});}
    }
    running.current=false;if(mounted.current)setProgress(null);
  }
  function add(files:File[]){
    if(!files.length)return;
    const room=MAX_SHOTS-accepted.current;
    if(room<=0){toast(`一次最多识别 ${MAX_SHOTS} 张截图`,'warn','可以先登记已识别的取件码，再继续添加');return;}
    if(files.length>room)toast(`只识别前 ${room} 张截图`,'info',`一次最多 ${MAX_SHOTS} 张`);
    const added=files.slice(0,room).map(file=>({shot:{id:nextShot++,name:`截图 ${++number.current}`,preview:'',status:'queued' as const,codes:[]},file}));
    accepted.current+=added.length;setShots(list=>[...list,...added.map(a=>a.shot)]);queue.current.push(...added);void pump();
  }
  // Files pasted or dropped on the surrounding panel arrive through `incoming`; `add` only touches refs and setters.
  const addRef=useRef(add);addRef.current=add;
  useEffect(()=>{if(incoming.length){addRef.current(incoming);onIncomingHandled();}},[incoming,onIncomingHandled]);

  const engineLoading=progress?.stage==='engine';
  return <div className="shot-reader">
    <div className="shot-actions">
      <label className="button secondary shot-pick" htmlFor={id}>📷 上传截图识别</label>
      <input id={id} type="file" accept="image/*" multiple className="sr-only" onChange={e=>{add(imageFiles(e.target.files));e.target.value='';}}/>
      <small>也可以直接粘贴（Ctrl+V）或把截图拖到这里 · 图片只在本机识别，不会上传</small>
    </div>
    {progress&&<div className="shot-progress" role="status"><span>{engineLoading?'正在准备识别引擎（首次使用约 7 MB，之后会缓存）…':`正在识别 ${Math.round(progress.progress*100)}%`}</span><progress max={1} value={engineLoading?undefined:progress.progress}/></div>}
    {shots.some(s=>s.codes.length>0)&&<p className="shot-check" role="note">图片识别偶尔会认错或漏掉数字，登记前请对照截图核对取件码；认错的可以取消勾选或直接修改上方文字。</p>}
    {shots.length>0&&<ul className="shot-list">{shots.map(s=><li key={s.id} className={`is-${s.status}`}>
      {s.preview?<img src={s.preview} alt={`${s.name}预览`}/>:<span className="shot-thumb" aria-hidden="true"/>}
      <span className="shot-info"><strong>{s.name}</strong><small>{s.status==='queued'?'等待识别':s.status==='reading'?'识别中…':s.status==='error'?s.message:s.codes.length?`找到 ${s.codes.join('、')}`:'没有找到取件码，可以裁剪到取件码附近再试'}</small></span>
    </li>)}</ul>}
  </div>;
}
