import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'BranchLine for ChatGPT',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // 明確宣告工具列 action，避免 Chrome 將未宣告 action 的圖示在非 ChatGPT 頁面灰化。
    // 這不會擴大 content_scripts 的網站存取範圍。
    action: {
      default_title: 'BranchLine for ChatGPT',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
    // 只需要 storage；在 chatgpt.com 注入由 content_scripts.matches 負責，不需要另外的 host 權限
    permissions: ['storage'],
    // 無痕視窗不執行：content script 判斷不了自己是否在無痕視窗，不執行才能保證無痕對話不會被記下
    incognito: 'not_allowed',
    // 用到 HTMLElement.inert（Chrome 102 起支援）
    minimum_chrome_version: '102',
  },
});
