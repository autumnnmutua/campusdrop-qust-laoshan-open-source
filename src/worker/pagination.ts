import {z} from 'zod';
import {ApiError} from './http';
const cursorSchema=z.object({time:z.number().int().nonnegative(),id:z.string().regex(/^[a-f0-9-]{36}$/),scope:z.string().max(500)}).strict();
export function cursorPage(request:Request,scope:string){
 const query=new URL(request.url).searchParams;
 const limit=Number(query.get('pageSize')??30);
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new ApiError(400,'INVALID_FILTER','每页数量应为1–100');
 let cursor:z.infer<typeof cursorSchema>|null=null;
 const raw=query.get('cursor');
 if(raw){try{if(raw.length>1500)throw Error();cursor=cursorSchema.parse(JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/'))));if(cursor.scope!==scope)throw Error();}catch{throw new ApiError(400,'INVALID_CURSOR','分页已失效，请从第一页重新查询');}}
 return {limit,cursor};
}
export function cursorResult<T extends {id:string;createdAt:number}>(rows:T[],limit:number,scope:string){
 const hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
 return {items,hasMore,nextCursor:hasMore&&last?btoa(JSON.stringify({time:last.createdAt,id:last.id,scope})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''):null};
}
