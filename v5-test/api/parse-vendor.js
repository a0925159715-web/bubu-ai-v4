
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


function stripVendorCodeFromStart(text, vendorCode){
  let s=String(text||'').trim(); const v=String(vendorCode||'').trim();
  if(v){ const re=new RegExp('^'+v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[\\s｜|\\-_:：]*','i'); s=s.replace(re,'').trim(); }
  return s;
}
function extractProductCode(rawText,vendorCode){
  const raw=stripVendorCodeFromStart(rawText,vendorCode);
  const patterns=[/#\s*[A-Za-z0-9][A-Za-z0-9\-]*/g,/\b[A-Z]{1,4}\d{1,4}[-－]\d{2,6}[A-Z]?\b/g,/\b[A-Z]{1,4}\d{3,8}[A-Z]?\b/g,/\b\d{3,6}[A-Z]?\b/g];
  for(const re of patterns){ const m=raw.match(re); if(m&&m.length){ const code=String(m[0]).replace(/\s+/g,'').replace('－','-').trim(); if(!/^(202[0-9]|19[0-9]{2})$/.test(code)) return code; } }
  return '';
}
function extractHardCost(rawText){
  const raw=String(rawText||'').replace(/[＄]/g,'$').replace(/[：]/g,':').replace(/[＝]/g,'=');
  const neg=/(售價|零售|定價|建議售價|賣價|原價|市價|特價)/;
  const lines=raw.split(/\n|。|，|,|；|;/).map(s=>s.trim()).filter(Boolean);
  const patterns=[/(?:成本|拿貨|進價|批價|批|P|C|S|B|W|NT\$?|台幣|\$)\s*[:=]?\s*(\d{2,6})/i,/(?:【|\(|（|\[)\s*(\d{2,6})\s*(?:】|\)|）|\])/,/(\d{2,6})\s*元/];
  for(const line of lines){ if(neg.test(line)) continue; for(const re of patterns){ const m=line.match(re); if(m){ const n=Number(m[1]); if(n>0&&n<100000) return n; } } }
  const nums=raw.match(/\b\d{2,6}\b/g)||[];
  if(nums.length===1&&!neg.test(raw)){ const n=Number(nums[0]); if(n>0&&n<100000) return n; }
  return 0;
}
function extractSizeText(rawText){
  const lines=String(rawText||'').split(/\n/).map(s=>s.trim()).filter(Boolean);
  const sizeWords=/(肩寬|肩宽|肩|胸寬|胸宽|胸|衣長|衣长|長|长|袖長|袖长|袖|腰圍|腰围|腰|臀圍|臀围|臀|褲長|裤长|褲|裤|裙長|裙长|下擺|下摆|大腿|腿圍|腿围|cm|CM|公分|尺碼|尺寸|SIZE|Size|size)/;
  return lines.filter(line=>sizeWords.test(line)&&/\d/.test(line)).join('\n').slice(0,1200);
}
function cleanAiName(name, code){
  let s=String(name||'').trim();
  if(code){ const escaped=String(code).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); s=s.replace(new RegExp('^'+escaped+'\\s*'),'').replace(new RegExp(escaped,'g'),'').trim(); }
  return s.replace(/[｜|]+/g,' ').replace(/\s+/g,' ').trim();
}
function composeProductName(rawText,vendorCode,aiName){
  const code=extractProductCode(rawText,vendorCode);
  const name=cleanAiName(aiName,code);
  return code?`${code} ${name}`.trim():name;
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

    const { rawText, vendorCode, selectedCategory, mode, importOptions } = req.body || {};
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
    const hardCode = extractProductCode(rawText, vendorCode);
    const hardCost = extractHardCost(rawText);
    const hardSizeText = extractSizeText(rawText);

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
1. productName 請回傳吸引人的中文商品名，中文名稱約 8～12 個字。
2. 不要把廠商代碼 ${vendorCode || ""} 放進 productName。
3. 不要把貨號/款號放進 productName；系統會另外強制保留並自動合併。
4. 命名要像台灣韓貨網拍命名：好賣、好懂、好搜尋，不要直翻廠商原文。
5. 可使用：韓系、法式、氣質、顯瘦、垂墜、冰感、涼感、修身、寬鬆、小香、質感、百搭、慵懶、簡約。
6. 避免：爆款、超級無敵、頂級、天花板、神仙、必買、封神。
7. 必須保留商品類型字：TEE、T、上衣、襯衫、背心、短褲、長褲、寬褲、牛仔褲、洋裝、套裝、外套、裙、精華、面霜、洗衣膠囊、護手霜。

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

【保養品公開資訊規則】
公開資訊由前端勾選控制，AI 不可自行猜測。
前端會自動加入：中文標籤、PIF 文件、韓國海運等待文字。
服飾不可出現中文標籤、PIF、海運相關文字。

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

系統硬抓商品代碼：${hardCode || "未抓到"}
系統硬抓成本：${hardCost || 0}
系統硬抓尺寸表：
${hardSizeText || "未抓到"}

保養品公開資訊勾選：
中文標籤：${importOptions?.hasChineseLabel ? "是" : "否"}
PIF文件：${importOptions?.hasPifFile ? "是" : "否"}
韓國海運：${importOptions?.isSeaShipping ? "是" : "否"}

廠商原文：
${rawText || ""}

外部搜尋摘要：
${externalInfo || "未取得外部搜尋資料"}`;

    const parsed = await callOpenAI({ prompt, json: true, temperature: 0.25, retries: 1 });

    const finalProductName = composeProductName(rawText, vendorCode, parsed.productName || "");
    const finalCost = hardCost || Number(parsed.cost) || 0;
    const finalSizeText = hardSizeText || parsed.sizeText || "";

    return res.status(200).json({
      productName: finalProductName || "",
      colors: parsed.colors || "",
      specs: parsed.specs || "",
      sizeText: finalSizeText,
      capacity: parsed.capacity || "",
      cost: finalCost,
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
