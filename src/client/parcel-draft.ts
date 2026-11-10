import {getJson,removeItem,setJson} from './storage';

const DRAFT_KEY='campusdrop:parcel-draft';
type Draft={ownerId:string;entry:string;code:string;station:string;carrier:string;note:string;size:string};
const keyFor=(ownerId:string)=>`${DRAFT_KEY}:${encodeURIComponent(ownerId)}`;
const validFor=(ownerId:string)=>(v:unknown):v is Draft=>{
  const d=v as Draft|null;
  return !!d&&d.ownerId===ownerId&&['entry','code','station','carrier','note','size'].every(k=>typeof d[k as keyof Draft]==='string');
};
const legacyDraft=(ownerId:string)=>getJson(DRAFT_KEY,validFor(ownerId),'session');

export function readDraft(ownerId:string):Draft|null{
  return getJson(keyFor(ownerId),validFor(ownerId),'session')??legacyDraft(ownerId);
}
export function writeDraft(d:Draft){
  const key=keyFor(d.ownerId);
  const saved=d.code||d.note||d.carrier?setJson(key,d,'session'):(removeItem(key,'session'),true);
  // Only remove an older draft after it was saved successfully, and only for its owner.
  if(saved&&legacyDraft(d.ownerId))removeItem(DRAFT_KEY,'session');
}
export function clearDraft(ownerId:string|null){
  if(!ownerId)return;
  removeItem(keyFor(ownerId),'session');
  if(legacyDraft(ownerId))removeItem(DRAFT_KEY,'session');
}
