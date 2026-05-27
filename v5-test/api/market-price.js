module.exports = async function handler(req,res){
 if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
 try{
  const {productName,category,retail,vip,vvip,cost}=req.body||{};
  if(!productName) return res.status(400).json({error:"缺少商品名稱"});
  const serpKey=process.env.SERPAPI_API_KEY;
  if(!serpKey){
    return res.status(200).json({summary:`尚未啟用外部搜尋 API，無法真正偵測外面售價。\n\n目前你的價格：\n原價：${retail}\nVIP：${vip}\nVVIP：${vvip}\n成本：${cost}\n\n建議：若要啟用真正外部比價，請在 Vercel 環境變數設定 SERPAPI_API_KEY。未設定前，系統不會假裝有查到市場價格。`});
  }
  const q=encodeURIComponent(`${productName} 價格 韓國代購 蝦皮`);
  const url=`https://serpapi.com/search.json?engine=google&q=${q}&gl=tw&hl=zh-tw&api_key=${serpKey}`;
  const r=await fetch(url);
  const j=await r.json();
  const texts=[];
  const items=[...(j.shopping_results||[]),...(j.organic_results||[])].slice(0,8);
  items.forEach(x=>texts.push(`${x.title||""} ${x.price||""} ${x.snippet||""}`));
  const joined=texts.join("\n").slice(0,5000);
  const openai=process.env.OPENAI_API_KEY;
  if(!openai){
    return res.status(200).json({summary:`已取得外部搜尋摘要，但未設定 OPENAI_API_KEY 進行分析：\n${joined.slice(0,1200)}`});
  }
  const prompt=`你是台灣韓國代購/網拍定價顧問。根據外部搜尋摘要，判斷商品市場售價區間，並比較目前價格。\n商品：${productName}\n分類：${category}\n目前原價：${retail}\nVIP：${vip}\nVVIP：${vvip}\n成本：${cost}\n外部搜尋摘要：\n${joined}\n\n請用繁體中文輸出：市場可能區間、目前價格是否偏高/偏低、建議修正、需要注意的地方。不要誇大，若資料不足請明確說資料不足。`;
  const ai=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${openai}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4.1-mini",temperature:0.2,messages:[{role:"user",content:prompt}]})});
  const out=await ai.json();
  return res.status(200).json({summary:out.choices?.[0]?.message?.content||"AI未回傳分析。"});
 }catch(e){
  return res.status(500).json({error:e.message});
 }
}