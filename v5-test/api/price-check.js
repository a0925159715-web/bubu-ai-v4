module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not set" });

    const {
      productName, category, retail, vip, vvip, cost,
      estimatedCost, safeAllocation, inboundShipping, copy
    } = req.body || {};

    if (!productName) return res.status(400).json({ error: "缺少商品名稱" });

    const fullCost = Number(estimatedCost) || Number(cost) || 0;
    const prompt = `你是台灣韓國代購賣家的價格策略助理，使用 BUBU AI V7.5.3 定價結構。

注意：此 Gemini 備援端點沒有即時網路搜尋功能，不能假裝查到外部市場價格。
請只根據商品資料與完整預估成本，評估三層售價是否合理。

價格名稱固定為：
- 一般售價：${retail}
- 鐵粉價：${vip}
- VIP會員價：${vvip}

成本結構：
- 商品進貨成本：${cost}
- 每件安全分攤：${safeAllocation || 0}
- 預估入庫運費：${inboundShipping || 0}
- 完整預估成本：${fullCost}

請務必在 advice 開頭明確寫：
「目前無法即時確認外部市場價格，此建議以完整預估成本與三層定價結構評估。」

請判斷：
1. 一般售價、鐵粉價、VIP會員價是否依序合理
2. 各層價格差是否有吸引力，且不可出現會員價高於一般售價
3. 以完整預估成本計算各層預估留下與利潤率
4. 是否有價格低於完整預估成本或利潤過低的風險
5. 給一句可直接放進系統的短備註

商品名稱：${productName}
分類：${category}
商品文案：${copy || ""}

只回傳 JSON，不要 markdown：
{"advice":"完整建議文字","shortNote":"一句可放進備註的短結論"}`;

    const ai = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.15, response_mime_type: "application/json" }
        })
      }
    );

    const out = await ai.json();
    if (!ai.ok) return res.status(ai.status).json({ error: out.error?.message || "Gemini API error" });

    const text = out.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const safeParseJson = value => {
      try { return JSON.parse(value); } catch (e) {}
      const start = String(value).indexOf("{");
      const end = String(value).lastIndexOf("}");
      if (start !== -1 && end > start) {
        try { return JSON.parse(String(value).slice(start, end + 1)); } catch (e) {}
      }
      return { advice: String(value || "AI未回傳建議。"), shortNote: "" };
    };

    const result = safeParseJson(text);
    return res.status(200).json({
      advice: String(result.advice || "AI未回傳建議。"),
      shortNote: String(result.shortNote || "")
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Gemini API error" });
  }
};
