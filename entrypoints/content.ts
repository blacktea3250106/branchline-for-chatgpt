// 入口：只負責串接，不放邏輯。WXT 只出現在 entrypoints/。
import {
  canReserveRight,
  currentConversationId,
  currentConversationIdOf,
  headerActionsLeft,
  inSidebar,
  isHomePage,
  messageIdsOf,
  onDeleteConfirmed,
  mainAvailableWidth,
  nativeRightPanelOpen,
  onComposerSubmit,
  onUserInput,
  onPageChange,
  openConversation,
  pageTheme,
  readConversation,
  releaseRight,
  reserveRight,
  selectorsLookBroken,
  sidebarConversationIds,
  titleOf,
} from '@/lib/chatgpt-dom';
import { load, loadEnabled, loadMsgs, loadPrefs, onExternalChange, removeConv, removeMsgs, saveConv, saveMsgs, savePrefs, type ExternalChange, type Prefs } from '@/lib/store';
import {
  addMessages,
  buildTree,
  countNodes,
  get,
  inferChildren,
  inferParent,
  isDraft,
  isKnown,
  isRelevant,
  isTomb,
  mergeObservation,
  promoteDraft,
  markDeleted,
  pruneTombstones,
  shouldPromote,
  type Submitted,
  type Conv,
  type MsgIndex,
  type Store,
  type TreeNode,
} from '@/lib/tree';
import { mountBranchMap, type MapMode, type MapView } from '@/lib/ui/branch-map';

/** 結構圖固定寬（與 design/tokens.css 的 --bc-map-w 一致） */
const MAP_W = 280;
/** 讓位後對話欄至少要留的寬度；不夠就不讓位（自動收起，按開時覆蓋在對話上） */
const MIN_CHAT_W = 640;
/** 打開一條已存的對話後，多久內被導回首頁、內容又從沒出現過，就當作這條已在 ChatGPT 被刪除 */
const NOT_FOUND_WINDOW_MS = 15_000;
/** 使用者確認刪除後，最多等多久看到結果（連結消失或頁面離開）；沒看到就當沒刪成 */
const DELETE_CONFIRM_WINDOW_MS = 10_000;
/** 內容出現多久後才採用分頁標題（站內切換的瞬間分頁標題可能還是上一條的） */
const DOC_TITLE_DELAY_MS = 1_000;

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_idle',
  // 不對頁面 window.postMessage 宣告外掛啟動（WXT 之後的預設行為）。WXT 仍用 document 上的事件偵測新舊腳本，
  // 頁面理論上能送假事件讓外掛停用，影響只是結構圖消失，可接受
  noScriptStartedPostMessage: true,
  async main(ctx) {
    // 先登記清理：外掛更新或停用時，之後的非同步工作一律不再動頁面
    let disposed = false;
    const offs: (() => void)[] = [];
    /** 頁面上的監聽（輸入、送出、頁面變動、刪除）：開關關閉時全部解除，不再讀頁面 */
    let pageOffs: (() => void)[] = [];
    const offAll = (list: (() => void)[]) => {
      for (const off of list) {
        try {
          off();
        } catch {
          /* 外掛已失效時 chrome API 可能拋錯，忽略 */
        }
      }
    };
    /** 結構圖；開關關閉時拆掉，頁面上不留任何外掛的元素 */
    let view: MapView | undefined;
    ctx.onInvalidated(() => {
      disposed = true;
      // 先把頁面恢復原狀；解除監聽時就算出錯（外掛已失效）也不影響
      view?.destroy();
      releaseRight();
      offAll(pageOffs);
      offAll(offs);
    });

    /** 這次打開的對話：判斷「被導回首頁＝已刪除」「分頁標題是否可信」「墓碑能否復原」用 */
    const newVisit = (id: string | null, at: number) => ({ id, at, reads: 0, firstReadAt: 0, userInput: false });
    // 開關關閉時，從第一刻就不讀頁面：先讀開關，再決定要不要看網址、掛輸入監聽
    const onAtStart = await loadEnabled();
    if (disposed) return;
    // 頁面一開始的網址：ChatGPT 可能在外掛啟動前就把已刪除的對話導回首頁，從這裡還看得到原本要開的是哪一條
    let visit = newVisit(onAtStart ? currentConversationIdOf(performance.getEntriesByType('navigation')[0]?.name) : null, Date.now());
    /** 在哪個草稿裡按了送出、什麼時候、當時左欄已有哪些對話 */
    let submitted: Submitted | null = null;
    /** 使用者確認刪除的對話：等連結消失或頁面離開它（真的刪了），逾時作罷。可能連刪好幾條 */
    const pendingDeletes = new Map<string, { at: number; wasCurrent: boolean; linkVisible: boolean; userActed: boolean }>();
    /** 這個頁面載入的時間：墓碑只能被「刪除之後才載入的頁面」復原（舊頁面可能還顯示快取內容，不能讓它把刪掉的救回來） */
    const pageLoadedAt = performance.timeOrigin;
    // 使用者操作要最早開始記：載入 storage 的空窗裡按了「新對話」，也不能被當成「被導回首頁」
    const onInput = () =>
      onUserInput((outsideComposer) => {
        visit.userInput = true;
        // 確認刪除之後自己點了別處（例如新對話）：之後離開這條不能當成「刪除成功被帶走」
        if (outsideComposer) for (const pd of pendingDeletes.values()) pd.userActed = true;
        // 送出後使用者在輸入框以外有任何操作（點連結、搜尋、上一頁…）：之後的網址變化不一定是草稿轉正。
        // 寧可漏掉：轉正只是讓新分支早一點出現，重新整理後頁面上的「接續自」連結一樣會接上。
        if (outsideComposer) submitted = null;
      });
    if (onAtStart) pageOffs.push(onInput());

    // 先開始收其他分頁的變動，載入期間收到的先暫存，載入完再套用（不漏掉載入空窗裡的清除或新增）
    let pending: ExternalChange[] | null = [];
    let applyExternal: (ch: ExternalChange) => void = (ch) => pending?.push(ch);
    offs.push(onExternalChange((ch) => applyExternal(ch)));

    let [store, prefs, enabled, msgs]: [Store, Prefs, boolean, MsgIndex] = await Promise.all([
      load(),
      loadPrefs(),
      loadEnabled(),
      loadMsgs(),
    ]);
    if (disposed) return;
    /** 過期墓碑只在開啟狀態下清一次（關閉時不寫資料） */
    let pruned = false;

    /** 還沒送出的分支草稿：只放記憶體，不寫入 storage（關掉分頁就消失，不會留下幽靈節點） */
    const drafts = new Map<string, Conv>();
    /** 這個分頁上次從頁面讀到的各條標題。只有「本分頁看到的標題變了」才寫入，避免兩個分頁輪流蓋寫 */
    const seenTitles = new Map<string, string>();
    /** 打開某條就被導回首頁、但左欄還沒載入：先記著，等左欄出現再判斷 */
    let notFound: { id: string; at: number } | null = null;
    /** 選項頁剛清除全部資料：在使用者換到下一條對話前不寫入 */
    let pausedVisit: string | null | undefined;
    /** 稍後再跑一次 tick（只排一個，不會疊加） */
    let retry: ReturnType<typeof setTimeout> | undefined;
    const later = (ms: number) => {
      if (retry) return;
      retry = setTimeout(() => {
        retry = undefined;
        void schedule();
      }, ms);
    };
    /** 窄視窗時使用者手動按開（只在這次窄視窗期間有效，不寫回偏好） */
    let overlayOpen = false;
    let narrow = false;
    let shown = false;
    let lastId: string | null = null;
    let lastSig = '';
    let brokenSince = 0;
    let warned = false;

    const mount = () =>
      mountBranchMap(
        (id) => openConversation(id),
        (id) => titleOf(id),
        () => {
          if (narrow) overlayOpen = !overlayOpen;
          else {
            prefs = { collapsed: !prefs.collapsed };
            void savePrefs(prefs);
          }
          applyMode();
        },
      );

    const warnOnce = (msg: string) => {
      if (warned) return;
      warned = true;
      console.warn(`[BranchLine] ${msg}；ChatGPT 可能改版了，結構圖暫時無法使用，請等外掛更新。`);
    };

    /** 依目前狀態決定結構圖與讓位 */
    const applyMode = () => {
      if (disposed || !view) return;
      // 沒有結構圖要顯示時，不做任何版面量測（串流回答時每 400ms 一次，對沒有分支的使用者也一樣）
      if (!shown) {
        view.setMode('none');
        releaseRight();
        return;
      }
      view.setTheme(pageTheme());
      const avail = mainAvailableWidth();
      const toggleLeft = headerActionsLeft();
      const wasNarrow = narrow;
      // 讓位用的元素找不到時，當成窄視窗處理：不讓位，按開時覆蓋，不會蓋住輸入框
      narrow = avail != null && (avail < MAP_W + MIN_CHAT_W || !canReserveRight());
      if (!narrow || !wasNarrow) overlayOpen = false;
      let mode: MapMode = 'none';
      // 找不到頂列按鈕群時不顯示：切換鈕沒有安全的位置，硬放會蓋住 ChatGPT 原生按鈕
      if (shown && avail != null && toggleLeft != null && !nativeRightPanelOpen()) {
        const open = narrow ? overlayOpen : !prefs.collapsed;
        mode = !open ? 'closed' : narrow ? 'overlay' : 'push';
      } else if (shown && toggleLeft == null) warnOnce('找不到頂列按鈕群');
      view.setMode(mode);
      // 沒有結構圖的頁面不留任何樣式在 ChatGPT 上
      if (mode === 'none') releaseRight();
      else reserveRight(mode === 'push' ? MAP_W : 0);
      if (toggleLeft != null) view.setToggleRight(window.innerWidth - toggleLeft + 4);
    };

    /** 寫入一筆：有分支關係的才存（沒有分支關係的一般對話不保存） */
    const put = (next: Store, id: string) => {
      if (next === store) return;
      if (pausedVisit !== undefined && visit.id === pausedVisit) return; // 剛清除全部資料，這次造訪不再記
      const had = !!get(store, id);
      const c = get(next, id);
      if (c && isRelevant(next, id)) {
        store = next;
        // 寫入前確認另一個分頁沒有剛把它標成刪除（storage 的通知還沒傳到這裡）；有的話以墓碑為準
        // 寫入時以 storage 最新的為準（另一個分頁剛標的墓碑、或已補上的父關係）；存下的和記憶體不同就跟著更新
        void saveConv(c, pageLoadedAt).then((saved) => {
          if (saved && saved !== c && get(store, saved.id) === c) {
            store = { ...store, [saved.id]: saved };
            void schedule();
          }
        });
      } else if (had) {
        store = { ...next };
        delete store[id];
        void removeConv(id);
      }
    };

    /**
     * 標題閘門：決定這次讀到的標題要不要當成新資訊（回傳 null = 沿用已存的）。
     * - 本分頁第一次看到、或還沒存標題：和已存的不同就採用（不在場時的改名也補得上）
     * - 之後：只有本分頁看到的標題變了才採用
     * 每個分頁「第一次看到」最多寫一次，之後只跟著自己看到的變化寫，所以兩個分頁不會無限互相蓋寫。
     */
    const gateTitle = (id: string, t: string | null): string | null => {
      if (!t) return null;
      const stored = get(store, id)?.title ?? null;
      const prev = seenTitles.get(id);
      seenTitles.set(id, t);
      if (prev === undefined || stored === null) return t === stored ? null : t;
      return prev === t ? null : t;
    };

    /** 對話在 ChatGPT 被刪除：改成墓碑，結構圖跳過它、子分支往上接一層（判斷錯了，之後再讀到就會恢復） */
    const forget = (id: string, now: number) => {
      const r = markDeleted(store, id, now);
      if (!r.saved) return;
      store = r.store;
      seenTitles.delete(id);
      void saveConv(r.saved);
    };

    const tick = async () => {
      if (disposed || !enabled || !view) return;
      const now = Date.now();
      const id = currentConversationId();


      // 離開草稿：只有「在這個草稿裡按了送出」、很快換成送出前左欄還沒有的正式 ID，才把父關係交給它
      if (lastId && lastId !== id && isDraft(lastId)) {
        const d = drafts.get(lastId);
        if (d && shouldPromote(submitted, lastId, id, now)) put(promoteDraft(store, d, id!), id!);
        drafts.delete(lastId);
        submitted = null;
      }

      if (id !== visit.id) {
        const v = visit;
        const stored = v.id ? get(store, v.id) : undefined;
        const goneHome = !!v.id && !id && isHomePage() && !v.userInput && now - v.at < NOT_FOUND_WINDOW_MS;
        // 打開結構圖認得的對話，內容一次都沒出現、使用者也沒操作，就被導回首頁：ChatGPT 對已刪除的對話就是這樣處理。
        if (goneHome && v.id && !isDraft(v.id) && isKnown(store, v.id) && !isTomb(stored) && v.reads === 0)
          notFound = { id: v.id, at: now };
        visit = newVisit(id, now);
        pausedVisit = undefined; // 清除後的暫停只到這次造訪結束
        overlayOpen = false; // 窄視窗的覆蓋面板在切換對話後讓開
      }
      lastId = id;

      // 被導回首頁的那條：左欄正常顯示、裡面沒有它才判定刪除；左欄還沒載入就等（登出或載入失敗時左欄不會出現）
      if (notFound) {
        const nf = notFound;
        const side = inSidebar(nf.id);
        if (id || now - nf.at > NOT_FOUND_WINDOW_MS || side === true) notFound = null;
        else if (side === false) {
          notFound = null;
          forget(nf.id, now);
        } else later(1000);
      }

      // 使用者確認刪除：確認當下看得見的連結消失了，或（刪的是正在看的這條）頁面被帶回首頁，才算真的刪了
      for (const [delId, pd] of pendingDeletes) {
        const side = inSidebar(delId);
        if (now - pd.at > DELETE_CONFIRM_WINDOW_MS) pendingDeletes.delete(delId);
        // 刪的是正在看的這條：ChatGPT 會自己把頁面帶離（首頁或專案頁）；使用者自己點走的不算
        else if ((pd.linkVisible && side === false) || (pd.wasCurrent && !pd.userActed && id !== delId && !id)) {
          pendingDeletes.delete(delId);
          forget(delId, now);
        } else later(1000);
      }

      if (!id) {
        shown = false;
        applyMode();
        return;
      }

      const docTitleOk = visit.firstReadAt > 0 && now - visit.firstReadAt >= DOC_TITLE_DELAY_MS;
      const o = readConversation(id, docTitleOk);
      if (!o) visit.firstReadAt = 0; // 「穩定顯示」要連續：讀不到就重新計時
      if (o) {
        if (!visit.firstReadAt) {
          visit.firstReadAt = now;
          // 頁面靜止時不一定再觸發，排一次稍後的讀取，讓分頁標題有機會被採用
          later(DOC_TITLE_DELAY_MS + 100);
        }
        visit.reads++;
        brokenSince = 0;
        // 記下這條看得到的訊息 ID；頁面沒有「接續自」連結時，用它比對出父對話（草稿只放記憶體）
        const paused = pausedVisit !== undefined && visit.id === pausedVisit;
        const ids = addMessages(msgs[id], messageIdsOf(id));
        if (ids !== msgs[id] && !paused) {
          msgs = { ...msgs, [id]: ids };
          // 存下的是和其他分頁合併後的結果；比記憶體多就跟著更新
          if (!isDraft(id))
            void saveMsgs(id, ids).then((saved) => {
              if (saved && saved.length > (msgs[id]?.length ?? 0)) msgs = { ...msgs, [id]: saved };
            });
        }
        if (!o.parentId) {
          const p = inferParent(msgs, id);
          if (p) {
            o.parentId = p;
            o.inferred = true;
          }
        }
        // 先造訪支線、後造訪父對話：支線也在這時接上
        if (!isDraft(id) && !paused)
          for (const k of inferChildren(msgs, id))
            if (get(store, k)?.parentId !== id) put(mergeObservation(store, { id: k, parentId: id, title: null, inferred: true }, now), k);
        if (isDraft(id)) {
          const d = mergeObservation(drafts.has(id) ? { [id]: drafts.get(id)! } : {}, o, Date.now())[id];
          if (d) drafts.set(id, d);
        } else {
          // 墓碑：只有刪除之後才載入的頁面讀到它（內容穩定 1 秒），才算「其實還在」而復原。
          // 刪除前就開著的分頁可能顯示快取內容，不能讓它把刪掉的救回來；誤判的話，重新整理後打開它就會恢復。
          const tomb = get(store, id)?.deleted;
          if (tomb === undefined || (pageLoadedAt > tomb && docTitleOk))
            put(mergeObservation(store, { ...o, title: gateTitle(id, o.title) }, now), id);
        }
      } else if (selectorsLookBroken(id)) {
        brokenSince ||= Date.now();
        if (Date.now() - brokenSince > 10_000) warnOnce('讀不到目前對話');
      }

      // 顯示時標題以左欄為準（改名立刻反映）；storage 只在目前這條的標題變了時更新，給左欄沒載入時用
      const tree = buildTree(drafts.size ? { ...store, ...Object.fromEntries(drafts) } : store, id);

      // 只有一條、沒有分支時，結構圖沒有要表達的東西
      shown = countNodes(tree) > 1;
      applyMode();
      if (!shown) return;

      // 標籤可能來自左欄（還沒存標題的根），左欄載入後要重畫，所以簽名用實際顯示的標籤
      const sig = id + '|' + signature(tree, (c) => titleOf(c.id) ?? c.title ?? '');
      if (sig === lastSig) return;
      lastSig = sig;
      view.render(tree, id);
    };

    // tick 執行中又被觸發時，跑完再補跑一次
    let running = false;
    let again = false;
    const schedule = async () => {
      // 讀 ctx.isInvalid 本身會讓 WXT 發現外掛已被停用或更新，進而觸發上面的清理
      if (disposed || ctx.isInvalid) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          await tick();
        } while (again && !disposed);
      } finally {
        running = false;
      }
    };

    const startPage = () => {
      if (!pageOffs.length) pageOffs.push(onInput());
      pageOffs.push(
        onComposerSubmit(() => {
          const cur = currentConversationId();
          submitted = cur && isDraft(cur) ? { draftId: cur, at: Date.now(), knownIds: sidebarConversationIds() } : null;
        }),
        onPageChange(schedule),
        onDeleteConfirmed((delId, linkVisible) => {
          if (!isKnown(store, delId) || isTomb(get(store, delId))) return; // 不在結構圖上的對話不用管
          pendingDeletes.set(delId, { at: Date.now(), wasCurrent: delId === currentConversationId(), linkVisible, userActed: false });
          void schedule();
        }),
      );
    };

    /**
     * 開啟：掛上結構圖、開始讀頁面。
     * fromOff = 由關閉切回開啟：關閉期間沒看著頁面，這次造訪不拿來判斷刪除（頁面載入時就開著的，照常判斷）。
     */
    const enable = (fromOff: boolean) => {
      if (!pruned) {
        pruned = true;
        // 清掉放太久、沒有子分支的墓碑
        const r = pruneTombstones(store, Date.now());
        store = r.store;
        r.drop.forEach((x) => void removeConv(x));
        if (r.drop.length) {
          msgs = { ...msgs };
          for (const x of r.drop) delete msgs[x];
          void removeMsgs(r.drop);
        }
      }
      if (fromOff) {
        const id = currentConversationId();
        visit = newVisit(id, Date.now());
        visit.userInput = true;
        lastId = id;
        pausedVisit = undefined;
      }
      overlayOpen = false;
      lastSig = '';
      view = mount();
      startPage();
      void schedule();
    };
    /** 關閉：解除頁面監聽、拆掉結構圖、還原版面，丟掉進行中的判斷 */
    const disable = () => {
      offAll(pageOffs);
      pageOffs = [];
      view?.destroy();
      view = undefined;
      releaseRight();
      drafts.clear();
      submitted = null;
      pendingDeletes.clear();
      notFound = null;
      clearTimeout(retry);
      retry = undefined;
      shown = false;
    };
    // 其他分頁的變動：只更新記憶體，不寫回（避免互相觸發）
    applyExternal = (ch) => {
      if (ch.cleared) {
        store = {};
        msgs = {};
        seenTitles.clear();
        pausedVisit = visit.id;
      }
      if (ch.convs.size) {
        store = { ...store };
        for (const [cid, c] of ch.convs) {
          if (c) store[cid] = c;
          else {
            delete store[cid];
            seenTitles.delete(cid); // 被清除後重新記下時，標題要能補回
          }
        }
      }
      if (ch.msgs.size) {
        msgs = { ...msgs };
        for (const [cid, ids] of ch.msgs) {
          if (ids) msgs[cid] = addMessages(msgs[cid], ids);
          else delete msgs[cid];
        }
      }
      if (ch.prefs) prefs = ch.prefs;
      if (ch.enabled !== undefined && ch.enabled !== enabled) {
        enabled = ch.enabled;
        if (enabled) enable(true);
        else disable();
      }
      void schedule();
    };
    pending.forEach(applyExternal);
    pending = null;
    if (enabled) enable(false);
    else disable();
  },
});

function signature(n: TreeNode, shown: (c: Conv) => string): string {
  return `${n.conv.id}:${shown(n.conv)}(${n.children.map((k) => signature(k, shown)).join(',')})`;
}
