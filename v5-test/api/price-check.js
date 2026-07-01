
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch (e) {}
  const start = String(text || "").indexOf("{");
  const end = String(text || "").lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(String(text).slice(start, end + 1)); } catch (e) {}
  }
  return null;
}

async function callOpenAI({ prompt, json = false, temperature = 0.2, retries = 1 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  let lastError = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const body = {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: json ? "請嚴格輸出 JSON，不要 markdown。" : "請使用繁體中文，給台灣網拍賣家可用的專業建議。" },
          { role: "user", content: prompt }
        ],
        temperature
      };
      if (json) body.response_format = { type: "json_object" };

      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const out = await r.json();
      if (!r.ok) throw new Error(out.error?.message || `OpenAI API error ${r.status}`);

      const text = out.choices?.[0]?.message?.content || (json ? "{}" : "");
      if (!json) return text || "AI未回傳內容。";

      const parsed = safeParseJson(text);
      if (!parsed) throw new Error("OpenAI did not return valid JSON");
      return parsed;
    } catch (e) {
      lastError = e;
      if (i < retries) await sleep(2500);
    }
  }

  throw lastError;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY is not set" });

    const { productName, category, retail, vip, vvip, cost, copy } = req.body || {};

    const prompt = `你是台灣韓國代購賣家的價格策略助理。

注意：目前此版本沒有即時網路搜尋功能，不能假裝查到外部市場價格。
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

    const result = await callOpenAI({ prompt, json: true, temperature: 0.2, retries: 1 });

    return res.status(200).json({
      advice: result.advice || "AI未回傳建議。",
      shortNote: result.shortNote || ""
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "OpenAI API error" });
  }
};
