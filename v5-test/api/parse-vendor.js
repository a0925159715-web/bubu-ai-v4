module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY is not set" });

    const { rawText, vendorCode, selectedCategory, mode } = req.body || {};

    const system = `
你是台灣網拍賣家的「廠商原文解析AI」。
你只負責解析商品資料與生成安全文案，價格計算由網站負責，不要自己亂算售價/批價。

請回傳純 JSON，不要 markdown：
{
  "productName": "商品名稱，不含廠商代碼",
  "colors": "顏色，用全形逗號分隔",
  "specs": "規格，例如 F / S，M，L / 單一規格",
  "sizeText": "尺寸或規格補充，繁體中文整理",
  "cost": 100,
  "category": "clothing 或 skincare 或 life",
  "copy": "文案：...\\n\\n提醒：...\\n\\nHashtag：..."
}

成本辨識規則，非常重要：
- 💰100、$100、NT100、批100、批價100、成本100、拿貨100、COST 100、🅒🅞🅢🅣 100、100S，通常都是 cost = 100。
- 建議售價、售價、零售價，不能當成本。
- 若只有一個金額，而且出現在廠商原文中，優先視為成本。
- 若出現「建議批價」和「建議售價」，成本可留空或取建議批價下方較小值，但不要把售價當成本。
- 尺寸：胸、胸寬、衣長、長、腰、臀、褲長、裙長都整理進 sizeText。

分類規則：
- 上衣、褲、裙、洋、外套、背心、T → clothing
- 保養、乳液、精華、面膜、凝膠、洗面乳、彩妝、唇、眼影 → skincare
- 排水孔、清潔、廚房、居家、收納、生活用品 → life

保養品安全模式：
禁止詞：治療、修復、美白、淡斑、抗敏、消炎、殺菌、消毒、抗痘、除皺、病毒、細菌、保證有效、醫美級。
改成：保濕感、水潤感、光澤感、清爽感、舒緩感、柔嫩感、日常保養、自然透亮感。

文案風格：
繁體中文，台灣網拍闆娘口吻，親切但不要太浮誇。不要中國用語。不要提真實廠商名。
`.trim();

    const user = `廠商代碼：${vendorCode || ""}
使用者選擇分類：${selectedCategory || "auto"}
成本模式：${mode || ""}

廠商原文：
${rawText || ""}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    const result = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: result.error?.message || "OpenAI API error" });

    const content = result.choices?.[0]?.message?.content || "{}";
    const data = JSON.parse(content);
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};