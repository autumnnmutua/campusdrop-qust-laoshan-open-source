/* © 2026 专业团队 · CampusDrop v4.5.0 */
import {useEffect,useRef,useState,type FormEvent,type KeyboardEvent} from 'react';
import {Link} from 'react-router-dom';
import {api} from './api';
import {t} from './i18n';
import {SymbolIcon} from './campus-design';
import {AgentDrafts,AgentSteps} from './agent-ui';
import {ASSISTANT_MAX_CHARS,ASSISTANT_SUGGESTIONS,type AssistantReply} from '../shared/assistant';

/*
 * 智能助手 panel (v3.5). Loaded on demand by the launcher in main.tsx. Answers are plain text (never HTML); links come
 * from the server's fixed list. The panel keeps the last few turns in memory only (nothing is stored).
 */
type Turn={role:'user'|'assistant';content:string;reply?:AssistantReply};
const REASON:Record<NonNullable<AssistantReply['fallbackReason']>,string>={NOT_CONFIGURED:'本站未配置大模型，以下为规则与常见问题检索给出的回答',DAILY_LIMIT:'今日大模型调用已达上限，以下为规则与常见问题检索给出的回答',MODEL_ERROR:'大模型暂时没有响应，以下为规则与常见问题检索给出的回答'};

export default function AssistantPanel({onClose}:{onClose:()=>void}){
  const [turns,setTurns]=useState<Turn[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const input=useRef<HTMLTextAreaElement>(null),list=useRef<HTMLDivElement>(null);
  useEffect(()=>{input.current?.focus();},[]);
  useEffect(()=>{list.current?.scrollTo({top:list.current.scrollHeight,behavior:'smooth'});},[turns,busy]);
  async function ask(question:string){
    const q=question.trim();if(!q||busy)return;
    setError('');setText('');setBusy(true);
    const history=turns.slice(-6).map(({role,content})=>({role,content:content.slice(0,600)}));
    setTurns(v=>[...v,{role:'user',content:q}]);
    try{const r=await api<{reply:AssistantReply}>('/assistant','POST',{message:q,history});setTurns(v=>[...v,{role:'assistant',content:r.reply.answer,reply:r.reply}]);}
    catch(e){setError((e as Error).message);setTurns(v=>v.slice(0,-1));setText(q);}
    finally{setBusy(false);input.current?.focus();}
  }
  const submit=(e:FormEvent)=>{e.preventDefault();void ask(text);};
  const onKey=(e:KeyboardEvent<HTMLTextAreaElement>)=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask(text);}};
  return <section className="assistant-panel" role="dialog" aria-modal="false" aria-labelledby="assistant-title" onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
    <header><span className="assistant-mark" aria-hidden="true"><SymbolIcon name="chat"/></span><div><h2 id="assistant-title">{t('智能助手')}</h2><small>{t('查进度、问规则，还能一句话帮你安排配送')}</small></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label={t('关闭智能助手')}>×</button></header>
    <div className="assistant-list" ref={list} aria-live="polite">
      {!turns.length&&<div className="assistant-hello"><p>{t('你好！我可以查你的包裹和订单进度、回答费用和规则问题，也能按你的一句话安排配送（生成订单草稿，你确认后才下单）。')}</p>
        <div className="assistant-chips">{ASSISTANT_SUGGESTIONS.map(s=><button key={s} type="button" className="chip" onClick={()=>void ask(t(s))}>{t(s)}</button>)}</div></div>}
      {turns.map((turn,i)=><div key={i} className={`assistant-turn is-${turn.role}`}>
        <p>{turn.content}</p>
        {turn.reply?.drafts?.length?<AgentDrafts drafts={turn.reply.drafts} steps={turn.reply.steps??[]} onDone={onClose}/>:turn.reply?.steps?.length?<AgentSteps steps={turn.reply.steps}/>:null}
        {turn.reply&&<>{turn.reply.links.length>0&&<div className="assistant-links">{turn.reply.links.map(l=><Link key={l.to} to={l.to} onClick={onClose}>{t(l.label)} ›</Link>)}</div>}
          <small className="assistant-source">{turn.reply.source==='MODEL'?t('由大模型 {0} 根据你的订单状态和服务规则生成，仅供参考',{0:turn.reply.model??''}):t(REASON[turn.reply.fallbackReason??'NOT_CONFIGURED'])}</small></>}
      </div>)}
      {busy&&<div className="assistant-turn is-assistant is-thinking" aria-label={t('正在思考')}><span/><span/><span/></div>}
    </div>
    {error&&<p role="alert" className="assistant-error">{error}</p>}
    <form onSubmit={submit}><label className="sr-only" htmlFor="assistant-input">{t('输入你的问题')}</label>
      <textarea id="assistant-input" ref={input} rows={1} maxLength={ASSISTANT_MAX_CHARS} value={text} onChange={e=>setText(e.target.value)} onKeyDown={onKey} placeholder={t('例如：我的包裹到哪了？')}/>
      <button disabled={busy||!text.trim()} aria-label={t('发送')}><SymbolIcon name="send"/></button></form>
    <p className="assistant-note">{t('助手只读取你自己的包裹和订单状态，不读取姓名、电话、房间号和取件码；安排配送只生成草稿，确认和付款由你完成。')}</p>
  </section>;
}
