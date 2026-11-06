// 選項頁：說明保存了什麼，並提供清除全部資料的方式。
import tokensCss from '@/design/tokens.css?inline';
import { clearAll } from '@/lib/store';
import { t, type MsgKey } from '@/lib/i18n';

document.documentElement.lang = chrome.i18n.getUILanguage();
document.title = t('optionsTitle');
for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n as MsgKey);

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
  if (!confirm(t('clearConfirm'))) return;
  btn.disabled = true;
  try {
    await clearAll();
    status.textContent = t('cleared');
  } catch {
    status.textContent = t('clearFailed');
  } finally {
    btn.disabled = false;
  }
});
