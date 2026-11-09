/* © 2026 专业团队 · CampusDrop v4.5.0 */
import {t} from './i18n';
import {money} from './format';
import {priceFen} from '../domain/commerce';
import {SIZE_LABELS,SIZE_LIMITS} from '../shared/delivery';

/** v4.5 · 小件 / 大件 / 超大件 with their limits (长 × 宽 × 高, 重量) and prices: the order page and 配送说明 show the same table. */
export function SizeGuide({open=false}:{open?:boolean}={}){
  return <details className="size-guide" open={open||undefined}><summary>{t('怎么区分小件、大件和超大件？')}</summary>
    <table><thead><tr><th scope="col">{t('分类')}</th><th scope="col">{t('尺寸上限（长 × 宽 × 高）')}</th><th scope="col">{t('重量上限')}</th><th scope="col">{t('楼下 / 到寝')}</th></tr></thead>
      <tbody>{(['SMALL','LARGE','EXTRA_LARGE'] as const).map(v=><tr key={v}><th scope="row">{t(SIZE_LABELS[v])}</th><td>{t(SIZE_LIMITS[v].dims)}</td><td>{t(SIZE_LIMITS[v].weight)}</td><td>{money(priceFen(v,'DOWNSTAIRS'))} / {money(priceFen(v,'ROOM'))}</td></tr>)}</tbody></table>
    <p className="muted small">{t('体积小但很重的包裹按重量算：例如 3 kg 以上的小纸箱算大件。小件由负责你所在楼栋的配送员送，大件和超大件由配送员接单。')}</p></details>;
}
