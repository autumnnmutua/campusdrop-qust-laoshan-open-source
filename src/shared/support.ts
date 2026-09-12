import {z} from 'zod';
import type {OrderStatus} from './delivery';
export const supportText=z.string().trim().min(1).max(1000).refine(v=>!/[<>\p{Cc}]/u.test(v),'请使用普通文字描述');
export const ticketCreate=z.object({orderId:z.uuid(),category:z.enum(['NOT_RECEIVED','DAMAGED','WRONG_DELIVERY','REFUND','OTHER']),subject:supportText.pipe(z.string().max(80)),body:supportText}).strict();
export const ticketReply=z.object({body:supportText,version:z.number().int().nonnegative()}).strict();
export const ticketState=z.object({status:z.enum(['IN_PROGRESS','RESOLVED','CLOSED','OPEN']),version:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict();
export const bulkCodes=z.object({orderIds:z.array(z.uuid()).min(1).max(20).refine(v=>new Set(v).size===v.length),confirmed:z.literal(true)}).strict();
export interface Ticket { orderContext?:{status:OrderStatus;building:string;room:string;station:string};id:string;orderId:string;userId:string;category:string;subject:string;status:'OPEN'|'IN_PROGRESS'|'RESOLVED'|'CLOSED';version:number;createdAt:number}
export interface TicketMessage {id:number;actorKind:string;body:string;createdAt:number}
export interface InboxMessage {id:number;orderId:string;kind:string;title:string;readAt:number|null;createdAt:number}
