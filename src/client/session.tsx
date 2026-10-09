import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {api,RequestError} from './api';

/** Student sign-in state: 'unknown' until the first /me check settles, so signed-in-only UI never flashes for visitors. */
export type StudentSession='unknown'|'signed-in'|'signed-out';
type SessionValue={session:StudentSession;setSession:(next:StudentSession)=>void};
const SessionContext=createContext<SessionValue>({session:'unknown',setSession:()=>{}});

export function isUnauthorized(error:unknown){return error instanceof RequestError&&error.status===401;}

export function StudentSessionProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<StudentSession>('unknown');
  useEffect(()=>{
    let active=true;
    // Network or server failures leave the state unknown, so signed-in-only controls stay hidden rather than guessing.
    api('/me').then(()=>{if(active)setSession('signed-in');}).catch(error=>{if(active&&isUnauthorized(error))setSession('signed-out');});
    return ()=>{active=false;};
  },[]);
  return <SessionContext.Provider value={{session,setSession}}>{children}</SessionContext.Provider>;
}

export function useStudentSession(){return useContext(SessionContext);}
