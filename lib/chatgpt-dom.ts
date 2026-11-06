// 唯一知道 ChatGPT 頁面結構的地方。ChatGPT 改版時只改這裡。
// 實測日期 2026-11-05（繁中介面）。所有選擇器都不依賴介面文字。
import { isValidId, type Observation } from './tree';

const SEL = {
  /** 每則助理回答都帶這個屬性，值是所屬對話 ID（草稿是 local-chatgpt:<uuid>） */
  convAttr: 'data-chatgpt-selection-conversation-id',
  /** 每則助理回答的訊息 ID；分支複製來的訊息和父對話相同（2026-11-07 在有／沒有「接續自」連結的兩種帳號都實測） */
  msgAttr: 'data-chatgpt-selection-message-id',
  /** 一個對話的捲動容器。站內切換後舊對話的容器只是 display:none，所以一定要先用 ID 鎖定 */
  thread: '.thread-scroll-container',
  turn: '[data-turn-key]',
  /** 「接續自」連結：放在分叉那一回合裡，只有一條，指向直接父（專案裡的對話網址是 /g/<專案>/c/<id>） */
  parentLink: 'a[href*="/c/"]',
  /** 左欄的對話連結 */
  sidebarLink: 'nav a[href*="/c/"]',
  /** 訊息本文（使用者訊息、助理回答）。裡面的 /c/ 連結是內容，不是「接續自」，一律排除。
   *  注意 [data-conversation-role] 是給螢幕閱讀器的隱藏標題，不是訊息 */
  messageBody: '[data-user-message-bubble],[data-chatgpt-selection-conversation-id]',
  composer: 'form[data-chatgpt-composer]',
  /** 主內容區。站內切換後舊頁面的 main 仍在，要挑看得見的 */
  main: 'main[data-app-shell-main-surface]',
  /** 對話版面根元素（捲動區＋輸入框）與底部輸入框容器；讓位時加 padding-right */
  threadLayout: '[data-request-input-activity-root]',
  threadFooter: '[data-thread-scroll-footer]',
  /** 頂列右側按鈕群（對話操作、分享）；position:fixed，不會跟著 main 讓位 */
  headerActions: '[data-app-shell-header-obstacle]',
  /** 對話選單（左欄每列的「…」、頂列的「對話操作」）裡的刪除項目：危險樣式的 menuitem（不靠文字） */
  deleteMenuItem: '[role="menuitem"][class*="danger"]',
  /** ChatGPT 原生右側面板（Canvas 等）是否打開 */
  nativeRightPanel: '[data-app-shell-trailing-sidebar-visible="true"]',
} as const;

const visible = (sel: string) =>
  [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0) ?? null;

/** 解碼並驗證 ID；%編碼錯誤或格式不對都回傳 null（不讓例外中斷外掛） */
function toId(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const id = decodeURIComponent(raw);
    return isValidId(id) ? id : null;
  } catch {
    return null;
  }
}

/** 網址裡的對話 ID；首頁、設定頁等回傳 null。 */
export function currentConversationId(): string | null {
  return toId(location.pathname.match(/\/c\/([^/?#]+)/)?.[1]);
}

/** 任一網址（例如頁面一開始載入的網址）裡的對話 ID */
export function currentConversationIdOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.origin === location.origin ? toId(u.pathname.match(/\/c\/([^/?#]+)/)?.[1]) : null;
  } catch {
    return null;
  }
}

/** 同站相對路徑 /c/<id> 或 /g/<專案>/c/<id>；其他網域、// 或 /\ 開頭（瀏覽器會當成外站）的網址一律不認 */
const idFromHref = (href: string | null) =>
  href && !href.includes('\\') ? toId(href.match(/^\/(?!\/)(?:[^/?#]+\/)*?c\/([^/?#]+)(?:[?#]|$)/)?.[1]) : null;

function threadOf(id: string): Element | null {
  // 站內切換後舊的容器可能還在（display:none），要挑看得見的那份
  const all = [...document.querySelectorAll(`[${SEL.convAttr}="${CSS.escape(id)}"]`)];
  const own = all.find((e) => e.getClientRects().length > 0) ?? all[0];
  if (!own) return null;
  return own.closest(SEL.thread) ?? own.closest(SEL.turn)?.parentElement ?? null;
}

const clean = (s: string | null | undefined, max = 120) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const a = Array.from(t);
  return a.length > max ? a.slice(0, max).join('') + '…' : t;
};

/** 左欄的對話標題（是使用者的資料，不受在地化影響）。左欄只載入最近的對話，所以可能讀不到。 */
export function titleOf(id: string): string | null {
  return clean(sidebarAnchor(id)?.textContent);
}

/** 左欄裡指向這條對話的連結（一般對話 /c/<id>，專案對話 /g/<專案>/c/<id>） */
function sidebarAnchor(id: string): HTMLAnchorElement | null {
  const links = [...document.querySelectorAll<HTMLAnchorElement>(`nav a[href$="/c/${CSS.escape(id)}"]`)];
  return (
    links.find(
      (a) => idFromHref(a.getAttribute('href')) === id && a.origin === location.origin && a.getClientRects().length > 0,
    ) ?? null
  );
}

/** 左欄目前看得見的所有對話 ID（判斷「左欄裡有對話被刪掉」與「送出時哪些對話已存在」用） */
export function sidebarConversationIds(): Set<string> {
  const out = new Set<string>();
  for (const a of document.querySelectorAll(SEL.sidebarLink)) {
    if (a.getClientRects().length === 0) continue;
    const id = idFromHref(a.getAttribute('href'));
    if (id) out.add(id);
  }
  return out;
}

/** 目前對話的分頁標題；還沒載入時是產品名稱，不採用。 */
function documentTitle(): string | null {
  const t = clean(document.title);
  return t && t !== 'ChatGPT' ? t : null;
}

/**
 * 讀目前對話。頁面還沒載好時回傳 null。
 * 欄位為 null 表示這次沒讀到（例如長分支的分叉回合被虛擬捲動移除），不代表沒有。
 */
export function readConversation(id: string, allowDocTitle = false): Observation | null {
  const thread = threadOf(id);
  if (!thread || thread.getClientRects().length === 0) return null;
  // 「接續自」只認第一個（分叉回合一定最早出現），而且排除訊息本文裡的連結
  let parentId: string | null = null;
  for (const link of thread.querySelectorAll(`${SEL.turn} ${SEL.parentLink}`)) {
    if (link.closest(SEL.messageBody)) continue;
    const p = idFromHref(link.getAttribute('href'));
    if (p && p !== id) {
      parentId = p;
      break;
    }
  }
  // 分頁標題只在對話已穩定顯示後才採用：站內切換的瞬間它可能還是上一條的標題
  return { id, parentId, title: titleOf(id) ?? (allowDocTitle ? documentTitle() : null) };
}

/** 目前畫面上這條對話的訊息 ID（虛擬捲動只渲染一部分，所以只是看得到的那些） */
export function messageIdsOf(id: string): string[] {
  const out: string[] = [];
  for (const e of document.querySelectorAll(`[${SEL.convAttr}="${CSS.escape(id)}"][${SEL.msgAttr}]`)) {
    if (e.getClientRects().length === 0) continue;
    const m = e.getAttribute(SEL.msgAttr);
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/** 切到某條對話：優先點左欄的連結（單頁切換，不重新載入），沒有才整頁導向。一律是同站的 /c/<id>。 */
export function openConversation(id: string) {
  if (!isValidId(id)) return;
  const a = sidebarAnchor(id);
  if (a) a.click();
  else location.assign(`/c/${encodeURIComponent(id)}`);
}

/** 使用者在輸入框送出訊息時呼叫 cb（用來判斷草稿是被送出、還是被放棄）。 */
export function onComposerSubmit(cb: () => void): () => void {
  const inComposer = (t: EventTarget | null) => t instanceof Element && !!t.closest(SEL.composer);
  // 只認使用者真的操作（isTrusted），頁面腳本造的事件不算
  const onSubmit = (e: Event) => e.isTrusted && inComposer(e.target) && cb();
  // 輸入框是空的就不算送出（例如在空白輸入框、斜線選單裡按 Enter）
  const hasText = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest(SEL.composer)?.querySelector('[contenteditable="true"]')?.textContent?.trim();
  // 只附檔案沒打字也能送出：送出鈕可按就算
  const canSend = (t: EventTarget | null) => {
    const btn = t instanceof Element ? t.closest(SEL.composer)?.querySelector<HTMLButtonElement>('button[type="submit"]') : null;
    return hasText(t) || (!!btn && !btn.disabled);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.isTrusted && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && canSend(e.target)) cb();
  };
  const onClick = (e: MouseEvent) => {
    if (e.isTrusted && e.target instanceof Element && e.target.closest(`${SEL.composer} button[type="submit"]`)) cb();
  };
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onClick, true);
  };
}

/** 頁面內容有變化時呼叫 cb（節流：最多每 wait 毫秒一次；串流回答時也會定期觸發）。 */
export function onPageChange(cb: () => void, wait = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      cb();
    }, wait);
  };
  const mo = new MutationObserver(fire);
  // characterData：ChatGPT 改名時可能只改既有的文字節點
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  // 視窗大小改變走同一個節流
  window.addEventListener('resize', fire);
  // ChatGPT 切換淺色／深色時改的是 <html> 的屬性
  const mo3 = new MutationObserver(fire);
  mo3.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  // 左側欄收放、原生右側面板開關都會改變可用寬度
  const mo2 = new MutationObserver(fire);
  mo2.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-app-shell-sidebar-open', 'data-app-shell-trailing-sidebar-visible'],
  });
  // 單頁切換不一定先有 DOM 變化，另外定期檢查網址
  let last = location.href;
  const poll = setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      fire();
    }
  }, 500);
  return () => {
    mo.disconnect();
    mo2.disconnect();
    mo3.disconnect();
    window.removeEventListener('resize', fire);
    clearInterval(poll);
    clearTimeout(timer);
  };
}

/** 自我檢查：在對話頁停留一段時間後仍讀不到，多半是選擇器失效。 */
export function selectorsLookBroken(id: string): boolean {
  return !document.querySelector(`[${SEL.convAttr}="${CSS.escape(id)}"]`) && !!document.querySelector(SEL.turn);
}

/** 主內容區左緣到視窗右緣的寬度（不受我們加的右邊距影響）；找不到時回傳 null。 */
export function mainAvailableWidth(): number | null {
  const m = visible(SEL.main);
  return m ? window.innerWidth - m.getBoundingClientRect().left : null;
}

/** 頂列右側按鈕群的左緣（切換鈕放在它左邊）；找不到時回傳 null。 */
export function headerActionsLeft(): number | null {
  // 只取貼著視窗右緣的那一群（左邊也可能有同屬性的元素）
  const lefts = [...document.querySelectorAll(SEL.headerActions)]
    .map((e) => e.getBoundingClientRect())
    .filter((b) => b.width > 0 && b.right > window.innerWidth - 40)
    .map((b) => b.left);
  return lefts.length ? Math.min(...lefts) : null;
}

export const nativeRightPanelOpen = () => !!document.querySelector(SEL.nativeRightPanel);

/**
 * 讓對話欄右邊讓出 px（0 = 不讓），ChatGPT 會自己把對話與輸入框重新置中在剩下的空間。
 * 不能用 main 的 margin：main 有 clip-path，縮小 main 會把頂列的「分享」等按鈕裁掉。
 * 改在對話版面根元素與底部輸入框容器（絕對定位，不吃父層 padding）加 padding-right。
 * 用一段全域樣式＋html 屬性切換，不改 ChatGPT 元素的 inline style；過渡沿用原生右側面板的 .3s ease。
 */
let reserveStyle: HTMLStyleElement | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
/** 讓位要用的元素都還在嗎（ChatGPT 改版時可能消失；不在就不能讓位，改用覆蓋） */
export const canReserveRight = () => !!visible(SEL.threadLayout) && !!visible(SEL.threadFooter);

/**
 * 讓位 px（0 = 收回）。所有規則都限定在 html[data-bc-reserve] 底下：沒讓位時 ChatGPT 的元素完全不受影響。
 * 收回時先把 padding 動畫回 0，動畫結束（.3s）才移除樣式與屬性。
 */
export function reserveRight(px: number) {
  if (px <= 0) {
    if (!reserveStyle?.isConnected) return releaseRight();
    if (releaseTimer !== undefined) return; // 已經在收回中
    setReserveCss(0);
    releaseTimer = setTimeout(releaseRight, 350);
    return;
  }
  clearTimeout(releaseTimer);
  releaseTimer = undefined;
  // ChatGPT 重繪 <head> 時可能把樣式移掉，不在就重建
  if (!reserveStyle?.isConnected) {
    reserveStyle = document.createElement('style');
    reserveStyle.setAttribute('data-bc-reserve-style', '');
    document.head.append(reserveStyle);
  }
  setReserveCss(px);
  // 值一樣也會產生 mutation，ChatGPT 自己監看 <html> 的程式會收到；已經有就不設
  if (!document.documentElement.hasAttribute('data-bc-reserve')) document.documentElement.setAttribute('data-bc-reserve', '');
}

function setReserveCss(px: number) {
  const on = `html[data-bc-reserve] ${SEL.threadLayout},html[data-bc-reserve] ${SEL.threadFooter}`;
  const css =
    `@media (prefers-reduced-motion:no-preference){${on}{transition:padding-right .3s ease}}` +
    `${on}{padding-right:${px}px!important}`;
  if (reserveStyle && reserveStyle.textContent !== css) reserveStyle.textContent = css;
}

export function releaseRight() {
  clearTimeout(releaseTimer);
  releaseTimer = undefined;
  document.documentElement.removeAttribute('data-bc-reserve');
  reserveStyle?.remove();
  reserveStyle = null;
}

/** ChatGPT 目前是淺色還是深色主題（看頁面的 color-scheme，不看文字或 class 名稱） */
export function pageTheme(): 'light' | 'dark' {
  const cs = getComputedStyle(document.documentElement).colorScheme;
  return /\blight\b/.test(cs) && !/\bdark\b/.test(cs) ? 'light' : 'dark';
}

/** 首頁（ChatGPT 打開不存在／已刪除的對話時會導回這裡） */
export const isHomePage = () => location.pathname === '/';

/**
 * 使用者真的操作了頁面（點擊、按鍵、上一頁）時呼叫 cb：用來區分「被導回首頁」和「自己離開」。
 * outsideComposer = 這個操作不在輸入框裡（點擊、上一頁、在輸入框以外按 Enter），可能讓頁面換到別的對話。
 */
export function onUserInput(cb: (outsideComposer: boolean) => void): () => void {
  const fn = (e: Event) => {
    if (!e.isTrusted) return;
    const t = e.target instanceof Element ? e.target : null;
    const outsideComposer =
      e.type === 'popstate' ||
      (e.type === 'pointerdown' && !t?.closest(SEL.composer)) ||
      (e.type === 'keydown' && (e as KeyboardEvent).key === 'Enter' && !t?.closest(SEL.composer));
    cb(outsideComposer);
  };
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', fn, opts);
  document.addEventListener('keydown', fn, opts);
  window.addEventListener('popstate', fn);
  return () => {
    document.removeEventListener('pointerdown', fn, opts);
    document.removeEventListener('keydown', fn, opts);
    window.removeEventListener('popstate', fn);
  };
}

/**
 * 使用者確認刪除某條對話時呼叫 cb(那條的 ID, 確認當下它的左欄連結看不看得見)。三步都要是使用者真的操作（isTrusted）：
 * 1. 打開某條對話的選單（左欄那一列的選單鈕，或頂列的對話操作＝目前這條）；
 * 2. 在選單裡按危險樣式的項目（刪除）；
 * 3. 在跳出的確認對話框裡「點擊」危險樣式的按鈕（確認刪除；按下後拖離按鈕不算）。按其他按鈕、Esc、點對話框外＝取消。
 * 這只代表「使用者確認了」：伺服器是否真的刪了，由呼叫端看連結消失或頁面離開來確認。
 */
export function onDeleteConfirmed(cb: (id: string, linkVisible: boolean) => void): () => void {
  let menuFor: string | null = null;
  let armedFor: string | null = null;
  const onDown = (e: PointerEvent) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const t = e.target;
    if (t.closest('[role="menu"]')) return; // 選單裡的點擊交給 click 處理
    const dialog = t.closest(DIALOG);
    if (dialog) {
      if (t.closest('button') && !t.closest(`button${DANGER}`)) armedFor = null; // 按了取消或其他按鈕
      return;
    }
    // 對話框以外的任何點擊：前一次的選單和刪除意圖都作廢
    armedFor = null;
    menuFor = null;
    const btn = t.closest('button[aria-haspopup="menu"]');
    if (!btn) return;
    if (btn.closest('nav')) menuFor = rowConversationId(btn);
    else if (btn.closest(SEL.headerActions)) menuFor = currentConversationId();
  };
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const t = e.target;
    if (t.closest(SEL.deleteMenuItem)) {
      armedFor = menuFor;
      return;
    }
    if (armedFor && t.closest(DIALOG) && t.closest(`button${DANGER}`)) {
      const id = armedFor;
      armedFor = null;
      cb(id, !!sidebarAnchor(id));
    }
  };
  // 按 Esc 關掉對話框＝取消。在選單和對話框以外按鍵（例如用鍵盤打開別條的選單）：之前記下的是哪一條就不可信了
  const onKey = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    if (e.key === 'Escape') armedFor = null;
    const t = e.target instanceof Element ? e.target : null;
    if (!t?.closest('[role="menu"]') && !t?.closest(DIALOG)) menuFor = null;
  };
  const opts = { capture: true, passive: true } as const;
  document.addEventListener('pointerdown', onDown, opts);
  document.addEventListener('click', onClick, opts);
  document.addEventListener('keydown', onKey, opts);
  return () => {
    document.removeEventListener('pointerdown', onDown, opts);
    document.removeEventListener('click', onClick, opts);
    document.removeEventListener('keydown', onKey, opts);
  };
}

const DIALOG = '[role="dialog"],[role="alertdialog"]';
const DANGER = '[class*="danger"]';

/**
 * 左欄某個按鈕屬於哪一條對話：往上找，第一個「剛好包含一條對話連結」的祖先。
 * 只往上找幾層（同一列裡）：專案資料夾等沒有自己對話的選單，往上找太遠會誤配到旁邊的對話。
 */
function rowConversationId(btn: Element): string | null {
  let depth = 0;
  for (let el: Element | null = btn; el && el.tagName !== 'NAV' && depth < 4; el = el.parentElement, depth++) {
    const links = el.querySelectorAll('a[href*="/c/"]');
    if (links.length > 1) return null; // 是包含多條對話的區塊（例如專案資料夾），不是單一對話
    const a = links[0] ?? (el.matches('a[href*="/c/"]') ? el : null);
    if (a) return idFromHref(a.getAttribute('href'));
  }
  return null;
}

/** 這條對話的連結是否還在左欄（左欄沒顯示時回傳 null＝不知道） */
export function inSidebar(id: string): boolean | null {
  const any = [...document.querySelectorAll(SEL.sidebarLink)].some((a) => a.getClientRects().length > 0);
  if (!any) return null;
  return !!sidebarAnchor(id);
}
