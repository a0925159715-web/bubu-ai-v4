function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callOpenAI({ prompt, retries = 1 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "請使用繁體中文，保守分析市場售價，不要把不同規格或不同商品混在一起。" },
            { role: "user", content: prompt }
          ],
          temperature: 0.15
        })
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error?.message || `OpenAI API error ${r.status}`);
      return out.choices?.[0]?.message?.content || "資料不足，無法確認市場售價。";
    } catch (e) {
      lastError = e;
      if (i < retries) await sleep(2000);
    }
  }
  throw lastError;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      productName, category, retail, vip, vvip, cost,
      estimatedCost, safeAllocation, inboundShipping
    } = req.body || {};
    if (!productName) return res.status(400).json({ error: "缺少商品名稱" });

    const fullCost = Number(estimatedCost) || Number(cost) || 0;
    const serpKey = process.env.SERPAPI_API_KEY;
    if (!serpKey) {
      return res.status(200).json({
        summary: `尚未啟用外部搜尋 API，無法真正偵測外面售價。\n\n目前價格：\n一般售價：${retail}\n鐵粉價：${vip}\nVIP會員價：${vvip}\n完整預估成本：${fullCost}\n\n成本內容：進貨 ${cost || 0}＋安全分攤 ${safeAllocation || 0}＋入庫運費 ${inboundShipping || 0}。\n未設定 SERPAPI_API_KEY 前，系統不會假裝查到市場價格。`
      });
    }

    const cleanName = String(productName).replace(/^[A-Z0-9#-]+\s+/i, "").trim();
    const q = encodeURIComponent(`${cleanName} ${category === "skincare" ? "容量" : "規格"} 價格 台灣 韓國代購 蝦皮`);
    const url = `https://serpapi.com/search.json?engine=google&q=${q}&gl=tw&hl=zh-tw&num=10&api_key=${serpKey}`;
    const r = await fetch(url);
    const j = await r.json();

    if (!r.ok || j.error) {
      return res.status(200).json({
        summary: `外部搜尋暫時失敗，無法真正偵測外面售價。\n原因：${j.error || r.status}\n\n目前價格：一般售價 ${retail}／鐵粉價 ${vip}／VIP會員價 ${vvip}／完整預估成本 ${fullCost}`
      });
    }

    const items = [...(j.shopping_results || []), ...(j.organic_results || [])].slice(0, 10);
    const texts = items.map((x, i) => [
      `資料${i + 1}`,
      x.title ? `標題：${x.title}` : "",
      x.price ? `價格：${x.price}` : "",
      x.snippet || x.description ? `摘要：${x.snippet || x.description}` : "",
      x.source ? `來源：${x.source}` : ""
    ].filter(Boolean).join("\n"));
    const joined = texts.join("\n\n").slice(0, 7000);

    if (!joined.trim()) {
      return res.status(200).json({
        summary: `外部搜尋資料不足，無法確認市場售價。\n\n目前價格：一般售價 ${retail}／鐵粉價 ${vip}／VIP會員價 ${vvip}／完整預估成本 ${fullCost}。`
      });
    }

    const prompt = `你是台灣韓國代購／網拍定價顧問。請根據搜尋摘要，先判斷結果是否為同一商品、相同容量或相近規格，再分析價格；不同商品不得硬比。

商品：${productName}
分類：${category}
一般售價：${retail}
鐵粉價：${vip}
VIP會員價：${vvip}
商品進貨成本：${cost || 0}
每件安全分攤：${safeAllocation || 0}
預估入庫運費：${inboundShipping || 0}
完整預估成本：${fullCost}

外部搜尋摘要：
${joined}

請用繁體中文輸出：
1. 可比較資料是否足夠
2. 同商品或相近規格的市場可能區間
3. 一般售價／鐵粉價／VIP會員價偏高、偏低或合理
4. 以完整預估成本判斷是否仍有合理留下
5. 若資料混雜或不足，必須明確說資料不足
不要誇大，不要把搜尋摘要中的成本、月費或組合價當成單品售價。`;

    const summary = await callOpenAI({ prompt, retries: 1 });
    return res.status(200).json({ summary });
  } catch (e) {
    return res.status(500).json({ error: e.message || "市場價格偵測失敗" });
  }
};
