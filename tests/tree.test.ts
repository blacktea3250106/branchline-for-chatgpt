import { describe, expect, it } from 'vitest';
import {
  addMessages,
  buildTree,
  inferChildren,
  inferParent,
  countNodes,
  get,
  isRelevant,
  isValidId,
  label,
  mergeObservation,
  parseConv,
  PROMOTE_WINDOW_MS,
  promoteDraft,
  remove,
  markDeleted,
  pruneTombstones,
  TOMBSTONE_TTL_MS,
  shouldPromote,
  type Conv,
  type Store,
} from '../lib/tree';

/** 測試用的合法對話 ID（ChatGPT 的 ID 是 UUID 形式） */
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = (n: number) => `local-chatgpt:${u(n)}`;
const [A, B, C, R, X] = [u(1), u(2), u(3), u(4), u(5)];

const obs = (id: string, parentId: string | null = null, title: string | null = null) => ({ id, parentId, title });
const conv = (id: string, parentId: string | null = null, seenAt = 0): Conv => ({ id, parentId, title: null, seenAt });

describe('isValidId', () => {
  it('只接受 UUID 形式（含草稿前綴）', () => {
    expect(isValidId(A)).toBe(true);
    expect(isValidId(D(1))).toBe(true);
    for (const bad of ['constructor', '__proto__', '', 'abc', '../x', `${A}x`, 42, null]) expect(isValidId(bad)).toBe(false);
  });
});

describe('mergeObservation', () => {
  it('新增一筆並記下第一次看到的時間', () => {
    const s = mergeObservation({}, obs(A, null, 'T'), 5);
    expect(s[A]).toEqual({ id: A, parentId: null, title: 'T', seenAt: 5 });
  });

  it('這次沒讀到父對話時，不清掉已存的父對話', () => {
    let s = mergeObservation({}, obs(B, A), 1);
    s = mergeObservation(s, obs(B, null), 2);
    expect(s[B]?.parentId).toBe(A);
    expect(s[B]?.seenAt).toBe(1);
  });

  it('沒有變化時回傳同一個物件', () => {
    const s = mergeObservation({}, obs(A, null, 'T'), 1);
    expect(mergeObservation(s, obs(A, null, 'T'), 2)).toBe(s);
    expect(mergeObservation(s, obs(A), 3)).toBe(s);
  });

  it('父對話指向自己、或 ID 格式不對時忽略', () => {
    expect(mergeObservation({}, obs(A, A), 1)[A]?.parentId).toBeNull();
    expect(mergeObservation({}, obs(A, 'constructor'), 1)[A]?.parentId).toBeNull();
    const s: Store = {};
    expect(mergeObservation(s, obs('constructor', A), 1)).toBe(s);
  });
});

describe('promoteDraft', () => {
  const draft = conv(D(1), A, 7);

  it('草稿送出後，父關係交給全新的正式 ID', () => {
    expect(promoteDraft({}, draft, R)[R]).toEqual({ id: R, parentId: A, title: null, seenAt: 7 });
  });

  it('正式 ID 已經存在時不動（不會把既有對話接成分支）', () => {
    const s: Store = { [X]: conv(X) };
    expect(promoteDraft(s, draft, X)).toBe(s);
  });

  it('正式 ID 就是草稿的父對話時不動（不會讓對話成為自己的父）', () => {
    const s: Store = {};
    expect(promoteDraft(s, draft, A)).toBe(s);
  });

  it('草稿沒有父對話、或目標是草稿時不動', () => {
    const s: Store = {};
    expect(promoteDraft(s, conv(D(2)), R)).toBe(s);
    expect(promoteDraft(s, draft, D(3))).toBe(s);
  });

  it('remove 沒有那筆時不變', () => {
    const s: Store = {};
    expect(remove(s, A)).toBe(s);
  });
});

describe('isRelevant', () => {
  it('分支和被當成父的根要存，一般對話不存', () => {
    const s: Store = { [A]: conv(A), [B]: conv(B, A), [X]: conv(X) };
    expect(isRelevant(s, A)).toBe(true);
    expect(isRelevant(s, B)).toBe(true);
    expect(isRelevant(s, X)).toBe(false);
    expect(isRelevant(s, 'constructor')).toBe(false);
  });
});

describe('chain / buildTree', () => {
  const s = [obs(R), obs(A, R), obs(B, A), obs(C, R)].reduce((acc, o, i) => mergeObservation(acc, o, i), {} as Store);

  it('遇到迴圈會停', () => {
    const loop: Store = { [X]: conv(X, A), [A]: conv(A, X) };
    expect(countNodes(buildTree(loop, X))).toBe(2);
  });

  it('從任何一條都建出同一棵樹，兄弟依第一次看到的順序', () => {
    const t = buildTree(s, B);
    expect(t.conv.id).toBe(R);
    expect(t.children.map((c) => c.conv.id)).toEqual([A, C]);
    expect(t.children[0]?.children.map((c) => c.conv.id)).toEqual([B]);
    expect(countNodes(buildTree(s, C))).toBe(4);
  });

  it('父對話沒存過時，根就是那個父 ID', () => {
    const t = buildTree(mergeObservation({}, obs(B, X), 0), B);
    expect(t.conv.id).toBe(X);
    expect(t.children.map((c) => c.conv.id)).toEqual([B]);
  });

  it('目前對話不在 store 時，視為獨立的一條', () => {
    const t = buildTree(s, X);
    expect(t.conv.id).toBe(X);
    expect(t.children).toEqual([]);
  });

  it('不會讀到 Object.prototype 上的屬性', () => {
    expect(get({}, 'constructor')).toBeUndefined();
    expect(() => buildTree({}, 'constructor')).not.toThrow();
  });
});

describe('label', () => {
  it('一律用對話標題，沒有標題才用 fallback', () => {
    expect(label({ ...conv(B, R), title: '分支 · T' }, '?')).toBe('分支 · T');
    expect(label(conv(B, R), '?')).toBe('?');
  });
});

describe('parseConv', () => {
  it('合格的紀錄照收，標題過長會截斷', () => {
    expect(parseConv({ id: A, parentId: R, title: 'x'.repeat(300), seenAt: 3 })).toEqual({
      id: A,
      parentId: R,
      title: 'x'.repeat(200),
      seenAt: 3,
    });
  });

  it('壞掉、草稿、或 ID 不合格的紀錄不收', () => {
    for (const bad of [null, 'x', 1, {}, { id: 'constructor' }, { id: D(1) }, { id: A, parentId: '../x' }, { id: A, parentId: D(2) }])
      expect(parseConv(bad)).toBeNull();
  });

  it('舊版多出來的欄位（firstQuestion）會被丟掉', () => {
    expect(parseConv({ id: A, parentId: null, title: 'T', firstQuestion: 'Q', seenAt: 1 })).toEqual({
      id: A,
      parentId: null,
      title: 'T',
      seenAt: 1,
    });
  });
});

describe('markDeleted（墓碑）', () => {
  const s: Store = { [R]: { ...conv(R), title: 'root' }, [A]: { ...conv(A, R), title: 'a' }, [B]: conv(B, A), [C]: conv(C, A) };

  it('被刪的中間節點變成墓碑、清掉標題，子分支的父 ID 不改', () => {
    const r = markDeleted(s, A, 9);
    expect(r.store[A]).toEqual({ id: A, parentId: R, title: null, seenAt: 0, deleted: 9 });
    expect(r.store[B]?.parentId).toBe(A);
    expect(r.saved?.id).toBe(A);
  });

  it('結構圖跳過墓碑，子分支顯示在上一層', () => {
    const t = buildTree(markDeleted(s, A, 9).store, B);
    expect(t.conv.id).toBe(R);
    expect(t.children.map((c) => c.conv.id)).toEqual([B, C]);
  });

  it('再讀到那條對話就拿掉墓碑，樹完整恢復（中間節點、葉子、根都一樣）', () => {
    for (const id of [A, B, R]) {
      const before = s[id]!;
      const back = mergeObservation(markDeleted(s, id, 9).store, obs(id, before.parentId, before.title), 10);
      expect(back[id]?.deleted).toBeUndefined();
      expect(back[id]?.parentId).toBe(before.parentId);
      expect(back[id]?.seenAt).toBe(before.seenAt);
    }
  });

  it('正在看的那條即使被標成墓碑，也照原本的父關係顯示', () => {
    const t = buildTree(markDeleted(s, A, 9).store, A);
    expect(t.conv.id).toBe(R);
    expect(t.children[0]?.conv.id).toBe(A);
  });

  it('刪掉根：子分支各自成為根', () => {
    const t = buildTree(markDeleted(s, R, 9).store, A);
    expect(t.conv.id).toBe(A);
    expect(countNodes(t)).toBe(3);
  });

  it('沒存過、但被當成父的對話也能標成刪除', () => {
    const only: Store = { [A]: conv(A, X) };
    const r = markDeleted(only, X, 9);
    expect(r.store[X]).toEqual({ id: X, parentId: null, title: null, seenAt: 9, deleted: 9 });
    expect(buildTree(r.store, A).conv.id).toBe(A);
  });

  it('已是墓碑或不存在時不變', () => {
    const del = markDeleted(s, A, 9).store;
    expect(markDeleted(del, A, 10).store).toBe(del);
    expect(markDeleted(s, X, 10).store).toBe(s);
  });

  it('從 storage 讀回的墓碑不帶標題', () => {
    expect(parseConv({ id: A, parentId: R, title: 'x', seenAt: 1, deleted: 5 })).toEqual({
      id: A,
      parentId: R,
      title: null,
      seenAt: 1,
      deleted: 5,
    });
  });
});

describe('pruneTombstones', () => {
  it('過期、沒有子分支的墓碑清掉；根因此沒有分支關係也一併清掉', () => {
    const two: Store = { [R]: conv(R), [A]: { ...conv(A, R), deleted: 0 } };
    const r = pruneTombstones(two, TOMBSTONE_TTL_MS + 1);
    expect(r.drop.sort()).toEqual([A, R].sort());
  });

  it('沒過期的、或還有子分支的墓碑保留', () => {
    const s: Store = { [R]: conv(R), [A]: { ...conv(A, R), deleted: 0 }, [B]: conv(B, A), [C]: { ...conv(C, R), deleted: 5 } };
    expect(pruneTombstones(s, 10).drop).toEqual([]);
    expect(pruneTombstones(s, TOMBSTONE_TTL_MS + 100).drop).toEqual([C]);
  });
});

describe('shouldPromote', () => {
  const sub = { draftId: D(1), at: 1000, knownIds: new Set([X]) };

  it('在這個草稿送出、時間內、換成左欄原本沒有的新 ID 才轉正', () => {
    expect(shouldPromote(sub, D(1), R, 2000)).toBe(true);
  });

  it('沒送出、別的草稿送出、超過時間、或換成既有對話都不轉正', () => {
    expect(shouldPromote(null, D(1), R, 2000)).toBe(false);
    expect(shouldPromote(sub, D(2), R, 2000)).toBe(false);
    expect(shouldPromote(sub, D(1), R, 1000 + PROMOTE_WINDOW_MS + 1)).toBe(false);
    expect(shouldPromote(sub, D(1), X, 2000)).toBe(false);
    expect(shouldPromote(sub, D(1), null, 2000)).toBe(false);
    expect(shouldPromote(sub, D(1), D(3), 2000)).toBe(false);
  });
});

describe('父對話不被覆寫', () => {
  it('已存的父對話不會被之後讀到的不同值蓋掉', () => {
    let s = mergeObservation({}, obs(B, A), 1);
    s = mergeObservation(s, obs(B, C), 2);
    expect(s[B]?.parentId).toBe(A);
  });

  it('正式對話的父不會是草稿', () => {
    expect(mergeObservation({}, obs(B, D(1)), 1)[B]?.parentId).toBeNull();
  });
});

describe('用訊息 ID 推斷父對話', () => {
  // 對話 ID 前 8 碼是建立時間（秒）：A 最早、B 是 A 的分支、C 是 B 的分支
  const A = '6aee0c13-6a54-83e8-a779-7c52aa01a030';
  const B = '6aee0c73-445c-83ee-baeb-c84b1c554eb8';
  const C = '6aee0d00-445c-83ee-baeb-c84b1c554eb8';
  const D = 'local-chatgpt:a8a5ee0c-e410-4958-b0a4-98690c8289cd';
  const m = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const idx = {
    [A]: [m(1), m(2), m(3)],
    [B]: [m(1), m(2), m(4)],
    [C]: [m(1), m(2), m(4), m(5)],
  };

  it('取共用最多、比較早建立的那條（祖父共用較少，不會被選）', () => {
    expect(inferParent(idx, B)).toBe(A);
    expect(inferParent(idx, C)).toBe(B);
    expect(inferParent(idx, A)).toBeNull();
  });

  it('草稿永遠最新，可以推斷出父對話', () => {
    expect(inferParent({ ...idx, [D]: [m(1), m(2), m(4), m(5)] }, D)).toBe(C);
  });

  it('後造訪父對話時找得到子分支', () => {
    expect(inferChildren(idx, A)).toEqual([B]);
    expect(inferChildren(idx, B)).toEqual([C]);
  });

  it('共用一樣多時取最早建立的（從主線開第二條支線，不會掛到第一條支線底下）', () => {
    const E = '6aee0e00-445c-83ee-baeb-c84b1c554eb8';
    const i2 = { [A]: [m(1)], [B]: [m(1), m(4)], [E]: [m(1), m(6)] };
    expect(inferParent(i2, E)).toBe(A);
  });

  it('沒有共用訊息就不推斷', () => {
    expect(inferParent({ [A]: [m(9)], [B]: [m(8)] }, B)).toBeNull();
  });

  it('推斷的父可被連結改寫，連結的父不會被推斷改寫', () => {
    let s = mergeObservation({}, { id: C, parentId: A, title: null, inferred: true }, 1);
    expect(s[C]).toMatchObject({ parentId: A, inferred: true });
    s = mergeObservation(s, { id: C, parentId: B, title: null }, 2);
    expect(s[C]!.parentId).toBe(B);
    expect(s[C]!.inferred).toBeUndefined();
    s = mergeObservation(s, { id: C, parentId: A, title: null, inferred: true }, 3);
    expect(s[C]!.parentId).toBe(B);
  });

  it('addMessages 累積、去重、過濾格式不對的 ID', () => {
    const a = addMessages(undefined, [m(1), m(1), 'x']);
    expect(a).toEqual([m(1)]);
    expect(addMessages(a, [m(1)])).toBe(a);
    expect(addMessages(a, [m(2)])).toEqual([m(1), m(2)]);
  });

  it('parseConv 保留 inferred', () => {
    expect(parseConv({ id: B, parentId: A, title: null, seenAt: 1, inferred: true })?.inferred).toBe(true);
  });
});
