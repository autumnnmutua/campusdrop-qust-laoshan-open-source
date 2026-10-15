/*
 * Safe browser storage. Every access can throw (Safari private mode, blocked site data, sandboxed frames), so all
 * reads and writes go through here and quietly fall back: reads return null/empty, writes report false. Storage is
 * only ever used for per-device conveniences — never for anything the app depends on.
 */
type Area='local'|'session';
function store(area:Area):Storage|null{try{return area==='local'?window.localStorage:window.sessionStorage;}catch{return null;}}

export function getItem(key:string,area:Area='local'):string|null{try{return store(area)?.getItem(key)??null;}catch{return null;}}
export function setItem(key:string,value:string,area:Area='local'):boolean{try{const s=store(area);if(!s)return false;s.setItem(key,value);return true;}catch{return false;}}
export function removeItem(key:string,area:Area='local'):void{try{store(area)?.removeItem(key);}catch{/* nothing to remove */}}

/** JSON value that passes `valid`, or null. */
export function getJson<T>(key:string,valid:(v:unknown)=>v is T,area:Area='local'):T|null{
  const raw=getItem(key,area);if(raw===null)return null;
  try{const v=JSON.parse(raw) as unknown;return valid(v)?v:null;}catch{return null;}
}
export function setJson(key:string,value:unknown,area:Area='local'):boolean{try{return setItem(key,JSON.stringify(value),area);}catch{return false;}}

/** A short list of strings (dismissed ids, seen badges, saved notes); keeps the newest `max`. */
export function getList(key:string):string[]{return (getJson(key,Array.isArray)??[]).filter((x):x is string=>typeof x==='string');}
export function setList(key:string,list:string[],max=30):boolean{return setJson(key,list.slice(-max));}
/** Whether this browser lets the site write to the given storage at all. */
export function storageAvailable(area:Area='local'):boolean{const k='campusdrop:probe';const ok=setItem(k,'1',area);removeItem(k,area);return ok;}
