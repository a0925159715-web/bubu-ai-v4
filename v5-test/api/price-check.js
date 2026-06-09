module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not set" });

    const { productName, category, retail, vip, vvip, cost, copy } = req.body || {};

    const prompt = `你是台灣韓國代購賣家的價格策略助理。

注意：目前此 Gemini 備援版沒有即時網路搜尋功能，不能假裝查到外部市場價格。
請根據商品名稱、分類、成本、原價、VIP、VVIP 與商品文案，給出合理的價格策略建議。

請務必在 advice 開頭明確寫：
「目前無法即時確認外部市場價格，此建議以成本與定價結構評估。」

請判斷：
1. 原價是否合理
2. VIP / VVIP 價格差是否有吸引力
3. 毛利空間是否太低或太高
4. 是否建議調整
5. 給一段可直接放進系統的短備註

商品名稱：${productName}
分類：${category}
我的進價/成本：${cost}
我的原價：${retail}
我的VIP價：${vip}
我的VVIP價：${vvip}
商品文案：${copy || ""}

只回傳 JSON，不要 markdown：
{"advice":"完整建議文字","shortNote":"一句可放進備註的短結論"}`;

    const ai = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            response_mime_type: "application/json"
          }
        })
      }
    );

    const out = await ai.json();

    if (!ai.ok) {
      return res.status(ai.status).json({ error: out.error?.message || "Gemini API error" });
    }

    const text = out.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    function safeParseJson(text) {
      try { return JSON.parse(text); } catch (e) {}
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch (e) {}
      }
      return { advice: text || "AI未回傳建議。", shortNote: "" };
    }

    return res.status(200).json(safeParseJson(text));

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
