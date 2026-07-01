
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

    const { rawText, vendorCode, selectedCategory, mode } = req.body || {};
    if (!rawText) return res.status(400).json({ error: "缺少廠商原文" });

    async function searchProductInfo(query, selectedCategory) {
      const serpKey = process.env.SERPAPI_API_KEY;
      if (!serpKey || !query) return "";

      const raw = String(query || "").trim();
      const compact = raw.replace(/\s+/g, "");
      const lower = raw.toLowerCase();

      const looksLikeSkincare =
        selectedCategory === "skincare" ||
        selectedCategory === "life" ||
        /霜|乳|精華|安瓶|化妝水|防曬|隔離|洗面|潔面|面膜|眼霜|乳液|保養|彩妝|粉底|氣墊|唇|卸妝|面霜|cream|serum|ampoule|toner|sun|sunscreen|cleanser|mask|lotion|essence|eye/.test(lower);

      const isTooShort = compact.length <= 60;
      if (!looksLikeSkincare && !isTooShort) return "";

      try {
        const cleanQuery = raw.replace(/\s+/g, " ").trim().slice(0, 140);
        const q = encodeURIComponent(`${cleanQuery} 韓國 商品介紹 使用方法 容量 성분 사용법`);
        const url = `https://serpapi.com/search.json?engine=google&q=${q}&gl=kr&hl=ko&num=8&api_key=${serpKey}`;
        const r = await fetch(url);
        const j = await r.json();
        if (!r.ok || j.error) return "";

        const rows = [];
        const items = [...(j.organic_results || []), ...(j.shopping_results || [])].slice(0, 8);
        items.forEach((x, i) => {
          const title = x.title || "";
          const snippet = x.snippet || x.description || "";
          const source = x.source || "";
          const price = x.price || "";
          const link = x.link || "";
          if (title || snippet) {
            rows.push([
              `來源${i + 1}`,
              `標題：${title}`,
              `摘要：${snippet}`,
              source ? `來源網站：${source}` : "",
              price ? `價格：${price}` : "",
              link ? `連結：${link}` : ""
            ].filter(Boolean).join("\n"));
          }
        });
        return rows.join("\n\n").slice(0, 7000);
      } catch (e) {
        return "";
      }
    }

    const externalInfo = await searchProductInfo(rawText, selectedCategory);

    const prompt = `你是台灣網拍賣家的廠商原文解析AI。只解析商品資料與生成文案，價格由網站計算。

請回傳純 JSON，不要 markdown，不要解釋：
{
  "productName":"",
  "colors":"",
  "specs":"",
  "sizeText":"",
  "capacity":"",
  "cost":0,
  "category":"clothing",
  "copy":"",
  "labelPurpose":"",
  "labelExpiry":"詳見產品外盒",
  "labelCompany":"布布韓國工作室",
  "labelContact":"@bubukorea",
  "labelOrigin":"韓國",
  "labelUsage":""
}

【商品名稱規則】
1. productName 必須保留款號/貨號/廠商編號，例如 0234、G060234、K15-0903、6042、6620X、#1860、BQ6468，但不要包含使用者廠商代碼 ${vendorCode || ""}。
2. 如果原文只有數字款號或商品名太短，不能只回傳款號。必須抓 1~5 個有銷售力的關鍵字補成完整名稱。
3. 商品名稱要像台灣韓貨網拍命名。
4. 可使用：韓國、高級感、顯瘦、百搭、修身、韓系、小香風、慵懶感、氣質、甜美、休閒、日常、寬鬆、薄款、涼感。
5. 必須保留商品類型字：TEE、T、上衣、襯衫、背心、短褲、長褲、寬褲、牛仔褲、洋裝、套裝、外套、裙。

【specs 規則】
specs 只能放尺寸代號，不可放商品特色。若沒有尺寸，服飾填 "F"；保養品/生活用品可留空。

【sizeText 規則】
多尺碼必須每個尺碼一行，用 \\n 換行。若原文有尺寸表，完整保留。

【成本 cost 規則】
找進貨成本/拿貨價：
P280、P=280、C280、B280、S280、W280、NT280、$280 → cost=280
【280】、（280）、[280]、批280、進價280、拿貨280、成本280 → cost=280
售價、零售價、建議售價、定價、賣價 → 不是 cost。
若只有一個數字且非售價，優先視為 cost。找不到填 0。

【分類】
衣服褲裙洋裝 clothing；保養彩妝 skincare；牙刷、清潔、居家生活用品 life。

【保養品安全禁止詞】
禁止：治療、修復、美白、淡斑、抗敏、消炎、殺菌、消毒、抗痘、除皺、病毒、細菌、保證有效、醫美級。
改用：保濕感、水潤感、光澤感、清爽感、舒緩感、柔嫩感、日常保養、自然透亮感。

【外部搜尋資料規則】
如果有外部搜尋摘要，優先依照外部搜尋摘要與廠商原文整理；若搜尋結果不是同一商品，不要硬套。

【文案規則】
繁體中文，台灣網拍闆娘口吻，不要中國用語，不要提真實廠商名。
copy 第一段至少 90～160 字，第二段放提醒。
copy 絕對不可包含 hashtag。
copy 不可出現「文案：」「提醒：」「描述：」「介紹：」。
copy 開頭不可出現「這款 + 款號 + 商品名」。
服飾 copy 不可出現「詳見產品外盒」。
copy 只能兩段，中間用 \\n\\n 分隔。

廠商代碼：${vendorCode || ""}
使用者選擇分類：${selectedCategory || "auto"}
成本模式：${mode || ""}

廠商原文：
${rawText || ""}

外部搜尋摘要：
${externalInfo || "未取得外部搜尋資料"}`;

    const parsed = await callOpenAI({ prompt, json: true, temperature: 0.25, retries: 1 });

    return res.status(200).json({
      productName: parsed.productName || "",
      colors: parsed.colors || "",
      specs: parsed.specs || "",
      sizeText: parsed.sizeText || "",
      capacity: parsed.capacity || "",
      cost: Number(parsed.cost) || 0,
      category: parsed.category || "clothing",
      copy: parsed.copy || "",
      labelPurpose: parsed.labelPurpose || "",
      labelExpiry: parsed.labelExpiry || "詳見產品外盒",
      labelCompany: parsed.labelCompany || "布布韓國工作室",
      labelContact: parsed.labelContact || "@bubukorea",
      labelOrigin: parsed.labelOrigin || "韓國",
      labelUsage: parsed.labelUsage || ""
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "OpenAI API error" });
  }
};
