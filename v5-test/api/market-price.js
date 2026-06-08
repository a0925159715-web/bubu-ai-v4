module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { productName, category, retail, vip, vvip, cost } = req.body || {};
    if (!productName) return res.status(400).json({ error: "缺少商品名稱" });

    const serpKey = process.env.SERPAPI_API_KEY;
    if (!serpKey) {
      return res.status(200).json({
        summary: `尚未啟用外部搜尋 API，無法真正偵測外面售價。\n\n目前你的價格：\n原價：${retail}\nVIP：${vip}\nVVIP：${vvip}\n成本：${cost}\n\n建議：若要啟用真正外部比價，請在 Vercel 環境變數設定 SERPAPI_API_KEY。未設定前，系統不會假裝有查到市場價格。`
      });
    }

    const q = encodeURIComponent(`${productName} 價格 韓國代購 蝦皮`);
    const url = `https://serpapi.com/search.json?engine=google&q=${q}&gl=tw&hl=zh-tw&api_key=${serpKey}`;
    const r = await fetch(url);
    const j = await r.json();

    const texts = [];
    const items = [...(j.shopping_results || []), ...(j.organic_results || [])].slice(0, 8);
    items.forEach(x => texts.push(`${x.title || ""} ${x.price || ""} ${x.snippet || ""}`));
    const joined = texts.join("\n").slice(0, 5000);

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(200).json({
        summary: `已取得外部搜尋摘要，但未設定 GEMINI_API_KEY 進行分析：\n${joined.slice(0, 1200)}`
      });
    }

    const prompt = `你是台灣韓國代購/網拍定價顧問。根據外部搜尋摘要，判斷商品市場售價區間，並比較目前價格。

商品：${productName}
分類：${category}
目前原價：${retail}
VIP：${vip}
VVIP：${vvip}
成本：${cost}

外部搜尋摘要：
${joined}

請用繁體中文輸出：
1. 市場可能區間
2. 目前價格是否偏高/偏低/合理
3. 原價、VIP、VVIP 建議
4. 資料不足時請明確說資料不足
不要誇大。`;

    const ai = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      }
    );

    const out = await ai.json();

    if (!ai.ok) {
      return res.status(ai.status).json({ error: out.error?.message || "Gemini API error" });
    }

    const summary = out.candidates?.[0]?.content?.parts?.[0]?.text || "AI未回傳分析。";
    return res.status(200).json({ summary });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
