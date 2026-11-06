// 純函式：由「對話 ID＋父 ID」建樹。不碰頁面、不碰 chrome API，可單元測試。

export interface Conv {
  id: string;
  /** 直接父對話；null = 目前不知道或沒有父（兩者不區分，見 mergeObservation） */
  parentId: string | null;
  /** ChatGPT 的對話標題（和左欄一致；使用者在 ChatGPT 改名就跟著變） */
  title: string | null;
  /** 第一次看到的時間，用來排兄弟順序 */
  seenAt: number;
  /**
   * 在 ChatGPT 被刪除的時間（墓碑）。墓碑只留 ID 與父 ID、不留標題，結構圖跳過它、子分支往上接一層。
   * 判斷錯了也能完整復原：之後再讀到這條對話，就拿掉墓碑，樹回到原樣（子分支的父 ID 從沒被改寫）。
   */
  deleted?: number;
  /** 父對話是比對訊息 ID 推斷的（頁面沒有「接續自」連結時）；之後讀到連結或更好的比對可以改寫 */
  inferred?: true;
}

export type Store = Record<string, Conv>;

/** 一次讀頁面得到的結果；欄位為 null 表示這次沒讀到 */
export interface Observation {
  id: string;
  parentId: string | null;
  title: string | null;
  /** parentId 來自訊息 ID 比對，不是頁面上的「接續自」連結 */
  inferred?: boolean;
}

/** 是否為墓碑（已在 ChatGPT 被刪除） */
export const isTomb = (c: Conv | undefined): boolean => c?.deleted !== undefined;

export const DRAFT_PREFIX = 'local-chatgpt:';
export const isDraft = (id: string) => id.startsWith(DRAFT_PREFIX);

/**
 * ChatGPT 對話 ID 的格式（實測為 UUID 形式；草稿多一個前綴）。
 * 頁面上讀到的 ID 一律先過這關：格式不對就當作沒讀到，避免錯誤或刻意構造的值
 * （例如 `constructor`、`__proto__`、格式錯誤的 %編碼）進入資料與 storage。
 */
const ID_RE = /^(?:local-chatgpt:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isValidId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);

/** 只取物件自己的屬性（不會讀到 Object.prototype 上的東西） */
export const get = (store: Store, id: string): Conv | undefined =>
  Object.prototype.hasOwnProperty.call(store, id) ? store[id] : undefined;

const sameConv = (a: Conv, b: Conv) =>
  a.parentId === b.parentId &&
  a.title === b.title &&
  a.seenAt === b.seenAt &&
  a.deleted === b.deleted &&
  a.inferred === b.inferred;

/**
 * 決定父對話：已存的父關係原則上不改（讀到不同的值多半是誤讀，也避免兩個分頁互相蓋寫）。
 * 例外：已存的是推斷來的，可以被「接續自」連結、或新的推斷改寫（多造訪幾條後比對更準）。
 * 連結來的父關係不會被推斷蓋掉。
 */
export function pickParent(
  old: { parentId: string | null; inferred?: true } | undefined,
  parentId: string | null,
  inferred: boolean,
): { parentId: string | null; inferred?: true } {
  if (old?.parentId && !(old.inferred && parentId)) return { parentId: old.parentId, ...(old.inferred && { inferred: true }) };
  if (!parentId) return { parentId: null };
  return { parentId, ...(inferred && { inferred: true }) };
}

/**
 * 合併一次觀察。規則：只新增、不清除——「這次沒讀到」不等於「沒有」。
 * 讀到墓碑對話＝它其實還在，拿掉墓碑（呼叫端負責判斷這次讀取是否可信，見 content.ts）。
 * 回傳新物件；沒有變化時回傳原物件（呼叫端可用 === 判斷要不要寫入）。
 */
export function mergeObservation(store: Store, o: Observation, now: number): Store {
  if (!isValidId(o.id)) return store;
  const old = get(store, o.id);
  // 正式對話的父不會是草稿；父對話指向自己或格式不對都當成沒讀到
  const p = o.parentId;
  const parentId = p && p !== o.id && isValidId(p) && (isDraft(o.id) || !isDraft(p)) ? p : null;
  const next: Conv = {
    id: o.id,
    ...pickParent(old, parentId, !!o.inferred),
    title: o.title ?? old?.title ?? null,
    seenAt: old?.seenAt ?? now,
  };
  if (old && sameConv(old, next)) return store;
  return { ...store, [o.id]: next };
}

/**
 * 草稿送出後變成正式對話：把草稿的父關係交給正式 ID。
 * 只在正式 ID 是全新的（store 裡還沒有）時才做——已存在的對話不會因為誤判被接成分支。
 */
export function promoteDraft(store: Store, draft: Conv, realId: string): Store {
  if (!isValidId(realId) || isDraft(realId) || get(store, realId)) return store;
  if (!draft.parentId || draft.parentId === realId) return store;
  const c: Conv = { id: realId, parentId: draft.parentId, title: null, seenAt: draft.seenAt };
  if (draft.inferred) c.inferred = true;
  return { ...store, [realId]: c };
}

/** 結構圖認得這條：有存它，或有別條把它當成父 */
export function isKnown(store: Store, id: string): boolean {
  return !!get(store, id) || Object.values(store).some((c) => c.parentId === id);
}

/** 刪除一筆。 */
export function remove(store: Store, id: string): Store {
  if (!get(store, id)) return store;
  const { [id]: _, ...rest } = store;
  return rest;
}

/**
 * 對話在 ChatGPT 被刪除：改成墓碑（清掉標題、記下時間），子分支不動。
 * 葉子也留墓碑：判斷錯了才能完整復原，也讓開著舊頁面的分頁知道它已被刪而不把它存回去。
 * 墓碑由 pruneTombstones 在一段時間後清掉。
 */
export function markDeleted(store: Store, id: string, now: number): { store: Store; saved: Conv | null } {
  const c = get(store, id);
  // 沒存過、但被別條當成父的對話（在 R 開分支時 R 還沒有子分支，所以沒存）也要能標成刪除
  if (!c ? !isKnown(store, id) : isTomb(c)) return { store, saved: null };
  const t: Conv = { id, parentId: c?.parentId ?? null, title: null, seenAt: c?.seenAt ?? now, deleted: now };
  if (c?.inferred) t.inferred = true;
  return { store: { ...store, [id]: t }, saved: t };
}

/** 墓碑保留多久（沒有子分支的才會被清；有子分支的墓碑只有 ID，留著讓子分支接得回上一層） */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 清理：刪掉放超過 TTL、沒有子分支的墓碑；清完後不再有任何分支關係的一般紀錄也一併刪掉。回傳要刪的 ID。
 */
export function pruneTombstones(store: Store, now: number): { store: Store; drop: string[] } {
  let next = store;
  const drop: string[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    const parents = new Set(Object.values(next).map((c) => c.parentId));
    for (const c of Object.values(next)) {
      const kids = parents.has(c.id);
      const stale = isTomb(c) ? !kids && now - c.deleted! > TOMBSTONE_TTL_MS : !kids && !c.parentId;
      if (stale) {
        next = remove(next, c.id);
        drop.push(c.id);
        changed = true;
      }
    }
  }
  return { store: next, drop };
}

/** 在草稿裡按下送出的紀錄 */
export interface Submitted {
  draftId: string;
  at: number;
  /** 送出那一刻左欄已經有的對話：轉正後的 ID 若在其中，就不是剛建立的新對話 */
  knownIds: Set<string>;
}

/** 草稿送出到網址換成正式 ID 的最長時間（思考較久的模型也要夠用；誤判轉到既有對話已由 knownIds 擋住） */
export const PROMOTE_WINDOW_MS = 60_000;

/**
 * 離開草稿、網址換成 realId 時，要不要把草稿的父關係交給 realId。
 * 必須：在這個草稿裡按了送出、時間夠近、realId 是正式 ID、而且送出時左欄還沒有它（真的是新建立的）。
 */
export function shouldPromote(s: Submitted | null, draftId: string, realId: string | null, now: number): boolean {
  if (!s || s.draftId !== draftId || !realId || isDraft(realId) || !isValidId(realId)) return false;
  if (now - s.at > PROMOTE_WINDOW_MS || now < s.at) return false;
  return !s.knownIds.has(realId);
}

/**
 * 這筆值不值得保存：有父對話（是分支），或被別的紀錄當成父對話（是根）。
 * 沒有分支關係的一般對話不保存，避免累積使用者的對話標題瀏覽紀錄。
 */
export function isRelevant(store: Store, id: string): boolean {
  const c = get(store, id);
  if (!c) return false;
  if (isTomb(c)) return Object.values(store).some((x) => x.parentId === id);
  if (c.parentId) return true;
  return Object.values(store).some((x) => x.parentId === id);
}

export interface TreeNode {
  conv: Conv;
  children: TreeNode[];
}

/** 往上找第一個不是墓碑的父對話（墓碑被跳過，子分支等於接到上一層） */
function liveParent(s: Store, c: Conv): string | null {
  const seen = new Set<string>([c.id]);
  let p = c.parentId;
  while (p && !seen.has(p)) {
    const x = get(s, p);
    if (!x || !isTomb(x)) return p;
    seen.add(p);
    p = x.parentId;
  }
  return null;
}

/** 以目前對話所在的根建樹。目前對話不在 store 時，視為獨立的一條。墓碑不顯示。 */
export function buildTree(store: Store, currentId: string): TreeNode {
  const cur = get(store, currentId);
  // 正在看的這條即使被標成墓碑，也照原本的父關係顯示（頁面上它還在）
  let s = store;
  if (!cur) s = { ...store, [currentId]: blank(currentId) };
  else if (isTomb(cur)) {
    const { deleted: _, ...live } = cur;
    s = { ...store, [currentId]: live };
  }
  // 先建一次「父 → 子」索引（用跳過墓碑後的父），避免每個節點都掃一遍全部紀錄
  const parentOf = new Map<string, string | null>();
  const kids = new Map<string, Conv[]>();
  for (const c of Object.values(s)) {
    if (isTomb(c)) continue;
    const p = liveParent(s, c);
    parentOf.set(c.id, p);
    if (!p || p === c.id) continue;
    const list = kids.get(p);
    if (list) list.push(c);
    else kids.set(p, [c]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.seenAt - b.seenAt || a.id.localeCompare(b.id));
  // 由目前對話往上找根（遇到迴圈就停）
  let root = currentId;
  const up = new Set<string>([root]);
  for (let p = parentOf.get(root) ?? null; p && !up.has(p); p = parentOf.get(p) ?? null) {
    up.add(p);
    root = p;
  }
  const seen = new Set<string>();
  const make = (id: string): TreeNode => {
    seen.add(id);
    const conv = get(s, id) ?? blank(id);
    const children = (kids.get(id) ?? []).filter((c) => !seen.has(c.id)).map((c) => make(c.id));
    return { conv, children };
  };
  return make(root);
}

const blank = (id: string): Conv => ({ id, parentId: null, title: null, seenAt: Number.MAX_SAFE_INTEGER });

export const countNodes = (n: TreeNode): number => 1 + n.children.reduce((t, c) => t + countNodes(c), 0);


/** 結構圖標題：和 ChatGPT 的對話標題一致；沒讀到標題時用 fallback。 */
export function label(c: Conv, fallback: string): string {
  return c.title || fallback;
}

/** 讀 storage 時驗證一筆紀錄的形狀；不合格回傳 null（舊版或被破壞的資料不採用）。 */
export function parseConv(v: unknown): Conv | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isValidId(o.id) || isDraft(o.id)) return null;
  let parentId: string | null = null;
  if (o.parentId != null) {
    if (!isValidId(o.parentId) || isDraft(o.parentId)) return null;
    parentId = o.parentId === o.id ? null : o.parentId;
  }
  const title = typeof o.title === 'string' ? o.title.slice(0, 200) : null;
  const seenAt = typeof o.seenAt === 'number' && Number.isFinite(o.seenAt) ? o.seenAt : 0;
  const inf = parentId && o.inferred === true ? ({ inferred: true } as const) : {};
  if (typeof o.deleted === 'number' && Number.isFinite(o.deleted))
    return { id: o.id, parentId, title: null, seenAt, deleted: o.deleted, ...inf };
  return { id: o.id, parentId, title, seenAt, ...inf };
}

// ---- 用訊息 ID 推斷父對話 ----
// 有些帳號的 ChatGPT 版本在分支裡不顯示「接續自」連結。分支會複製父對話到分叉點為止的訊息，
// 複製來的訊息 ID 和父對話相同（頁面元素上的 data-chatgpt-selection-message-id），
// 所以「共用訊息最多、而且比較早建立的那條」就是直接父對話（祖父也共用，但共用得比較少）。

/** 每條對話看過的訊息 ID（只是編號，不含內容） */
export type MsgIndex = Record<string, string[]>;

/** 每條對話最多記幾個訊息 ID（分叉點在更後面的超長對話會比對不到，退回只看連結） */
export const MSG_CAP = 300;

const MSG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isValidMsgId = (v: unknown): v is string => typeof v === 'string' && MSG_ID_RE.test(v);

/** 併入這次看到的訊息 ID（虛擬捲動一次只渲染幾個回合，所以累積）。沒有新的就回傳原陣列。 */
export function addMessages(prev: readonly string[] | undefined, seen: readonly string[]): string[] {
  const base = prev ? [...prev] : [];
  const have = new Set(base);
  for (const m of seen) if (isValidMsgId(m) && !have.has(m) && base.length < MSG_CAP) (have.add(m), base.push(m));
  return prev && base.length === prev.length ? (prev as string[]) : base;
}

/**
 * 對話的建立時間（秒）：ChatGPT 對話 ID 的前 8 個十六進位字元是 Unix 秒（實測 2026-11-07）。
 * 草稿一定是最新的。
 */
export const createdAt = (id: string): number => (isDraft(id) ? Infinity : parseInt(id.slice(0, 8), 16));

/**
 * 推斷 id 的父對話：比它早建立、共用訊息最多的那條。沒有回傳 null。
 * 同分取最早建立的：共用一樣多，代表分叉點在較早那條就已經有了（例如從只有一則回答的主線開支線，
 * 主線的第一條支線也有那則回答），從較早那條分出來才是合理的解釋。
 */
export function inferParent(index: MsgIndex, id: string): string | null {
  const mine = Object.prototype.hasOwnProperty.call(index, id) ? new Set(index[id]) : null;
  if (!mine?.size) return null;
  const t = createdAt(id);
  let best: string | null = null;
  let bestN = 0;
  for (const [other, ids] of Object.entries(index)) {
    if (other === id || isDraft(other) || !(createdAt(other) < t)) continue;
    let n = 0;
    for (const m of ids) if (mine.has(m)) n++;
    if (n > bestN || (n === bestN && n > 0 && best && createdAt(other) < createdAt(best))) {
      best = other;
      bestN = n;
    }
  }
  return best;
}

/** 比 id 晚建立、推斷出的父對話正是 id 的那些（先造訪支線、後造訪父對話時用） */
export function inferChildren(index: MsgIndex, id: string): string[] {
  const mine = Object.prototype.hasOwnProperty.call(index, id) ? new Set(index[id]) : null;
  if (!mine?.size) return [];
  const t = createdAt(id);
  return Object.entries(index)
    .filter(([k, ids]) => k !== id && !isDraft(k) && createdAt(k) > t && ids.some((m) => mine.has(m)))
    .map(([k]) => k)
    .filter((k) => inferParent(index, k) === id);
}
