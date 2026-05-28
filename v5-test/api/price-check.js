module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY is not set" });

    const { productName, category, retail, vip, vvip, cost, copy } = req.body || {};

    // 搜尋導向的提示：請 AI 真的去搜「台灣電商同類型商品」的售價區間，
    // 給「同類型行情參考帶」，而非假裝精準同款比價。
    const prompt = `你是台灣韓國代購賣家的價格策略助理。

請先「使用網路搜尋」，查台灣常見電商平台（蝦皮、賣貨便、各拍賣/社團團購等）上「同類型」商品的實際售價區間。
注意：無品牌服飾很難找到一模一樣的同款，因此你要找的是「同類型、相似風格」商品的價格帶，作為行情參考，不是宣稱找到完全相同的商品。

接著請依搜尋到的行情帶，清楚指出：
1. 我目前的原價，落在這個行情帶的偏高 / 合理 / 偏低位置
2. 原價、VIP、VVIP 是否需要修正，往哪個方向
3. 若搜尋後仍找不到足夠參考資料，請明確說「目前搜尋不到足夠的同類型行情資料」，不得假裝查到精準價格
4. 給一段可直接放進系統的短備註

商品名稱：${productName}
分類：${category}
我的進價/成本：${cost}
我的原價：${retail}
我的VIP價：${vip}
我的VVIP價：${vvip}
商品文案：${copy || ''}

請務必在 advice 裡寫出你搜尋到的「同類型行情大約區間」（例如：市場上類似的韓系上衣多落在 NT$290~480）。
請用繁體中文（台灣用語），只回傳 JSON，格式：
{"advice":"完整建議文字（含搜尋到的行情區間）","shortNote":"一句可放進備註的短結論"}`;

    // 解析 Responses API 回傳：把所有文字段落串起來，再從中抓出 JSON。
    function extractJsonFromResponses(result) {
      let text = result.output_text || "";
      if (!text && Array.isArray(result.output)) {
        text = result.output
          .flatMap(o => (o.content || []))
          .map(c => c.text || "")
          .join("");
      }
      return text;
    }

    // 從可能夾雜其他文字的字串中，安全地抓出第一個 JSON 物件。
    function safeParseJson(text) {
      if (!text) return null;
      try { return JSON.parse(text); } catch (e) {}
      // 嘗試擷取大括號區段（搜尋模式有時會在 JSON 前後夾敘述）
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const slice = text.slice(start, end + 1);
        try { return JSON.parse(slice); } catch (e) {}
      }
      return null;
    }

    // ── 第一段：Responses API + 網路搜尋 ──
    // 使用 gpt-4o（對 Responses API 的 web_search 工具支援較穩定）。
    // 注意：搜尋工具與強制 json 格式同時使用易衝突，故此段不強制 json_object，
    // 改在提示中要求只回 JSON，再由 safeParseJson 容錯解析。
    try {
      const searchResp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          input: prompt,
          tools: [{ type: "web_search_preview" }],
          tool_choice: "auto"
        })
      });
      const searchResult = await searchResp.json();
      if (searchResp.ok) {
        const text = extractJsonFromResponses(searchResult);
        const parsed = safeParseJson(text);
        if (parsed && (parsed.advice || parsed.shortNote)) {
          return res.status(200).json(parsed);
        }
        // 解析不到 JSON，但有文字 → 至少把文字當 advice 回去，不浪費這次搜尋
        if (text && text.trim()) {
          return res.status(200).json({ advice: text.trim(), shortNote: "" });
        }
      }
      // searchResp 不 ok 或無內容 → 落到備用方案
    } catch (e) {
      // 搜尋段整段出錯 → 落到備用方案
    }

    // ── 第二段（備用）：一般 chat 模型，無搜尋，誠實告知 ──
    const fallbackResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是台灣韓國代購的價格策略助理。此模式沒有即時網路搜尋，你必須在 advice 開頭明確說「目前無法即時確認外部市場價格（搜尋暫時失敗）」，不可假裝查到真實價格，再依成本與定價給合理性建議。回繁體中文 JSON：{\"advice\":\"...\",\"shortNote\":\"...\"}" },
          { role: "user", content: prompt }
        ]
      })
    });
    const fallbackResult = await fallbackResp.json();
    if (!fallbackResp.ok) {
      return res.status(fallbackResp.status).json({ error: fallbackResult.error?.message || "OpenAI API error" });
    }
    const parsed = safeParseJson(fallbackResult.choices?.[0]?.message?.content || "{}") || {};
    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
