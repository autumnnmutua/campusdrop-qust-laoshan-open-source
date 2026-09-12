import {ticketCreate,ticketReply,ticketState,bulkCodes} from '../src/shared/support.ts';
import {z} from 'zod';
import {readFileSync,writeFileSync} from 'node:fs';
import {registerSchema,loginSchema,addressSchema,profileSchema,adminContactSchema,createAdminSchema} from '../src/shared/contracts.ts';
import {taskQuerySchema,parcelSchema,quoteSchema,orderSchema,noteUpdateSchema,orderActionSchema,releaseSchema,handoffSchema,transitionSchema,batchSchema,batchTransitionSchema,tipSchema,listPageSchema} from '../src/shared/delivery.ts';
const schemas={taskQuery:taskQuerySchema,ticketCreate,ticketReply,ticketState,bulkCodes,register:registerSchema,login:loginSchema,address:addressSchema,profile:profileSchema,adminContact:adminContactSchema,createAdmin:createAdminSchema,parcel:parcelSchema,quote:quoteSchema,order:orderSchema,note:noteUpdateSchema,confirmedVersion:orderActionSchema,release:releaseSchema,handoff:handoffSchema,transition:transitionSchema,batch:batchSchema,batchTransition:batchTransitionSchema,tip:tipSchema,listPage:listPageSchema};
const output=JSON.stringify({version:'stage12',basePath:'/api/v1',note:'JSON Schema captures structural validation. Shared Zod refinements and server authorization are authoritative; do not infer ownership or business permission from schema acceptance.',schemas:Object.fromEntries(Object.entries(schemas).map(([name,schema])=>[name,z.toJSONSchema(schema,{unrepresentable:'any',io:'input'})]))},null,2)+'\n';
const path='docs/api-request-schemas.json';
if(process.argv.includes('--write')){writeFileSync(path,output);console.log('API request schemas generated from shared validators.');}
else {if(readFileSync(path,'utf8')!==output)throw new Error('API schemas stale; run npm run api:generate');console.log('PASS: published request schemas match shared validators.');}
