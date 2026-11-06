// chrome.storage.local 的讀寫。
// 保存的資料（只存在這台電腦，不傳到任何地方）：有分支關係的對話 ID、父對話 ID、對話標題、第一次看到的時間，
// 造訪過的對話的訊息 ID（只是編號，用來在頁面沒有「接續自」連結時比對出父對話），
// 以及結構圖是否收起、外掛是否開啟。不存訊息文字（對話標題是 ChatGPT 依對話產生的）。外掛不在無痕視窗執行（manifest incognito: not_allowed）。
import { addMessages, isValidId, isValidMsgId, MSG_CAP, parseConv, pickParent, type Conv, type MsgIndex, type Store } from './tree';

/** 每條對話一個 key：多個分頁同時寫不同對話時不會互相蓋掉 */
const CONV_PREFIX = 'bc-c:';
/** 每條對話看過的訊息 ID：{ ids, at }（at = 最後更新時間，超過上限時先丟最舊的） */
const MSG_PREFIX = 'bc-m:';
/** 最多記幾條對話的訊息 ID */
export const MSG_CONV_CAP = 500;
const PREFS_KEY = 'bc-prefs-v1';
/** 選項頁按「清除」的時間：開著的分頁收到後，在使用者換到下一條對話前都不再寫入（不會馬上把剛清掉的存回去） */
const CLEARED_KEY = 'bc-cleared';
/** 外掛開關（工具列彈出視窗）：false = 在 ChatGPT 上完全不作用。單獨一個 key，和收起狀態分開寫，不會互相蓋掉 */
const ENABLED_KEY = 'bc-enabled';

let warned = false;
const warn = (e: unknown) => {
  if (warned) return;
  warned = true;
  console.warn('[branchline] 無法存取 chrome.storage', e);
};

export async function load(): Promise<Store> {
  let all: Record<string, unknown>;
  try {
    all = await chrome.storage.local.get(null);
  } catch (e) {
    warn(e);
    return {};
  }
  const store: Store = {};
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(CONV_PREFIX)) continue;
    const c = parseConv(v);
    if (c && k === CONV_PREFIX + c.id) store[c.id] = c;
  }
  return store;
}

/**
 * 寫入一筆，回傳實際存下的值（和傳入的不同時，呼叫端要更新記憶體）；沒寫入回傳 null。
 * 在 Web Lock 裡讀最新紀錄再決定，避免多個分頁互相蓋掉：
 * - 已被清除（清除時間晚於這次寫入的請求）或外掛已關閉：不寫（等待鎖的舊寫入不會在清除或關閉後落地）
 * - 給 notAfter（這個頁面的載入時間）時，storage 裡若是這個頁面載入之後才標的墓碑（另一個分頁剛刪除），以墓碑為準
 * - 一般紀錄：保留 storage 裡已有的父關係與第一次看到的時間，只更新這次讀到的欄位
 */
export async function saveConv(c: Conv, notAfter?: number): Promise<Conv | null> {
  const key = CONV_PREFIX + c.id;
  const requestedAt = Date.now();
  const run = async (): Promise<Conv | null> => {
    try {
      const r = await chrome.storage.local.get([key, CLEARED_KEY, ENABLED_KEY]);
      const cleared = r[CLEARED_KEY];
      if ((typeof cleared === 'number' && cleared >= requestedAt) || r[ENABLED_KEY] === false) return null;
      const cur = parseConv(r[key]);
      let next = c;
      if (cur && c.deleted === undefined) {
        if (cur.deleted !== undefined) {
          if (notAfter !== undefined && cur.deleted >= notAfter) return cur;
        } else {
          const { inferred: _, ...rest } = c;
          next = { ...rest, ...pickParent(cur, c.parentId, !!c.inferred), seenAt: cur.seenAt, title: c.title ?? cur.title };
        }
      }
      await chrome.storage.local.set({ [key]: next });
      return next;
    } catch (e) {
      warn(e);
      return null;
    }
  };
  // 所有 ChatGPT 分頁同源，用 Web Locks 讓「讀、檢查、寫」一次只有一個分頁在做
  return navigator.locks ? navigator.locks.request(`bc-conv:${c.id}`, run) : run();
}

/** storage 裡一筆訊息 ID 紀錄 → 合法的 ID 陣列；格式不對回傳 undefined */
function parseMsgs(v: unknown): string[] | undefined {
  const o = v as { ids?: unknown } | null;
  return o && typeof o === 'object' && Array.isArray(o.ids) ? o.ids.filter(isValidMsgId).slice(0, MSG_CAP) : undefined;
}

/** 讀全部訊息 ID 索引；超過上限時刪掉最久沒更新的 */
export async function loadMsgs(): Promise<MsgIndex> {
  let all: Record<string, unknown>;
  try {
    all = await chrome.storage.local.get(null);
  } catch (e) {
    warn(e);
    return {};
  }
  const rows: [string, string[], number][] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(MSG_PREFIX)) continue;
    const id = k.slice(MSG_PREFIX.length);
    const ids = parseMsgs(v);
    if (!isValidId(id) || !ids) continue;
    const at = (v as { at?: unknown }).at;
    rows.push([id, ids, typeof at === 'number' ? at : 0]);
  }
  rows.sort((a, b) => b[2] - a[2]);
  const drop = rows.slice(MSG_CONV_CAP).map(([id]) => MSG_PREFIX + id);
  if (drop.length) void chrome.storage.local.remove(drop).catch(warn);
  return Object.fromEntries(rows.slice(0, MSG_CONV_CAP).map(([id, ids]) => [id, ids]));
}

/**
 * 存一條對話的訊息 ID，回傳實際存下的（和 storage 裡已有的合併後）；沒寫入回傳 null。
 * 在 Web Lock 裡先讀 storage 再合併：多個分頁看過同一條、捲到的範圍不同時，不會互相蓋掉。
 * 清除時間晚於這次寫入的請求、或外掛已關閉：不寫（和 saveConv 同一條規則）。
 */
export async function saveMsgs(id: string, ids: string[]): Promise<string[] | null> {
  const key = MSG_PREFIX + id;
  const requestedAt = Date.now();
  const run = async (): Promise<string[] | null> => {
    try {
      const r = await chrome.storage.local.get([key, CLEARED_KEY, ENABLED_KEY]);
      const cleared = r[CLEARED_KEY];
      if ((typeof cleared === 'number' && cleared >= requestedAt) || r[ENABLED_KEY] === false) return null;
      const merged = addMessages(parseMsgs(r[key]), ids);
      await chrome.storage.local.set({ [key]: { ids: merged, at: Date.now() } });
      return merged;
    } catch (e) {
      warn(e);
      return null;
    }
  };
  return navigator.locks ? navigator.locks.request(`bc-msgs:${id}`, run) : run();
}

/** 刪掉幾條對話的訊息 ID（清過期墓碑時用：對話被清掉，就不該再被拿來推斷父對話） */
export async function removeMsgs(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    await chrome.storage.local.remove(ids.map((id) => MSG_PREFIX + id));
  } catch (e) {
    warn(e);
  }
}

export async function removeConv(id: string): Promise<void> {
  try {
    await chrome.storage.local.remove(CONV_PREFIX + id);
  } catch (e) {
    warn(e);
  }
}

/** 清除外掛存的全部資料（選項頁的「清除」按鈕用）。 */
export async function clearAll(): Promise<void> {
  // 先寫「已清除」標記：開著的分頁先收到它、停止寫入，再刪資料；1 秒後再刪一次，清掉清除當下正在進行的寫入
  await chrome.storage.local.set({ [CLEARED_KEY]: Date.now() });
  const wipe = async () => {
    const keys = Object.keys(await chrome.storage.local.get(null)).filter((k) => k !== CLEARED_KEY && k !== ENABLED_KEY); // 清除紀錄不改開關
    if (keys.length) await chrome.storage.local.remove(keys);
  };
  await wipe();
  await new Promise((r) => setTimeout(r, 1000));
  await wipe();
}

/** 使用者偏好：結構圖收起與否（全域一個值，跨對話、重新整理都保留）。 */
export interface Prefs {
  collapsed: boolean;
}

const parsePrefs = (v: unknown): Prefs => ({
  collapsed: !!v && typeof v === 'object' && (v as Record<string, unknown>).collapsed === true,
});

export async function loadPrefs(): Promise<Prefs> {
  try {
    const r = await chrome.storage.local.get(PREFS_KEY);
    return parsePrefs(r[PREFS_KEY]);
  } catch (e) {
    warn(e);
    return { collapsed: false };
  }
}

export async function savePrefs(p: Prefs): Promise<void> {
  try {
    await chrome.storage.local.set({ [PREFS_KEY]: p });
  } catch (e) {
    warn(e);
  }
}

/** 外掛是否開啟：預設開；只有明確存成 false 才算關 */
export async function loadEnabled(): Promise<boolean> {
  try {
    return (await chrome.storage.local.get(ENABLED_KEY))[ENABLED_KEY] !== false;
  } catch (e) {
    warn(e);
    return true;
  }
}

export async function saveEnabled(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [ENABLED_KEY]: on });
}

export interface ExternalChange {
  /** 有變動的對話：值為 null 表示被刪除 */
  convs: Map<string, Conv | null>;
  /** 有變動的訊息 ID（其他分頁看過的）：值為 null 表示被刪除 */
  msgs: Map<string, string[] | null>;
  /** 偏好有變動時才有 */
  prefs?: Prefs;
  /** 選項頁剛清除了全部資料 */
  cleared?: boolean;
  /** 開關有變動時才有 */
  enabled?: boolean;
}

/** 其他分頁（或選項頁的清除）改了資料時通知。 */
export function onExternalChange(cb: (c: ExternalChange) => void): () => void {
  const fn = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    const out: ExternalChange = { convs: new Map(), msgs: new Map() };
    for (const [k, ch] of Object.entries(changes)) {
      if (k === CLEARED_KEY) out.cleared = ch.newValue !== undefined;
      else if (k === PREFS_KEY) out.prefs = parsePrefs(ch.newValue);
      else if (k === ENABLED_KEY) out.enabled = ch.newValue !== false;
      else if (k.startsWith(CONV_PREFIX)) {
        const id = k.slice(CONV_PREFIX.length);
        if (!isValidId(id)) continue;
        const c = ch.newValue === undefined ? null : parseConv(ch.newValue);
        if (c === null || c.id === id) out.convs.set(id, c);
      } else if (k.startsWith(MSG_PREFIX)) {
        const id = k.slice(MSG_PREFIX.length);
        if (!isValidId(id)) continue;
        const ids = ch.newValue === undefined ? null : parseMsgs(ch.newValue);
        if (ids !== undefined) out.msgs.set(id, ids);
      }
    }
    if (out.convs.size || out.msgs.size || out.prefs || out.cleared || out.enabled !== undefined) cb(out);
  };
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
}
