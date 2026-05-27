module.exports = async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
 try{
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) return res.status(500).json({error:"OPENAI_API_KEY is not set"});
  const {productName,category,retail,vip,vvip,cost,copy}=req.body||{};
  const prompt=`你是台灣韓國代購賣家的價格策略助理。
請檢查商品是否有價格競爭力，並一定要清楚指出：
1. 目前價格是否偏高/合理/偏低
2. 原價、VIP、VVIP 哪裡該修正
3. 若無法取得即時外部價格，要明確說「目前無法即時確認外部市場價格」，不得假裝查到真實價格
4. 給一段可放進系統的短備註

商品：${productName}
分類：${category}
成本/進價：${cost}
原價：${retail}
VIP：${vip}
VVIP：${vvip}
文案：${copy||''}

請用繁體中文，回 JSON：
{"advice":"完整建議文字","shortNote":"一句短備註"}`;
  // First try Responses API with web search tool. If unavailable, fallback to normal model reasoning.
  let response = await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"gpt-4.1-mini",
      input:prompt,
      tools:[{type:"web_search_preview"}],
      text:{format:{type:"json_object"}}
    })
  });
  let result = await response.json();
  if(response.ok){
    const text = result.output_text || (result.output||[]).flatMap(o=>o.content||[]).map(c=>c.text||'').join('');
    return res.status(200).json(JSON.parse(text||'{}'));
  }
  // fallback
  response = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:"gpt-4.1-mini",
      temperature:0.2,
      response_format:{type:"json_object"},
      messages:[
        {role:"system",content:"你是價格策略助理。你沒有即時網路搜尋時，必須明確說無法即時確認外部市場價格，不可假裝查到。"},
        {role:"user",content:prompt}
      ]
    })
  });
  result = await response.json();
  if(!response.ok) return res.status(response.status).json({error:result.error?.message||"OpenAI API error"});
  return res.status(200).json(JSON.parse(result.choices?.[0]?.message?.content||"{}"));
 }catch(err){
  return res.status(500).json({error:err.message});
 }
}