// 選項頁：說明保存了什麼，並提供清除全部資料的方式。
import tokensCss from '@/design/tokens.css?inline';
import { clearAll } from '@/lib/store';

const style = document.createElement('style');
style.textContent = `${tokensCss}
body{margin:0;background:var(--bc-bg);color:var(--bc-text);font:14px/1.6 system-ui,sans-serif}
.bc-opt{max-width:var(--bc-page-w);padding:var(--bc-page-pad)}
.bc-opt h1{font-size:16px;font-weight:600;margin:0 0 8px}
.bc-opt p{color:var(--bc-mute);margin:0 0 16px}
.bc-opt button{font:inherit;color:var(--bc-text);background:none;border:1px solid var(--bc-line);border-radius:var(--bc-radius);padding:6px 12px;cursor:pointer}
.bc-opt button:hover{background:var(--bc-hover)}`;
document.head.append(style);
// 跟著系統的淺色／深色（套用 tokens.css 的淺色那一組）
const light = matchMedia('(prefers-color-scheme: light)');
const applyTheme = () => document.documentElement.setAttribute('data-bc-theme', light.matches ? 'light' : 'dark');
light.addEventListener('change', applyTheme);
applyTheme();

const btn = document.getElementById('bc-clear') as HTMLButtonElement;
const status = document.getElementById('bc-status') as HTMLElement;
btn.addEventListener('click', async () => {
  if (!confirm('清除所有分支紀錄？這個動作無法復原。')) return;
  btn.disabled = true;
  try {
    await clearAll();
    status.textContent = '已清除。';
  } catch {
    status.textContent = '清除失敗，請重新整理後再試。';
  } finally {
    btn.disabled = false;
  }
});
