module.exports = async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
 try{
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) return res.status(500).json({error:"OPENAI_API_KEY is not set"});
  const {rawText,vendorCode,selectedCategory,mode}=req.body||{};
  const system=`你是台灣韓國代購賣家的廠商原文解析AI。從混亂廠商原文中解析單一商品資料，輸出純 JSON，不要 markdown。
必須回傳欄位：productName, colors, specs, sizeText, cost, category, copy。
category 只能是 clothing、skincare、life。
COST、成本、價格、批價、建議批價、🅒🅞🅢🅣 都可能是成本；韓國服飾看到 340S，cost=340。顏色統一用全形逗號。尺寸整理成中文。
如果是保養品/彩妝，category=skincare，文案禁止：治療、修復、美白、淡斑、抗敏、消炎、殺菌、急救、修護屏障、永久改善、抗痘、除皺、消毒、病毒、細菌、保證有效。改用保濕感、水潤感、光澤感、清爽感、舒緩感、日常保養。
文案繁體中文，像台灣網拍闆娘分享，不要官方、不像廠商翻譯。copy 固定格式：文案：...\\n\\n提醒：...\\n\\nHashtag：...`;
  const user=`廠商代碼：${vendorCode||""}\n使用者選擇分類：${selectedCategory||"auto"}\n進貨模式：${mode||""}\n\n廠商原文：\n${rawText||""}`;
  const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",temperature:0.25,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:user}]})});
  const result=await response.json();
  if(!response.ok) return res.status(response.status).json({error:result.error?.message||"OpenAI API error"});
  const content=result.choices?.[0]?.message?.content||"{}";
  return res.status(200).json(JSON.parse(content));
 }catch(err){return res.status(500).json({error:err.message});}
}