
module.exports=async function handler(req,res){

try{

 const apiKey=process.env.OPENAI_API_KEY;

 const {rawText,vendorCode}=req.body;

 const response=await fetch(
   "https://api.openai.com/v1/chat/completions",
   {
     method:"POST",
     headers:{
       "Authorization":`Bearer ${apiKey}`,
       "Content-Type":"application/json"
     },
     body:JSON.stringify({
       model:"gpt-4.1-mini",
       response_format:{type:"json_object"},
       messages:[
         {
           role:"system",
           content:`
你是台灣韓國代購AI。

請解析商品並回傳JSON：

{
"title":"",
"colors":"",
"specs":"",
"price":"",
"sizeText":"",
"copy":"",
"hashtags":""
}

保養品避免醫療詞。
`
         },
         {
           role:"user",
           content:rawText
         }
       ]
     })
   }
 );

 const result=await response.json();

 const content=
 result.choices[0].message.content;

 const data=JSON.parse(content);

 data.title=`${vendorCode}｜${data.title}`;

 res.status(200).json(data);

}catch(err){

 res.status(500).json({
   error:err.message
 });

}

}
