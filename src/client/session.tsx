import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {api,RequestError} from './api';

/**
 * Student sign-in state: 'unknown' until the first /me check settles, so signed-in-only UI never flashes for visitors.
 * 'unavailable' means the check itself failed (network/server); pages may still try their own requests and show that error.
 */
export type StudentSession='unknown'|'signed-in'|'signed-out'|'unavailable';
type SessionValue={session:StudentSession;setSession:(next:StudentSession)=>void};
const SessionContext=createContext<SessionValue>({session:'unknown',setSession:()=>{}});

export function isUnauthorized(error:unknown){return error instanceof RequestError&&error.status===401;}

export function StudentSessionProvider({children}:{children:ReactNode}){
  const [session,setSession]=useState<StudentSession>('unknown');
  useEffect(()=>{
    let active=true;
    // Network or server failures mark the check unavailable, so signed-in-only controls stay hidden rather than guessing.
    // Only settle a still-unknown state: a login that finished first must not be overwritten by this initial check.
    const settle=(next:StudentSession)=>{if(active)setSession(current=>current==='unknown'?next:current);};
    api('/me').then(()=>settle('signed-in')).catch(error=>settle(isUnauthorized(error)?'signed-out':'unavailable'));
    return ()=>{active=false;};
  },[]);
  return <SessionContext.Provider value={{session,setSession}}>{children}</SessionContext.Provider>;
}

export function useStudentSession(){return useContext(SessionContext);}
