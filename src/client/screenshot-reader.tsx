import {t} from './i18n';
import {useEffect,useId,useRef,useState} from 'react';
import {toast} from './effects';
import {prepareImage,readCodes,type OcrProgress} from './ocr';
import {imageFiles} from './image-files';

interface Shot{id:number;name:string;preview:string;status:'queued'|'reading'|'done'|'error';codes:string[];message?:string;vision?:'ask'|'busy'|'done'|'error';visionMessage?:string}
const MAX_SHOTS=6;
let nextShot=1;
// v3.6: whether this site offers the model fallback (asked once per page load).
type VisionInfo={vision:boolean;visionModel:string|null};
let visionStatus:Promise<VisionInfo>|null=null;
const visionInfo=()=>visionStatus??=fetch('/api/v1/assistant/status',{credentials:'same-origin'}).then(async r=>r.ok?await r.json() as VisionInfo:{vision:false,visionModel:null}).catch(()=>({vision:false,visionModel:null}));
/** Downscale to a JPEG the server accepts (≤ 780 KB): long side 1600 px, then lower quality / size if needed. */
async function visionJpeg(file:Blob):Promise<Blob>{
  const bitmap=await createImageBitmap(file);
  try{
    for(const [side,quality] of [[1600,.85],[1600,.7],[1200,.7],[900,.6]] as const){
      const scale=Math.min(1,side/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
      canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      const c=canvas.getContext('2d');if(!c)break;c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/jpeg',quality));
      if(blob&&blob.size<=780*1024)return blob;
    }
  }finally{bitmap.close();}
  throw new Error(t('图片过大，请裁剪到取件码附近再试'));
}


/**
 * Pick, paste or drop screenshots of station messages / delivery apps; each one is read on this device and the codes
 * it contains are handed to `onCodes`, which feeds them into the same review-and-register list as pasted SMS text.
 * `incoming` lets the parent pass files it received from a paste or drop on the surrounding panel.
 */
export function ScreenshotReader({onCodes,incoming,onIncomingHandled}:{onCodes:(codes:string[],label:string)=>void;incoming:File[];onIncomingHandled:()=>void}){
  const id=useId();const [shots,setShots]=useState<Shot[]>([]),[progress,setProgress]=useState<OcrProgress|null>(null);
  const shotFiles=useRef(new Map<number,File>()),[vision,setVision]=useState<{vision:boolean;visionModel:string|null}>({vision:false,visionModel:null});
  useEffect(()=>{let on=true;void visionInfo().then(v=>{if(on)setVision(v);});return()=>{on=false;};},[]);
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
      }catch(e){accepted.current--;update(shot.id,{status:'error',message:(e as Error).message||t('识别失败，请换一张更清晰的截图')});}
    }
    running.current=false;if(mounted.current)setProgress(null);
  }
  function add(files:File[]){
    if(!files.length)return;
    const room=MAX_SHOTS-accepted.current;
    if(room<=0){toast(t('一次最多识别 {0} 张截图',{0:MAX_SHOTS}),'warn',t('可以先登记已识别的取件码，再继续添加'));return;}
    if(files.length>room)toast(t('只识别前 {0} 张截图',{0:room}),'info',t('一次最多 {0} 张',{0:MAX_SHOTS}));
    const added=files.slice(0,room).map(file=>({shot:{id:nextShot++,name:t('截图 {0}',{0:++number.current}),preview:'',status:'queued' as const,codes:[]},file}));
    added.forEach(a=>shotFiles.current.set(a.shot.id,a.file));accepted.current+=added.length;setShots(list=>[...list,...added.map(a=>a.shot)]);queue.current.push(...added);void pump();
  }
  // Files pasted or dropped on the surrounding panel arrive through `incoming`; `add` only touches refs and setters.
  const addRef=useRef(add);addRef.current=add;
  useEffect(()=>{if(incoming.length){addRef.current(incoming);onIncomingHandled();}},[incoming,onIncomingHandled]);

  async function askModel(shot:Shot){
    const file=shotFiles.current.get(shot.id);if(!file)return;
    update(shot.id,{vision:'busy',visionMessage:''});
    try{
      const jpeg=await visionJpeg(file);
      const response=await fetch('/api/v1/parcels/vision',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'image/jpeg'},body:jpeg});
      const result=await response.json().catch(()=>null) as {codes?:string[];error?:{message?:string}}|null;
      if(!response.ok||!result?.codes)throw new Error(result?.error?.message??t('大模型暂时没有响应，请稍后再试或手动填写'));
      const fresh=result.codes.filter(c=>!shot.codes.includes(c));
      update(shot.id,{vision:'done',codes:[...shot.codes,...fresh],visionMessage:result.codes.length?t('大模型找到 {0}',{0:result.codes.join('、')}):t('大模型也没有找到取件码')});
      if(fresh.length)onCodes(fresh,shot.name);
    }catch(e){update(shot.id,{vision:'error',visionMessage:(e as Error).message});}
  }
  const engineLoading=progress?.stage==='engine';
  return <div className="shot-reader">
    <div className="shot-actions">
      <label className="button secondary shot-pick" htmlFor={id}>{t('📷 上传截图识别')}</label>
      <input id={id} type="file" accept="image/*" multiple className="sr-only" onChange={e=>{add(imageFiles(e.target.files));e.target.value='';}}/>
      <small>{vision.vision?t('也可以直接粘贴（Ctrl+V）或把截图拖到这里 · 默认只在本机识别；认不出时可以选择交给大模型识别'):t('也可以直接粘贴（Ctrl+V）或把截图拖到这里 · 图片只在本机识别，不会上传')}</small>
    </div>
    {progress&&<div className="shot-progress" role="status"><span>{engineLoading?t('正在准备识别引擎（首次使用约 7 MB，之后会缓存）…'):t('正在识别 {0}%',{0:Math.round(progress.progress*100)})}</span><progress max={1} value={engineLoading?undefined:progress.progress}/></div>}
    {shots.some(s=>s.codes.length>0)&&<p className="shot-check" role="note">{t('图片识别偶尔会认错或漏掉数字，登记前请对照截图核对取件码；认错的可以取消勾选或直接修改上方文字。')}</p>}
    {shots.length>0&&<ul className="shot-list">{shots.map(s=><li key={s.id} className={`is-${s.status}`}>
      {s.preview?<img src={s.preview} alt={t('{0}预览',{0:s.name})}/>:<span className="shot-thumb" aria-hidden="true"/>}
      <span className="shot-info"><strong>{s.name}</strong><small>{s.status==='queued'?t('等待识别'):s.status==='reading'?t('识别中…'):s.status==='error'?s.message:s.codes.length?t('找到 {0}',{0:s.codes.join('、')}):t('没有找到取件码，可以裁剪到取件码附近再试')}</small>
        {s.visionMessage&&<small className={s.vision==='error'?'shot-vision-error':'shot-vision-result'}>{s.visionMessage}</small>}
        {vision.vision&&(s.status==='done'||s.status==='error')&&s.vision!=='done'&&(s.vision==='ask'||s.vision==='busy'?<span className="shot-vision-ask"><small>{t('这张截图会发送给本站配置的大模型（{0}）识别，识别后不保存。',{0:vision.visionModel??''})}</small>
          <span><button type="button" className="text-button" disabled={s.vision==='busy'} onClick={()=>void askModel(s)}>{s.vision==='busy'?t('识别中…'):t('确认发送')}</button><button type="button" className="text-button" disabled={s.vision==='busy'} onClick={()=>update(s.id,{vision:undefined})}>{t('取消')}</button></span></span>
          :<button type="button" className="text-button shot-vision" onClick={()=>update(s.id,{vision:'ask'})}>{s.codes.length?t('用大模型再核对一次'):t('用大模型识别')}</button>)}</span>
    </li>)}</ul>}
  </div>;
}
