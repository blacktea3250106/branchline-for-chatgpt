# Privacy Policy / 隱私權政策

Last updated / 更新日期：2026-11-07

[English](#english) · [繁體中文](#繁體中文)

## English

BranchLine for ChatGPT ("the extension") runs only on `chatgpt.com`. Everything it stores stays in your browser.

### What it stores

To draw the branch map, the extension stores the following in `chrome.storage.local` on your device:

- IDs of chats that have branches, and the ID of each one's parent chat
- Titles of those chats, as shown in the ChatGPT sidebar. ChatGPT generates these titles from your conversation (or you set them), so they can reflect what a chat is about.
- When each of those chats was first seen, and when it was deleted in ChatGPT
- Message IDs of chats you have opened (random identifiers, no message text), used to work out which chat a branch came from when the page doesn't show it. Up to 500 chats.
- Your preferences: whether the map is hidden, and whether the extension is on

It never stores message text. Chats without branches have no title stored.

### What it doesn't do

- Send any data to any server. The extension has no backend and no analytics or tracking.
- Read your login, cookies, or ChatGPT's internal APIs
- Send or edit messages for you
- Run in Incognito windows

### Permissions

- `storage`: keeps the data above on your device
- Content script on `chatgpt.com`: reads chat links, branch links and message IDs on the page, and shows the map

### Deleting your data

Click "Clear all branch data" on the extension's options page to delete everything. Removing the extension also deletes it.

### Contact

Questions: [GitHub Issues](https://github.com/blacktea3250106/branchline-for-chatgpt/issues)

## 繁體中文

BranchLine for ChatGPT（以下稱「本外掛」）只在 `chatgpt.com` 上執行，保存的資料都留在你的瀏覽器裡。

### 保存什麼

本外掛為了畫出分支結構圖，在本機（`chrome.storage.local`）保存：

- 有分支關係的對話 ID、它的父對話 ID
- 這些對話的標題（左欄顯示的名稱）。標題是 ChatGPT 根據對話內容產生的（或你自己改的），所以可能反映對話的主題。
- 這些對話第一次看到的時間，以及在 ChatGPT 被刪除的時間
- 造訪過的對話裡的訊息 ID（隨機編號，不含訊息文字）：頁面沒有標出分支來源時，用來比對分支是從哪條對話分出來的，最多 500 條對話
- 你的偏好：結構圖是否收起、外掛是否開啟

**不保存**任何訊息文字；沒有分支關係的對話不保存標題。

### 不做什麼

- 不把任何資料傳到外部伺服器；本外掛沒有後端，也不含分析或追蹤程式
- 不讀取登入憑證、Cookie，不呼叫 ChatGPT 的內部 API
- 不替你送出訊息或修改對話
- 不在無痕視窗執行

### 權限

- `storage`：保存上述本機資料
- 在 `chatgpt.com` 注入內容腳本：讀取頁面上的對話連結、分支連結與訊息 ID，並顯示結構圖

### 刪除資料

在外掛的選項頁按「清除所有分支紀錄」即可刪除全部本機資料；移除外掛時，Chrome 也會一併刪除。

### 聯絡

有疑問請在 [GitHub Issues](https://github.com/blacktea3250106/branchline-for-chatgpt/issues) 提出。
