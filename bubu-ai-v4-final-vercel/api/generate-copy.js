module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
    }

    const data = req.body || {};

    const systemMessage = `你是台灣韓國代購女裝與保養品賣家的專屬文案AI。
請使用繁體中文。
你只需要輸出：文案、提醒、Hashtag。
不要輸出商品名稱、規格、顏色、尺寸、價格，因為網站前段已經固定生成愛+1格式。
文案風格：像台灣網拍闆娘本人分享，不像官方、不像廠商翻譯、不像中國直播賣貨。要有韓系生活感、朋友推薦感、自然聊天感，不要過度浮誇。
可以有少量 emoji，例如 🥹 🤣 ♡ ☁️ ✨，但不要整篇太滿。
衣服文案重點：穿搭感、顯瘦感、日常感、韓系氛圍、版型、材質、搭配。
保養品 / 彩妝文案重點：使用感、妝感、水潤感、光澤感、日常保養、清爽感。
生活用品文案重點：日常方便、韓國流行感、實用、小巧方便。
禁止使用醫療或療效詞：治療、修復、美白、淡斑、抗敏、消炎、殺菌、急救、修護屏障、永久改善、豐唇、抗痘、抗老、消腫、去粉刺、去口臭、牙周、治癒、保證有效。
請改用：保濕感、舒緩感、日常保養、水潤感、光澤感、妝感服貼、清爽感、柔嫩感、自然光澤感、清新感、日常清潔、使用感受。
固定輸出：
文案：
提醒：
Hashtag：`;

    const userMessage = `請依照以下商品資料產出「${data.copyType || "社團上架文"}」。

商品前段固定格式如下，請不要重複輸出：
${data.fixedHeader || ""}

商品類型：${data.category || ""}
原始文案/商品賣點：
${data.rawCopy || ""}

尺寸/補充資訊：
${data.sizeText || ""}

請只輸出：
文案：
提醒：
Hashtag：`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage }
        ],
        temperature: 0.75,
        max_tokens: 1400
      })
    });

    const resultText = await response.text();
    let result;
    try { result = JSON.parse(resultText); }
    catch (e) { return res.status(500).json({ error: "OpenAI response was not JSON: " + resultText.slice(0, 200) }); }

    if (!response.ok) {
      return res.status(response.status).json({ error: result.error?.message || "OpenAI API error" });
    }

    const copy = result.choices?.[0]?.message?.content?.trim();
    return res.status(200).json({ copy: copy || "沒有生成內容，請再試一次。" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
