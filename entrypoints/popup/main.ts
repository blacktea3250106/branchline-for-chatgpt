// 工具列彈出視窗：開關外掛。關閉後 ChatGPT 頁面立刻恢復原樣，不用重新整理。
import tokensCss from '@/design/tokens.css?inline';
import popupCss from '@/design/popup.css?inline';
import { loadEnabled, saveEnabled } from '@/lib/store';

const style = document.createElement('style');
// 上下兩列共用圖示、字體與間距；右側控制區等寬並置中。
style.textContent = `${tokensCss}\n${popupCss}`;
document.head.append(style);
// 跟著系統的淺色／深色（套用 tokens.css 的淺色那一組）
const light = matchMedia('(prefers-color-scheme: light)');
const applyTheme = () => document.documentElement.setAttribute('data-bc-theme', light.matches ? 'light' : 'dark');
light.addEventListener('change', applyTheme);
applyTheme();

const sw = document.getElementById('bc-enabled') as HTMLButtonElement;
const show = (on: boolean) => sw.setAttribute('aria-checked', String(on));

// 讀到實際狀態前不能按，也不播切換動畫（不會先閃一下「開」）
void loadEnabled().then((on) => {
  show(on);
  sw.disabled = false;
  requestAnimationFrame(() => sw.classList.add('bc-ready'));
});
// 一次只存一個；存失敗就重讀實際的值，不用猜
let saving: Promise<void> = Promise.resolve();
sw.addEventListener('click', () => {
  const on = sw.getAttribute('aria-checked') !== 'true';
  show(on);
  saving = saving.then(() => saveEnabled(on)).catch(async () => show(await loadEnabled()));
});
