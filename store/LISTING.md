# Chrome 線上應用程式商店：上架資料

上傳檔：`npm run build && npx wxt zip` → `.output/branchline-<版本>-chrome.zip`

## 商品詳情（Store listing）

- 名稱（取自 manifest）：BranchLine for ChatGPT
- 摘要（取自 _locales/en 的 extDescription）：See every ChatGPT branch as a tree on the right, and jump back to the main thread in one click.
- 類別：工作效率（Productivity）→ 工具
- 語言：English（另有繁體中文介面，跟著瀏覽器語言）

### 說明

```
Deep in a ChatGPT session, side questions keep coming up. Ask them in the same chat and the main thread gets long and loses its direction. Use ChatGPT's built-in "Branch in new chat" and every branch lands in the sidebar as another "Branch · …", so it's hard to tell which one was the main thread.

BranchLine draws your ChatGPT branches as a tree, pinned to the right side of the page:

• Branch out without cluttering the main thread
• Click any node to jump back, and see where each branch came from
• Always know which line you're on and how many you've opened

Also:
• Hidden when a chat has no branches
• Works in light and dark mode
• Turn it off from the toolbar; when off, it reads nothing

Privacy:
• Runs only on chatgpt.com; everything stays in your browser
• Saves no message content and sends nothing to any server
• Doesn't read your login, and never sends or edits messages for you

Not affiliated with OpenAI.
```

### 圖片

- 商店圖示：128×128 → `public/icon/128.png`
- 截圖（依序上傳）：`store/screenshot-1-hero.png`、`screenshot-2-map.png`、`screenshot-3-detail.png`、`screenshot-4-back.png`（1280×800）
- 小型宣傳圖塊：440×280 → `store/promo-440x280.png`

## 隱私權實務（Privacy practices）

- 單一用途：
  `Shows ChatGPT branch conversations as a tree on the right side of chatgpt.com so users can see how chats branch and switch between them.`
- `storage` 權限理由：
  `Stores, locally only, the IDs, parent IDs and titles of chats that have branches, message IDs of visited chats (to work out which chat a branch came from), and user preferences (map hidden, extension on/off). No message content is stored.`
- 主機權限（content script 比對 https://chatgpt.com/*）理由：
  `Reads chat links, branch links and message IDs on chatgpt.com pages to build the branch tree, and shows the map on the page. Runs only on chatgpt.com.`
- 遠端程式碼：否
- 資料用途：不勾選任何類別（資料只在本機處理，不傳出裝置）
- 三項聲明全部勾選（不販售、不用於無關用途、不用於信用評估）
- 隱私權政策網址：https://github.com/blacktea3250106/branchline-for-chatgpt/blob/main/PRIVACY.md

## 發布設定

- 公開範圍：公開
- 地區：所有地區
- 支援網站：https://github.com/blacktea3250106/branchline-for-chatgpt/issues
