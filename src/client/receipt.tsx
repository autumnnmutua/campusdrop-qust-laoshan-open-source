import {Link,useParams} from 'react-router-dom';
import {LoadingState} from './components';
import {money,Notice,useStudentResource,type Details} from './student-delivery';
import {STATUS_LABELS} from '../shared/constants';

const PAYMENT_LABELS={DELIVERY:'配送费',UPGRADE:'升级到寝补款',TIP:'感谢打赏',REFUND:'退款'} as const;
const time=(t:number)=>new Date(t*1000).toLocaleString('zh-CN',{hour12:false});
/**
 * Print-friendly delivery record for a student's own order. It restates what the order page already shows; it is a
 * record of mock payments, not an invoice.
 */
export function OrderReceipt(){
  const {id}=useParams();const {data,error,loading,unauthorized}=useStudentResource<Details>(`/orders/${id}`);
  const o=data?.order;
  const paid=data?.payments.filter(p=>p.type!=='REFUND').reduce((s,p)=>s+p.amountFen,0)??0,refunded=data?.payments.filter(p=>p.type==='REFUND').reduce((s,p)=>s+p.amountFen,0)??0;
  return <section className="receipt-page"><div className="receipt-tools"><Link to={`/orders/${id}`}>← 返回订单</Link>{o&&<button type="button" onClick={()=>window.print()}>打印 / 另存为 PDF</button>}</div>
    <Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}
    {o&&data&&<article className="receipt" aria-labelledby="receipt-title">
      <header><div><p className="eyebrow">CAMPUSDROP · 崂山校区</p><h1 id="receipt-title">校园配送凭证</h1></div><span className="receipt-stamp" data-status={o.status}>{STATUS_LABELS[o.status]}</span></header>
      <dl className="receipt-grid">
        <div><dt>订单编号</dt><dd className="identifier">{o.id}</dd></div>
        <div><dt>下单时间</dt><dd>{time(o.createdAt)}</dd></div>
        <div><dt>收货寝室</dt><dd>{o.dormSnapshot.buildingName} · {o.dormSnapshot.roomNo}</dd></div>
        <div><dt>收件人</dt><dd>{o.dormSnapshot.name}</dd></div>
        <div><dt>取件站点</dt><dd>{o.stationSnapshot.canonicalName}</dd></div>
        <div><dt>包裹与方式</dt><dd>{o.packageSize==='SMALL'?'小件':'大件'} · {o.deliveryMode==='ROOM'?'送到寝室':'送到楼下'}</dd></div>
        {o.note&&<div className="wide"><dt>备注</dt><dd>{o.note}</dd></div>}
      </dl>
      <table className="receipt-table"><caption>费用明细</caption><thead><tr><th scope="col">项目</th><th scope="col">时间</th><th scope="col">金额</th></tr></thead>
        <tbody>{data.payments.map(p=><tr key={p.id} className={p.type==='REFUND'?'is-refund':undefined}><td>{PAYMENT_LABELS[p.type]}</td><td>{time(p.createdAt)}</td><td>{p.type==='REFUND'?'−':''}{money(p.amountFen)}</td></tr>)}
          {!data.payments.length&&<tr><td colSpan={3}>尚未支付</td></tr>}</tbody>
        <tfoot><tr><th scope="row" colSpan={2}>实付合计{refunded>0?'（已扣除退款）':''}</th><td>{money(paid-refunded)}</td></tr></tfoot></table>
      {data.events.length>0&&<><h2>配送记录</h2><ol className="receipt-events">{data.events.map(e=><li key={e.id}><span>{STATUS_LABELS[e.toStatus]}</span><time>{time(e.createdAt)}</time></li>)}</ol></>}
      <footer><p>本凭证仅记录 CampusDrop 校园配送订单，所有款项均为模拟支付，未发生真实扣款或退款，不作为发票或报销凭据。</p><p>生成时间：{time(Math.floor(Date.now()/1000))} · 独立校园服务项目，非学校或菜鸟官方产品</p></footer>
    </article>}
  </section>;
}
