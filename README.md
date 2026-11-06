# BranchLine for ChatGPT

在 ChatGPT 右側顯示分支對話的結構圖，讓你知道自己在哪條線上、開了幾條支線，並能一鍵切回去。

> 本專案與 OpenAI 無關，非官方產品。

## 為什麼需要

用 ChatGPT 深入研究一個主題時，常會冒出幾個需要另外弄清楚的子問題。你會想先岔出去把它搞懂，再回到原本的主題繼續。但現在兩種做法都不好用：

- **在同一個對話裡追問**：不同問題混在一起，對話越拉越長。想接回原本的方向得一直往上滑，研究的思路就斷了，甚至會忘記原本還想問什麼。
- **用 ChatGPT 內建的分支開新對話**：每個問題各自乾淨，但分支一多，全都擠在左側的對話列表裡，很難分辨哪一條才是原本的主線，時間都花在找對話上。

人的思考本來就是樹狀的：往下探索、岔開，再回到上一層。對話卻只能一條線排下去。

BranchLine 把 ChatGPT 的分支畫成一張樹狀結構圖，固定顯示在畫面右側：

- **岔出去不打亂主線**：子問題開成支線，主線保持乾淨
- **隨時回得去**：一鍵切回主線，也看得出每條支線是從哪裡分出來的
- **一眼看到全貌**：清楚標出你現在在哪一條、總共開了幾條

## 功能

- 讀取 ChatGPT 原生的分支關係（「接續自」連結），在本機逐步建立結構
- 點結構圖上的節點即可切換對話
- 只有一條對話時不顯示，不佔空間
- 支援淺色／深色模式；窄視窗以覆蓋方式展開
- 工具列彈出視窗可開關；選項頁可清除本機資料

外掛只讀頁面，不替你送出訊息或修改對話。

## 安裝（從原始碼）

需要 Node.js 20 以上。

```bash
npm install
npm run build
```

1. 開啟 `chrome://extensions`
2. 右上角打開「開發人員模式」
3. 按「載入未封裝項目」，選擇 `.output/chrome-mv3/`

## 開發

```bash
npm run dev       # 開發模式（自動重新載入）
npm test          # 單元測試（Vitest）
npm run compile   # 型別檢查
```

## 專案結構

```
entrypoints/       外掛入口（content script、popup、options）；WXT 只出現在這層
lib/chatgpt-dom.ts 唯一放 ChatGPT 選擇器的地方，改版時只改這裡
lib/tree.ts        由「對話 ID＋父 ID」建樹的純函式
lib/store.ts       chrome.storage.local 讀寫
lib/ui/            結構圖渲染
design/            設計規範、tokens、結構圖樣式與圖示原檔
docs/              架構與技術選型（ARCHITECTURE.md）
prototype/         前端互動原型，僅供參考，不進外掛
tests/             單元測試
```

技術選型與資料模型詳見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，設計規範見 [design/DESIGN.md](design/DESIGN.md)。

## 已知限制

- 只知道你在這台瀏覽器造訪過的對話；其他裝置上的分支要打開過才會出現
- 依賴 ChatGPT 頁面結構，ChatGPT 改版時可能暫時失效
- 目前只支援 Chrome

## 隱私

所有資料都存在你的瀏覽器本機，不傳到任何伺服器，也不保存訊息文字（會保存對話標題，標題是 ChatGPT 依對話內容產生的）。詳見 [PRIVACY.md](PRIVACY.md)。

## 授權

[MIT](LICENSE)
