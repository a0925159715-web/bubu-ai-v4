module.exports = async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
 try{
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) return res.status(500).json({error:"OPENAI_API_KEY is not set"});
  const {rawText,vendorCode,selectedCategory,mode}=req.body||{};
  const system=`你是台灣網拍賣家的廠商原文解析AI。只解析商品資料與生成文案，價格由網站計算。回傳純 JSON：{"productName":"","colors":"","specs":"","sizeText":"","cost":0,"category":"clothing","copy":""}
商品名稱必須保留款號/貨號/廠商編號，例如 0234、G060234、K15-0903、6042、6620X、#1860、BQ6468，但不要包含使用者廠商代碼 ${vendorCode||""}。
如果原文有「韓標KR 現貨（2064）工裝風...」，productName 要是「2064 工裝風抽繩短褲裙」。
成本辨識：💰100、$100、NT100、批100、批價100、成本100、拿貨100、COST 100、🅒🅞🅢🅣 100、100S 通常 cost=100。建議售價/售價不是成本。若只有一個金額，優先視為成本。
分類：衣服褲裙洋裝是 clothing；保養彩妝是 skincare；清潔居家生活用品是 life。
保養品禁止詞：治療、修復、美白、淡斑、抗敏、消炎、殺菌、消毒、抗痘、除皺、病毒、細菌、保證有效、醫美級。改用保濕感、水潤感、光澤感、清爽感、舒緩感、柔嫩感、日常保養。
文案繁體中文，台灣網拍闆娘口吻，不要中國用語，不要提真實廠商名。copy 格式：文案：...\\n\\n提醒：...\\n\\nHashtag：...`;
  const user=`廠商代碼：${vendorCode||""}\n使用者選擇分類：${selectedCategory||"auto"}\n成本模式：${mode||""}\n\n廠商原文：\n${rawText||""}`;
  const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",temperature:0.2,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:user}]})});
  const result=await response.json();
  if(!response.ok) return res.status(response.status).json({error:result.error?.message||"OpenAI API error"});
  const data=JSON.parse(result.choices?.[0]?.message?.content||"{}");
  res.status(200).json(data);
 }catch(err){res.status(500).json({error:err.message});}
}