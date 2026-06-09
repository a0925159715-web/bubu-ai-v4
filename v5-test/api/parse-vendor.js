module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not set" });

    const { rawText, vendorCode, selectedCategory, mode } = req.body || {};

    const system = `你是台灣網拍賣家的廠商原文解析AI。只解析商品資料與生成文案，價格由網站計算。

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
specs 只能放尺寸代號，不可放商品特色。
正確："S號, M號, L號, XL號"、"F"、"均碼"。
若沒有尺寸，服飾填 "F"；保養品/生活用品可留空。

【sizeText 規則】
多尺碼必須每個尺碼一行，用 \\n 換行。
不可用分號或頓號擠成一行。
若原文有尺寸表，完整保留。

【成本 cost 規則】
找進貨成本/拿貨價：
P280、P=280、C280、B280、S280、W280、NT280、$280 → cost=280
【280】、（280）、[280]、批280、進價280、拿貨280、成本280 → cost=280
售價、零售價、建議售價、定價、賣價 → 不是 cost。
若只有一個數字且非售價，優先視為 cost。
找不到填 0。

【分類】
衣服褲裙洋裝 clothing；保養彩妝 skincare；牙刷、清潔、居家生活用品 life。

【保養品/個人清潔用品中文標籤】
capacity 抓容量/規格；labelPurpose 用簡短用途；labelExpiry 預設詳見產品外盒；labelCompany 預設布布韓國工作室；labelContact 預設 @bubukorea；labelOrigin 預設韓國。
若是服飾，中文標籤欄位可以空白。

【保養品安全禁止詞】
禁止：治療、修復、美白、淡斑、抗敏、消炎、殺菌、消毒、抗痘、除皺、病毒、細菌、保證有效、醫美級。
改用：保濕感、水潤感、光澤感、清爽感、舒緩感、柔嫩感、日常保養、自然透亮感。

【文案規則】
繁體中文，台灣網拍闆娘口吻，不要中國用語，不要提真實廠商名。
copy 絕對不可包含 hashtag。
copy 不可出現「文案：」「提醒：」「描述：」「介紹：」。
copy 開頭不可出現「這款 + 款號 + 商品名」。
服飾 copy 不可出現「詳見產品外盒」。
copy 只能兩段，中間用 \\n\\n 分隔：
第一段：商品文案。
第二段：提醒內容。`;

    const user = `廠商代碼：${vendorCode || ""}
使用者選擇分類：${selectedCategory || "auto"}
成本模式：${mode || ""}

廠商原文：
${rawText || ""}`;

    const prompt = `${system}\n\n${user}`;

    const geminiResp = await fetch(
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

    const result = await geminiResp.json();

    if (!geminiResp.ok) {
      return res.status(geminiResp.status).json({
        error: result.error?.message || "Gemini API error"
      });
    }

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        parsed = JSON.parse(text.slice(start, end + 1));
      } else {
        throw new Error("Gemini did not return valid JSON");
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
