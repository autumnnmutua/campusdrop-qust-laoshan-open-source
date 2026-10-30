import {t} from './i18n';
import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {api} from './api';
import {ConfirmAction} from './components';
import {useStudentSession} from './session';
import {toast} from './effects';
import {disableNotify} from './notify';

const PHRASE='注销我的账号';
/** Self-service account deletion. The server refuses while orders are open; the typed phrase guards against slips. */
export function AccountDelete(){
  const [typed,setTyped]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const navigate=useNavigate();const {setSession}=useStudentSession();
  async function remove(){
    setBusy(true);setError('');
    try{await api('/me/delete','POST',{confirm:typed.trim()});disableNotify();setSession('signed-out');toast('账号已注销','info','个人资料已删除，感谢使用 CampusDrop');navigate('/',{replace:true});}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <details className="account-delete"><summary>{t('注销账号')}</summary>
    <p>注销后，你的姓名、电话、寝室、聊天记录、站内消息和推送订阅会被删除，账号无法恢复；订单与模拟支付只保留匿名记录用于对账。请先完成或取消所有进行中的订单。</p>
    <ConfirmAction label="注销账号" title="确认永久注销账号？" busy={busy} canConfirm={typed.trim()===PHRASE} validationMessage={`请输入“${PHRASE}”以确认`} onConfirm={remove}>
      <label>请输入“{PHRASE}”<input value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off"/></label>
    </ConfirmAction>
    {error&&<p role="alert">{error}</p>}
  </details>;
}
