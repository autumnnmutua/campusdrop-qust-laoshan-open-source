/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-558D724B29 */
import {dayLabel,slotByCode,type SlotCode} from '../shared/slots';
import {DROP_PLACE_LABELS,type DropPlace} from '../shared/campus-map';
import {getLang,t} from './i18n';

/** Shared labels are Chinese (the worker uses them too); these wrap them for the student pages in the chosen language. */
export function dayText(date:string,now:number):string{
  const zh=dayLabel(date,now);
  if(getLang()!=='en')return zh;
  if(/月/.test(zh)){const [,m,d]=date.split('-');return `${Number(d)}/${Number(m)}`;}
  return t(zh);
}
export function slotText(date:string,code:SlotCode,now:number):string{
  const s=slotByCode(code);
  return `${dayText(date,now)} ${t(s.label)} ${s.start}–${s.end}`;
}
export const placeText=(p:DropPlace)=>t(DROP_PLACE_LABELS[p]);
