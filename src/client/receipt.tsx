import {locale,t} from './i18n';
import {Link,useParams} from 'react-router-dom';
import { OpenInBrowserHint,inWeChat } from './wechat';
import {LoadingState} from './components';
import {money,Notice,useStudentResource,type Details} from './student-delivery';
import {STATUS_LABELS} from '../shared/constants';

const PAYMENT_LABELS={DELIVERY:t('配送费'),UPGRADE:t('升级到寝补款'),TIP:t('感谢打赏'),REFUND:t('退款')} as const;
const time=(at:number)=>new Date(at*1000).toLocaleString(locale(),{hour12:false});
/**
 * Print-friendly delivery record for a student's own order. It restates what the order page already shows; it is a
 * record of mock payments, not an invoice.
 */
export function OrderReceipt(){
  const {id}=useParams();const {data,error,loading,unauthorized}=useStudentResource<Details>(`/orders/${id}`);
  const o=data?.order;
  const paid=data?.payments.filter(p=>p.type!=='REFUND').reduce((s,p)=>s+p.amountFen,0)??0,refunded=data?.payments.filter(p=>p.type==='REFUND').reduce((s,p)=>s+p.amountFen,0)??0;
  return <section className="receipt-page"><div className="receipt-tools"><Link to={`/orders/${id}`}>{t('← 返回订单')}</Link>{o&&!inWeChat&&<button type="button" onClick={()=>window.print()}>{t('打印 / 另存为 PDF')}</button>}</div><OpenInBrowserHint what="打印或另存为 PDF"/>
    <Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}
    {o&&data&&<article className="receipt" aria-labelledby="receipt-title">
      <header><div><p className="eyebrow">{t('CAMPUSDROP · 崂山校区')}</p><h1 id="receipt-title">{t('校园配送凭证')}</h1></div><span className="receipt-stamp" data-status={o.status}>{t(STATUS_LABELS[o.status])}</span></header>
      <dl className="receipt-grid">
        <div><dt>{t('订单编号')}</dt><dd className="identifier">{o.id}</dd></div>
        <div><dt>{t('下单时间')}</dt><dd>{time(o.createdAt)}</dd></div>
        <div><dt>{t('收货寝室')}</dt><dd>{o.dormSnapshot.buildingName} · {o.dormSnapshot.roomNo}</dd></div>
        <div><dt>{t('收件人')}</dt><dd>{o.dormSnapshot.name}</dd></div>
        <div><dt>{t('取件站点')}</dt><dd>{o.stationSnapshot.canonicalName}</dd></div>
        <div><dt>{t('包裹与方式')}</dt><dd>{o.packageSize==='SMALL'?t('小件'):t('大件')} · {o.deliveryMode==='ROOM'?t('送到寝室'):t('送到楼下')}</dd></div>
        {o.note&&<div className="wide"><dt>{t('备注')}</dt><dd>{o.note}</dd></div>}
      </dl>
      <table className="receipt-table"><caption>{t('费用明细')}</caption><thead><tr><th scope="col">{t('项目')}</th><th scope="col">{t('时间')}</th><th scope="col">{t('金额')}</th></tr></thead>
        <tbody>{data.payments.map(p=><tr key={p.id} className={p.type==='REFUND'?'is-refund':undefined}><td>{PAYMENT_LABELS[p.type]}</td><td>{time(p.createdAt)}</td><td>{p.type==='REFUND'?'−':''}{money(p.amountFen)}</td></tr>)}
          {!data.payments.length&&<tr><td colSpan={3}>{t('尚未支付')}</td></tr>}</tbody>
        <tfoot><tr><th scope="row" colSpan={2}>{t('实付合计')}{refunded>0?t('（已扣除退款）'):''}</th><td>{money(paid-refunded)}</td></tr></tfoot></table>
      {data.events.length>0&&<><h2>{t('配送记录')}</h2><ol className="receipt-events">{data.events.map(e=><li key={e.id}><span>{t(STATUS_LABELS[e.toStatus])}</span><time>{time(e.createdAt)}</time></li>)}</ol></>}
      <footer><p>{t('本凭证仅记录 CampusDrop 校园配送订单，所有款项均为模拟支付，未发生真实扣款或退款，不作为发票或报销凭据。')}</p><p>{t('生成时间：{0}',{0:time(Math.floor(Date.now()/1000))})}{t(' · 独立校园服务项目，非学校或菜鸟官方产品')}</p></footer>
    </article>}
  </section>;
}
