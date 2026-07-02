function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function safeParseJson(text){try{return JSON.parse(text)}catch(e){} const s=String(text||""); const a=s.indexOf("{"), b=s.lastIndexOf("}"); if(a!==-1&&b!==-1&&b>a){try{return JSON.parse(s.slice(a,b+1))}catch(e){}} return null;}
async function callOpenAI({prompt,json=false,temperature=0.2,retries=1}){
  const apiKey=process.env.OPENAI_API_KEY; if(!apiKey) throw new Error("OPENAI_API_KEY is not set");
  let lastError=null;
  for(let i=0;i<=retries;i++){
    try{
      const body={model:"gpt-4o-mini",messages:[{role:"system",content:json?"請嚴格輸出 JSON，不要 markdown。":"你是台灣韓國代購/網拍市場價格分析助理。請務實判斷，不要假裝有查到資料。"},{role:"user",content:prompt}],temperature};
      if(json) body.response_format={type:"json_object"};
      const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      const out=await r.json(); if(!r.ok) throw new Error(out.error?.message||`OpenAI API error ${r.status}`);
      const text=out.choices?.[0]?.message?.content||(json?"{}":"");
      if(!json) return text||"AI未回傳內容。";
      const parsed=safeParseJson(text); if(!parsed) throw new Error("OpenAI did not return valid JSON");
      return parsed;
    }catch(e){lastError=e; if(i<retries) await sleep(1800);}
  }
  throw lastError;
}
function stripCode(name){return String(name||"").replace(/#[A-Za-z0-9][A-Za-z0-9\-]*/g," ").replace(/\b[A-Z]{1,4}\d{1,4}[-－]\d{2,6}[A-Z]?\b/g," ").replace(/\b[A-Z]{1,4}\d{3,8}[A-Z]?\b/g," ").replace(/\s+/g," ").trim();}
function uniq(arr){return [...new Set(arr.map(x=>String(x||"").trim()).filter(Boolean))];}
async function buildSearchQueries(productName,category){
  const clean=stripCode(productName);
  const prompt=`請幫台灣韓國代購賣家把商品名稱拆成適合搜尋市場價格的關鍵字。

商品名稱：${productName}
分類：${category}

規則：
1. 保養品/彩妝/生活用品：優先找同款，搜尋詞不要太長，包含品牌、核心品名、容量。
2. 可加入英文/韓文關鍵字，但不要亂翻品牌。
3. 服飾：不要硬找同款，改找相似韓系品類市場區間。
4. 回傳 JSON：
{"coreName":"核心商品名","queries":["搜尋詞1","搜尋詞2","搜尋詞3","搜尋詞4","搜尋詞5"]}`;
  try{
    const parsed=await callOpenAI({prompt,json:true,temperature:0.15,retries:1});
    const qs=Array.isArray(parsed.queries)?parsed.queries:[];
    return uniq([...qs,`${clean} 價格`,`${clean} 蝦皮`,`${clean} 韓國代購`]).slice(0,6);
  }catch(e){
    return category==="clothing"?uniq([`${clean} 韓系 價格`,`${clean} 類似款`,`${clean} 蝦皮`]).slice(0,4):uniq([`${clean} 價格`,`${clean} 蝦皮`,`${clean} 韓國代購`,clean]).slice(0,4);
  }
}
async function serpSearch(query,serpKey){
  const url=`https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&gl=tw&hl=zh-tw&num=8&api_key=${serpKey}`;
  const r=await fetch(url); const j=await r.json(); if(!r.ok||j.error) return [];
  return [...(j.shopping_results||[]),...(j.organic_results||[])].slice(0,8).map(x=>({query,title:x.title||"",price:x.price||"",snippet:x.snippet||x.description||"",source:x.source||"",link:x.link||""})).filter(x=>x.title||x.snippet);
}
module.exports=async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  try{
    const {productName,category,retail,vip,vvip,cost}=req.body||{};
    if(!productName) return res.status(400).json({error:"缺少商品名稱"});
    const serpKey=process.env.SERPAPI_API_KEY;
    if(!serpKey) return res.status(200).json({summary:`尚未啟用外部搜尋 API，無法真正偵測外面售價。\n\n目前你的價格：\n原價：${retail}\nVIP：${vip}\nVVIP：${vvip}\n成本：${cost}\n\n請在 Vercel 環境變數設定 SERPAPI_API_KEY。`});
    const queries=await buildSearchQueries(productName,category);
    const rows=[];
    for(const q of queries){ rows.push(...await serpSearch(q,serpKey)); if(rows.length>=12&&category!=="skincare") break; await sleep(300); }
    const seen=new Set(), uniqueRows=[];
    for(const r of rows){ const key=`${r.title}|${r.price}|${r.source}`.toLowerCase(); if(!seen.has(key)){seen.add(key); uniqueRows.push(r);} }
    const joined=uniqueRows.slice(0,18).map((x,i)=>`資料${i+1}\n搜尋詞：${x.query}\n標題：${x.title}\n價格：${x.price||"未顯示"}\n來源：${x.source||"未知"}\n摘要：${x.snippet||""}\n連結：${x.link||""}`).join("\n\n").slice(0,9000);
    if(!joined.trim()) return res.status(200).json({summary:`⚠ AI 已嘗試多組搜尋詞，但外部搜尋資料不足，無法確認市場售價。\n\n已搜尋：\n${queries.map(q=>`- ${q}`).join("\n")}\n\n目前價格：原價 ${retail} / VIP ${vip} / VVIP ${vvip} / 成本 ${cost}`});
    const prompt=`你是台灣韓國代購/網拍定價顧問。請根據外部搜尋摘要，幫賣家整理市場價格。

商品：${productName}
分類：${category}
目前原價：${retail}
VIP：${vip}
VVIP：${vvip}
成本：${cost}

已使用搜尋詞：
${queries.map(q=>`- ${q}`).join("\n")}

外部搜尋摘要：
${joined}

請用繁體中文輸出，格式固定：

【搜尋結果摘要】
列出最有參考價值的 3~6 筆資料，包含來源/標題/價格。若價格沒有顯示，請說未顯示。

【市場價格區間】
保養品：盡量判斷同款或近似同款區間。
服飾：不用硬判斷同款，只給類似韓系品類市場區間。

【目前價格判斷】
比較目前原價/VIP/VVIP 是否偏高、偏低或合理。

【建議】
給原價、VIP、VVIP 建議。資料不足時請明確說資料不足，但仍可給保守建議。

注意：不要假裝資料完整；如果疑似不同商品，要提醒。`;
    const summary=await callOpenAI({prompt,json:false,temperature:0.2,retries:1});
    return res.status(200).json({summary:`🔎 已搜尋 ${queries.length} 組關鍵字：\n${queries.map(q=>`- ${q}`).join("\n")}\n\n${summary}`});
  }catch(e){return res.status(500).json({error:e.message||"OpenAI API error"});}
};