/* © 2026 专业团队 · CampusDrop v4.5.0 */
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
import {api,RequestError} from './api';
import {clearDraft} from './parcel-draft';

/**
 * Student sign-in state: 'unknown' until the first /me check settles, so signed-in-only UI never flashes for visitors.
 * 'unavailable' means the check itself failed (network/server); pages may still try their own requests and show that error.
 */
export type StudentSession='unknown'|'signed-in'|'signed-out'|'unavailable';
type SessionValue={session:StudentSession;userId:string|null;setSession:(next:StudentSession,userId?:string)=>void};
const SessionContext=createContext<SessionValue>({session:'unknown',userId:null,setSession:()=>{}});

export function isUnauthorized(error:unknown){return error instanceof RequestError&&error.status===401;}

export function StudentSessionProvider({children}:{children:ReactNode}){
  const [state,setState]=useState<{session:StudentSession;userId:string|null}>({session:'unknown',userId:null});
  const {session,userId}=state;
  const setSession=useCallback((next:StudentSession,id?:string)=>{
    if(next==='signed-out')clearDraft(userId);
    setState({session:next,userId:next==='signed-in'?id??null:null});
    try{localStorage.setItem('campusdrop:session-change',`${Date.now()}-${Math.random()}`);}catch{/* storage can be disabled */}
  },[userId]);
  useEffect(()=>{
    const changed=(event:StorageEvent)=>{if(event.key==='campusdrop:session-change')setState({session:'unknown',userId:null});};
    window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
  },[]);
  // The admin workspace has its own session; asking /me there only produced a 401 on every admin page load. The student
  // check runs the first time a student-facing page is shown (and right away for everyone who lands on one).
  const onAdmin=useLocation().pathname.startsWith('/admin');
  const needed=session==='unknown'&&!onAdmin;
  useEffect(()=>{
    if(!needed)return;
    let active=true;
    // Network or server failures mark the check unavailable, so signed-in-only controls stay hidden rather than guessing.
    // Only settle a still-unknown state: a login that finished first must not be overwritten by this initial check.
    const settle=(next:StudentSession,id?:string|null)=>{if(active)setState(current=>current.session==='unknown'?{session:next,userId:next==='signed-in'?id??null:null}:current);};
    // /auth/session answers 200 either way, so visitors do not get a 401 (logged by browsers as a console error).
    api<{signedIn:boolean;userId:string|null}>('/auth/session').then(r=>settle(r.signedIn?'signed-in':'signed-out',r.userId)).catch(error=>settle(isUnauthorized(error)?'signed-out':'unavailable'));
    return ()=>{active=false;};
  },[needed]);
  return <SessionContext.Provider value={{session,userId,setSession}}>{children}</SessionContext.Provider>;
}

export function useStudentSession(){return useContext(SessionContext);}
