import type {Worker as TesseractWorker,LoggerMessage} from 'tesseract.js';
import {mergeOcrCodes,recognizeOcrCodes,recognizePickupCodes,type RecognizedParcel} from '../shared/engagement';

/*
 * On-device screenshot recognition. The image never leaves the browser: it is decoded with createImageBitmap,
 * cleaned up on a canvas (scaled, greyscale, contrast-stretched, inverted for dark-mode screenshots) and read by a
 * self-hosted tesseract.js worker (public/ocr/<version>/, copied at build time). The engine and English model
 * (about 7 MB) download on first use only and are then cached by the browser.
 */
const BASE=`/ocr/${__OCR_VERSION__}`;
export type OcrProgress={stage:'engine'|'reading';progress:number};
let workerPromise:Promise<TesseractWorker>|null=null;
let onProgress:((p:OcrProgress)=>void)|null=null;

function logger(m:LoggerMessage){
  if(!onProgress)return;
  if(m.status==='recognizing text')onProgress({stage:'reading',progress:m.progress});
  else onProgress({stage:'engine',progress:m.progress});
}
function getWorker(){
  workerPromise??=import('tesseract.js').then(({createWorker,OEM})=>createWorker('eng',OEM.LSTM_ONLY,{
    workerPath:`${BASE}/worker.min.js`,corePath:`${BASE}/core`,langPath:`${BASE}/lang`,
    workerBlobURL:false,gzip:true,logger,
  })).catch(error=>{workerPromise=null;throw error;});
  return workerPromise;
}

/** Decode, scale to a readable size and normalise contrast. Returns the canvas OCR reads and a small preview. */
export async function prepareImage(file:Blob):Promise<{canvas:HTMLCanvasElement;preview:string}>{
  if(!file.type.startsWith('image/'))throw new Error('请选择图片文件');
  if(file.size>15*1024*1024)throw new Error('图片超过 15 MB，请截取包含取件码的部分');
  const bitmap=await createImageBitmap(file);
  const longSide=Math.max(bitmap.width,bitmap.height),scale=Math.min(3,Math.max(.5,2000/longSide));
  const w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const c=canvas.getContext('2d',{willReadFrequently:true});if(!c)throw new Error('当前浏览器不支持图片处理');
  c.imageSmoothingQuality='high';c.drawImage(bitmap,0,0,w,h);bitmap.close();
  const img=c.getImageData(0,0,w,h),d=img.data;let sum=0,min=255,max=0;
  for(let i=0;i<d.length;i+=4){const y=.299*d[i]+.587*d[i+1]+.114*d[i+2];d[i]=y;sum+=y;if(y<min)min=y;if(y>max)max=y;}
  const dark=sum/(d.length/4)<110,range=Math.max(1,max-min);
  for(let i=0;i<d.length;i+=4){let y=(d[i]-min)*255/range;if(dark)y=255-y;d[i]=d[i+1]=d[i+2]=y;}
  c.putImageData(img,0,0);
  const thumb=document.createElement('canvas'),ts=Math.min(1,160/Math.max(w,h));thumb.width=Math.round(w*ts);thumb.height=Math.round(h*ts);
  thumb.getContext('2d')?.drawImage(canvas,0,0,thumb.width,thumb.height);
  return {canvas,preview:thumb.toDataURL('image/jpeg',.7)};
}

/** A 1.3× enlarged black-and-white copy (Otsu threshold): a second view that often fixes blurred or noisy photos. */
function binarized(src:HTMLCanvasElement):HTMLCanvasElement{
  const w=Math.round(src.width*1.3),h=Math.round(src.height*1.3),out=document.createElement('canvas');out.width=w;out.height=h;
  const c=out.getContext('2d',{willReadFrequently:true});if(!c)return src;
  c.imageSmoothingQuality='high';c.drawImage(src,0,0,w,h);
  const img=c.getImageData(0,0,w,h),d=img.data,hist=new Array<number>(256).fill(0);
  for(let i=0;i<d.length;i+=4)hist[d[i]]++;
  const total=w*h;let sumAll=0;for(let t=0;t<256;t++)sumAll+=t*hist[t];
  let sumB=0,wB=0,best=0,threshold=128;
  for(let t=0;t<256;t++){wB+=hist[t];if(!wB)continue;const wF=total-wB;if(!wF)break;sumB+=t*hist[t];const between=wB*wF*(sumB/wB-(sumAll-sumB)/wF)**2;if(between>best){best=between;threshold=t;}}
  for(let i=0;i<d.length;i+=4){const v=d[i]>threshold?255:0;d[i]=d[i+1]=d[i+2]=v;}
  c.putImageData(img,0,0);return out;
}
const codesIn=(text:string)=>[...recognizePickupCodes(text),...recognizeOcrCodes(text)].map(p=>p.pickupCode);

/** Read one prepared image (two passes) and return the pickup codes found in it. */
export async function readCodes(canvas:HTMLCanvasElement,progress?:(p:OcrProgress)=>void):Promise<RecognizedParcel[]>{
  onProgress=progress?(p=>progress({...p,progress:p.stage==='reading'?p.progress/2:p.progress})):null;
  try{
    const worker=await getWorker();
    const first=codesIn((await worker.recognize(canvas)).data.text);
    if(progress)onProgress=p=>progress({...p,progress:p.stage==='reading'?.5+p.progress/2:p.progress});
    const second=codesIn((await worker.recognize(binarized(canvas))).data.text);
    return mergeOcrCodes([first,second]).map(pickupCode=>({pickupCode}));
  }finally{onProgress=null;}
}
