import {STATUS_LABELS,type Order} from '../shared/delivery';

/** Quote a cell; cells that a spreadsheet would run as a formula get a leading apostrophe (CSV injection guard). */
function cell(value:string|number):string{
  let text=String(value);
  if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;
  return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
export function toCsv(rows:(string|number)[][]):string{return '﻿'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';}
export function downloadText(filename:string,text:string,type='text/csv;charset=utf-8'){downloadBlob(filename,new Blob([text],{type}));}
export function downloadBlob(filename:string,blob:Blob){
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
/**
 * Task list for offline checking. Deliberately leaves out phone numbers and pickup codes: the file can travel further
 * than the workspace, so it carries only what is needed to match tasks to parcels on the shelf.
 */
export function exportTasksCsv(orders:Order[]){
  const header=['任务编号','状态','宿舍楼','房间','大小件','配送方式','金额（元）','取件站点','下单时间','备注'];
  const rows=orders.map(o=>[o.id.slice(0,8),STATUS_LABELS[o.status],o.dormSnapshot.buildingName,o.dormSnapshot.roomNo,o.packageSize==='SMALL'?'小件':'大件',o.deliveryMode==='ROOM'?'到寝':'楼下',(o.amountFen/100).toFixed(2),o.stationSnapshot.canonicalName,new Date(o.createdAt*1000).toLocaleString('zh-CN'),o.note]);
  const stamp=new Date().toISOString().slice(0,16).replace(/[-:T]/g,'');
  downloadText(`campusdrop-tasks-${stamp}.csv`,toCsv([header,...rows]));
}
