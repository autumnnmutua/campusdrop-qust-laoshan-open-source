import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
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
  // The admin workspace has its own session; asking /me there only produced a 401 on every admin page load. The student
  // check runs the first time a student-facing page is shown (and right away for everyone who lands on one).
  const onAdmin=useLocation().pathname.startsWith('/admin');
  const needed=session==='unknown'&&!onAdmin;
  useEffect(()=>{
    if(!needed)return;
    let active=true;
    // Network or server failures mark the check unavailable, so signed-in-only controls stay hidden rather than guessing.
    // Only settle a still-unknown state: a login that finished first must not be overwritten by this initial check.
    const settle=(next:StudentSession)=>{if(active)setSession(current=>current==='unknown'?next:current);};
    api('/me').then(()=>settle('signed-in')).catch(error=>settle(isUnauthorized(error)?'signed-out':'unavailable'));
    return ()=>{active=false;};
  },[needed]);
  return <SessionContext.Provider value={{session,setSession}}>{children}</SessionContext.Provider>;
}

export function useStudentSession(){return useContext(SessionContext);}
