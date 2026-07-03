
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

    if (!r.ok || j.error) {
      return res.status(200).json({
        summary: `外部搜尋暫時失敗，無法真正偵測外面售價。\n原因：${j.error || r.status}\n\n目前價格：原價 ${retail} / VIP ${vip} / VVIP ${vvip} / 成本 ${cost}`
      });
    }

    const texts = [];
    const items = [...(j.shopping_results || []), ...(j.organic_results || [])].slice(0, 8);
    items.forEach(x => texts.push(`${x.title || ""} ${x.price || ""} ${x.snippet || ""}`));
    const joined = texts.join("\n").slice(0, 5000);

    if (!joined.trim()) {
      return res.status(200).json({
        summary: `外部搜尋資料不足，無法確認市場售價。\n\n目前價格：原價 ${retail} / VIP ${vip} / VVIP ${vvip} / 成本 ${cost}\n建議手動查蝦皮或同行價格後再決定是否調整。`
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

    const summary = await callOpenAI({ prompt, json: false, temperature: 0.2, retries: 1 });
    return res.status(200).json({ summary });
  } catch (e) {
    return res.status(500).json({ error: e.message || "OpenAI API error" });
  }
};
