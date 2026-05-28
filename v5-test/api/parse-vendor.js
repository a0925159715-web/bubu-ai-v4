module.exports = async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
 try{
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) return res.status(500).json({error:"OPENAI_API_KEY is not set"});
  const {rawText,vendorCode,selectedCategory,mode}=req.body||{};
  const system=`你是台灣網拍賣家的廠商原文解析AI。只解析商品資料與生成文案，價格由網站計算。

請回傳純 JSON：
{"productName":"","colors":"","specs":"","sizeText":"","capacity":"","cost":0,"category":"clothing","copy":"","labelPurpose":"","labelExpiry":"詳見產品外盒","labelCompany":"布布韓國工作室","labelContact":"@bubukorea","labelOrigin":"韓國","labelUsage":""}

【商品名稱規則 V6.5】
1. productName 必須保留款號/貨號/廠商編號，例如 0234、G060234、K15-0903、6042、6620X、#1860、BQ6468，但不要包含使用者廠商代碼 ${vendorCode||""}。
2. 如果原文只有數字款號或商品名太短，不能只回傳款號。必須從下方文案抓 1~5 個有銷售力的關鍵字補成完整名稱。
3. 商品名稱要像台灣韓貨網拍命名，不是工程師資料庫命名。
4. 可保留或補入有銷售力的風格詞：韓國、高級感、顯瘦、百搭、修身、韓系、小香風、慵懶感、氣質、甜美、休閒、日常、寬鬆、薄款、涼感。
5. 必須保留商品類型字：TEE、T、上衣、襯衫、背心、短褲、長褲、寬褲、牛仔褲、洋裝、套裝、外套、裙。
6. 商品名稱不包含款號的部分，建議 6~20 字；可以長一點，但每個詞都要有銷售價值。
7. 避免淘寶式垃圾堆字，例如：超級爆款必買女神感、全網瘋搶、爆炸好看。
8. 若原文下方文章有描述，請從下方文章抓商品核心關鍵字，不要只看第一行。

【規格欄 specs 嚴格規則 V6.5.2.5 — 非常重要】
specs 欄位「只能」放尺寸代號，絕對禁止放商品特色、設計風格、版型描述。
✅ 正確範例：
  - "S號, M號, L號, XL號"（多尺碼時用「逗號+空格」分隔，保留「號」字）
  - "F"（單一尺碼）
  - "均碼"
  - "S, M, L"（若廠商原文沒寫「號」字才可省略）
❌ 絕對錯誤範例（這些是商品特色，不是規格）：
  - "褲裙設計, 高腰版型, 附鉚釘腰帶, 牛仔面料"
  - "韓系, 顯瘦, 百搭"
  - "修身版型"
判斷方法：如果文字裡有「設計、版型、面料、風格、款式」等詞，那不是規格，是特色，絕對不要放進 specs。
若廠商原文沒有提供具體尺碼，就填 "F"，不要自己編。
若商品是保養品/生活用品，specs 可留空字串。

【尺寸/規格補充 sizeText 換行規則 V6.5.2.5】
sizeText 必須保留每個尺碼一行的格式，絕對禁止用分號「;」或頓號「、」把多個尺碼擠成一行。
✅ 正確範例（每尺碼換行，用 \\n 表示換行）：
  "S號：腰31cm 臀48cm 長32cm\\nM號：腰33cm 臀50cm 長32cm\\nL號：腰35cm 臀52cm 長32cm\\nXL號：腰37cm 臀54cm 長32cm"
❌ 絕對錯誤範例：
  "S號：腰31cm 臀48cm 長32cm; M號：腰33cm 臀50cm 長32cm; L號：腰35cm..."
若廠商原文已經是每行一個尺碼，請完整保留原本的換行結構，不要重新組合。

【成本辨識】
💰100、$100、NT100、批100、批價100、成本100、拿貨100、COST 100、🅒🅞🅢🅣 100、100S 通常 cost=100。
建議售價 / 售價 / 零售價 不是成本。若只有一個金額，優先視為成本。

【分類】
衣服褲裙洋裝 clothing；保養彩妝 skincare；牙刷、清潔、居家生活用品 life。

【保養品/個人清潔用品中文標籤】
capacity 抓容量/規格；labelPurpose 用簡短用途；labelExpiry 預設詳見產品外盒；labelCompany 預設布布韓國工作室；labelContact 預設 @bubukorea；labelOrigin 預設韓國。
若是服飾，中文標籤欄位可以空白。

【保養品安全禁止詞】
治療、修復、美白、淡斑、抗敏、消炎、殺菌、消毒、抗痘、除皺、病毒、細菌、保證有效、醫美級。
改用保濕感、水潤感、光澤感、清爽感、舒緩感、柔嫩感、日常保養、自然透亮感。

文案繁體中文，台灣網拍闆娘口吻，不要中國用語，不要提真實廠商名。copy 格式：文案：...\\n\\n提醒：...\\n\\nHashtag：...`;
  const user=`廠商代碼：${vendorCode||""}\n使用者選擇分類：${selectedCategory||"auto"}\n成本模式：${mode||""}\n\n廠商原文：\n${rawText||""}`;
  const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",temperature:0.2,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:user}]})});
  const result=await response.json();
  if(!response.ok) return res.status(response.status).json({error:result.error?.message||"OpenAI API error"});
  return res.status(200).json(JSON.parse(result.choices?.[0]?.message?.content||"{}"));
 }catch(err){return res.status(500).json({error:err.message});}
}
