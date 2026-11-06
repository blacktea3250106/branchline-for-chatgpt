// 右側分支結構圖。放在 Shadow DOM 裡，隔離 ChatGPT 的全域樣式。
// 樣式只用 design/ 的 --bc- 變數與 bm- 類別；行為對照 prototype/index.html 的 map()。
import tokensCss from '../../design/tokens.css?inline';
import { t } from '../i18n';
import mapCss from '../../design/branch-map.css?inline';
import { isDraft, label, type TreeNode } from '../tree';

// tokens.css 寫在 :root，Shadow DOM 裡要換成 :host 才會生效（淺色主題那組換成 :host([...])）。
// 打包時 CSS 會被壓縮、屬性值的引號會被拿掉，所以引號要當成可有可無。
const PANEL_CSS = `
${tokensCss.replace(/:root\[data-bc-theme=["']?light["']?\]/g, ':host([data-bc-theme="light"])').replace(/:root/g, ':host')}
${mapCss}
:host{all:initial;font-family:inherit;color:var(--bc-text);-webkit-font-smoothing:antialiased}
:host([hidden]){display:none}
/* 結構圖從 ChatGPT 頂列下方開始，不蓋住分享等按鈕；收起時滑出右緣 */
.bm{position:fixed;top:var(--bc-header);right:0;bottom:0;z-index:20;padding-top:var(--bc-map-pad-top)}
@media (prefers-reduced-motion:no-preference){.bm{transition:transform var(--bc-ease)}}
:host([data-mode="closed"]) .bm{transform:translateX(100%)}
:host([data-mode="overlay"]) .bm{box-shadow:var(--bc-overlay-shadow)}
/* 切換鈕放在 ChatGPT 頂列按鈕群（對話操作、分享）左邊，展開與收起都在同一個位置（位置由程式給） */
.bm-toggle{position:fixed;top:var(--bc-toggle-top);z-index:21}
*{box-sizing:border-box}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
:focus-visible{outline:2px solid var(--bc-strong);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*,*::before{transition:none!important}}
.bm{background:var(--bc-bg)}
`;

/** none = 不顯示（含切換鈕）；closed = 收起；push = 展開並讓位；overlay = 展開、覆蓋在對話上（窄視窗） */
export type MapMode = 'none' | 'closed' | 'push' | 'overlay';

export interface MapView {
  render(tree: TreeNode, currentId: string): void;
  setMode(mode: MapMode): void;
  setTheme(theme: 'light' | 'dark'): void;
  /** 切換鈕右緣距視窗右緣的距離 */
  setToggleRight(px: number): void;
  destroy(): void;
}

// 「側欄」圖示，右側版：外框＋靠右的分隔線
const TOGGLE_SVG =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
  '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path d="M12.5 4v12"/></svg>';

export function mountBranchMap(
  onOpen: (id: string) => void,
  /** 左欄目前顯示的標題（優先採用：和 ChatGPT 一致，改名立刻跟著變） */
  liveTitle: (id: string) => string | null,
  onToggle: () => void,
): MapView {
  const host = document.createElement('div');
  host.setAttribute('data-bc-branch-map', '');
  // closed：頁面腳本拿不到 shadowRoot
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const nav = document.createElement('nav');
  nav.className = 'bm';
  nav.setAttribute('aria-label', t('mapLabel'));
  nav.id = 'bc-map';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'bm-toggle';
  toggle.innerHTML = TOGGLE_SVG;
  toggle.setAttribute('aria-controls', 'bc-map');
  toggle.addEventListener('click', onToggle);
  root.append(style, toggle, nav);
  document.body.append(host);

  /** 使用者手動收放的狀態：id → 展開與否 */
  const openState = new Map<string, boolean>();
  let lastCurrent: string | null = null;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function render(tree: TreeNode, currentId: string) {
    const path = findPath(tree, currentId);
    const pathSet = new Set(path);
    // 切到新的對話時，把通往它的路徑展開並捲到看得見（只是標題變了時不捲，免得打斷使用者捲動）
    const switched = currentId !== lastCurrent;
    if (switched) {
      path.slice(0, -1).forEach((id) => openState.set(id, true));
      lastCurrent = currentId;
    }
    const isOpen = (id: string) => openState.get(id) ?? true;

    const row = (n: TreeNode, depth: number, isRoot: boolean): HTMLLIElement => {
      const c = n.conv;
      const on = c.id === currentId;
      const li = el('li', isRoot ? '' : 'bm-child' + (pathSet.has(c.id) ? ' bm-path' : ''));
      const r = el('div', 'bm-row' + (on ? ' bm-active' : ''));
      const b = el('button', 'bm-node' + (isRoot ? ' bm-trunk' : '') + (on ? ' bm-on' : '') + (isDraft(c.id) ? ' bm-draft' : ''));
      const text = isDraft(c.id) ? t('newBranch') : (liveTitle(c.id) ?? label(c, t('untitled')));
      b.type = 'button';
      b.append(el('span', undefined, text));
      b.title = text;
      b.dataset.id = c.id;
      if (on) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', () => {
        if (!on) onOpen(c.id);
      });
      r.append(b);
      li.append(r);
      if (n.children.length) {
        const wrap = el('div', 'bm-wrap');
        const ul = el('ul', 'bm-kids' + (depth >= 3 ? ' bm-flat' : ''));
        n.children.forEach((k) => ul.append(row(k, depth + 1, false)));
        wrap.append(ul);
        const chev = el('button', 'bm-chev');
        chev.type = 'button';
        chev.dataset.id = c.id;
        // 只切換 class，不重畫，所以收放有動畫
        const apply = () => {
          const o = isOpen(c.id);
          wrap.classList.toggle('bm-closed', !o);
          chev.classList.toggle('bm-shut', !o);
          chev.setAttribute('aria-expanded', String(o));
          chev.setAttribute('aria-label', t(o ? 'collapseNode' : 'expandNode', text));
        };
        chev.addEventListener('click', () => {
          openState.set(c.id, !isOpen(c.id));
          apply();
        });
        r.append(chev);
        li.append(wrap);
        apply();
      }
      return li;
    };

    // 焦點原本在結構圖裡（鍵盤使用者）時，重畫後放回同一個節點；焦點在 ChatGPT 那邊就不碰
    const active = root.activeElement as HTMLElement | null;
    const focusId = active?.dataset?.id;
    const focusChev = !!active?.classList.contains('bm-chev');
    const ul = el('ul');
    ul.append(row(tree, 0, true));
    nav.replaceChildren(ul);
    if (focusId) nav.querySelector<HTMLElement>(`.${focusChev ? 'bm-chev' : 'bm-node'}[data-id="${CSS.escape(focusId)}"]`)?.focus();
    if (switched) nav.querySelector('.bm-on')?.scrollIntoView({ block: 'nearest' });
  }

  let lastMode: MapMode | null = null;
  function setMode(mode: MapMode) {
    // ChatGPT 重繪頁面時可能把我們的面板移掉，不在就放回去
    if (!host.isConnected) document.body.append(host);
    // 沒變就不動屬性：每次 tick 都會呼叫，避免無謂的 DOM 變動
    if (mode === lastMode) return;
    lastMode = mode;
    host.toggleAttribute('hidden', mode === 'none');
    host.dataset.mode = mode;
    const open = mode === 'push' || mode === 'overlay';
    nav.inert = !open; // 收起時 Tab 不會走進看不見的節點
    toggle.setAttribute('aria-expanded', String(open));
    const tip = open ? t('hideMap') : t('showMap');
    toggle.setAttribute('aria-label', tip);
    toggle.title = tip;
  }

  return {
    render,
    setMode,
    setTheme: (th) => {
      if (host.getAttribute('data-bc-theme') !== th) host.setAttribute('data-bc-theme', th);
    },
    setToggleRight: (px) => {
      toggle.style.right = `${px}px`;
    },
    destroy: () => host.remove(),
  };
}

function findPath(n: TreeNode, id: string): string[] {
  if (n.conv.id === id) return [id];
  for (const k of n.children) {
    const p = findPath(k, id);
    if (p.length) return [n.conv.id, ...p];
  }
  return [];
}
