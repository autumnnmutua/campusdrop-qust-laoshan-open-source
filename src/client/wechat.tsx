import { t } from './i18n';

/*
 * Opening the site inside WeChat (微信内置浏览器) and other in-app browsers. What these browsers do not offer is
 * replaced, not left broken: no system print → a hint to open the page in a browser; downloads → long-press the image;
 * no system notifications → a plain explanation; the clipboard API may be refused → a selection-based copy.
 * Things that help every phone (the keyboard covering the tab bar, page titles) live here too.
 */
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
/** WeChat or WeCom (企业微信); both use the same in-app browser behaviour for web pages. */
export const inWeChat = /MicroMessenger|wxwork/i.test(UA);
export const inWeChatIOS = inWeChat && /iPhone|iPad|iPod/i.test(UA);

/** Copies text; falls back to a selected, off-screen textarea when the async clipboard is missing or refused. */
export async function copyText(text: string): Promise<boolean> {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.className = 'copy-buffer';
    document.body.appendChild(area); area.select(); area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); area.remove(); return ok;
  } catch { return false; }
}

/** Shown where a feature needs a full browser. */
export function OpenInBrowserHint({ what }: { what: string }) {
  if (!inWeChat) return null;
  return <p className="wechat-hint" role="note"><span aria-hidden="true">···</span>{t('微信内暂不支持{0}，请点右上角「···」，选择「在浏览器中打开」。', { 0: t(what) })}</p>;
}

/**
 * Runs once at start-up: marks the document for in-app-browser styles, and hides the bottom tab bar while the on-screen
 * keyboard is open (it otherwise floats above the keyboard on iOS and in WeChat).
 */
export function installMobileShell() {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  if (inWeChat) root.classList.add('in-wechat');
  const vv = window.visualViewport;
  if (!vv) return;
  let base = window.innerHeight;
  const check = () => {
    const typing = document.activeElement instanceof HTMLElement && document.activeElement.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable=true]');
    root.classList.toggle('keyboard-open', typing && vv.height < base * 0.78);
  };
  window.addEventListener('resize', () => { if (!document.activeElement || document.activeElement === document.body) base = window.innerHeight; check(); });
  vv.addEventListener('resize', check);
  document.addEventListener('focusin', () => setTimeout(check, 300));
  document.addEventListener('focusout', () => setTimeout(check, 100));
}

/** The window title (also the title bar inside WeChat) for the current page. */
const TITLES: [RegExp, string][] = [
  [/^\/$/, '首页'], [/^\/parcel\/new/, '登记包裹'], [/^\/parcel\/merge/, '合并配送'], [/^\/parcel\//, '安排配送'],
  [/^\/checkout-group\//, '合并配送'], [/^\/checkout\//, '确认支付'], [/^\/orders\/[^/]+\/receipt/, '配送凭证'], [/^\/orders\/./, '配送进度'], [/^\/orders/, '我的订单'],
  [/^\/rules/, '常用配送'], [/^\/send/, '代寄件'], [/^\/map/, '校园地图'], [/^\/messages/, '消息'], [/^\/tickets/, '售后'], [/^\/profile/, '我的寝室'],
  [/^\/report/, '年度报告'], [/^\/guide/, '配送说明'], [/^\/help/, '常见问题'], [/^\/contact/, '配送联系'], [/^\/privacy/, '资料用途'],
  [/^\/track\//, '配送进度'], [/^\/login/, '登录'], [/^\/register/, '注册'], [/^\/admin/, '工作台'],
];
export function pageTitle(pathname: string): string {
  const hit = TITLES.find(([re]) => re.test(pathname));
  return hit ? `${t(hit[1])} · CampusDrop` : 'CampusDrop';
}
