# Bubu AI V6.5.2.4 自動偵測版

## 本版更新（V6.5.2.4）
- ✨ **AI 整理商品後自動偵測市場價格**：不用再手動按按鈕
- 🗑️ **移除偵測按鈕**：畫面更乾淨
- ❌ 偵測不到時，明確顯示「AI 偵測不到此商品的市場價格」，不假裝有查到
- 📤 **愛+1 Excel 匯出完整相容**：表頭格式、結團日期、款式拆列全部對齊愛+1範本
- 💬 匯出前 prompt 輸入結團日期（預設今天 +30 天）
- 📝 AI 市場價格偵測結果自動寫進備註欄（第 33 欄，客人看不到）

## 歷史修正（V6.5.2.x）
- 修復 V6.5.2 當機問題（缺 `</title>` / `<body>` / CDN / CSS）
- VVIP 公式校正：`0.844` → `0.84`

## 價格公式
- 原價 = ceil10((落地成本 + 54) / 0.78)
- VIP = ceil10((落地成本 + 47) / 0.82)
- VVIP = ceil10((落地成本 + 40) / 0.84)
- 落地成本：台灣模式 = 進價；韓國模式 = ceil(進價 × 1.27)

## 架構
- Frontend: 單檔 `index.html`（含 CSS + JS）
- Backend: Vercel Serverless (`api/parse-vendor.js`、`api/price-check.js`)
- 資料庫: Supabase（tasks 表）
- AI: OpenAI GPT-4.1-mini

## 環境變數（Vercel Settings → Environment Variables）
- `OPENAI_API_KEY`：必填
