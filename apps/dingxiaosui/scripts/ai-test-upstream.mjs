// Synthetic upstream: used only by start-ai-test.mjs in an isolated local copy.
// These are fixture strings, never real credentials or model output.
export default {async fetch(request){
 const data=await request.json();
 if(!['Bearer local-fixture-key-one','Bearer local-fixture-key-two'].includes(request.headers.get('authorization')))return new Response('fixture auth denied',{status:401});
 if(data.model==='test-unauthorized')return new Response('upstream secret must never be echoed',{status:401});
 if(data.model==='test-rate-limit')return new Response('fixture rate limit',{status:429});
 if(data.model==='test-bad-json')return new Response('not json');
 if(data.model==='test-wrong-format')return Response.json({choices:[{message:{content:'not a JSON object'}}]});
 if(data.model==='test-qwen'&&data.enable_thinking!==false)return new Response('bad qwen payload',{status:400});
 if(data.model==='test-ark'&&(!data.max_completion_tokens||data.thinking?.type!=='disabled'))return new Response('bad ark payload',{status:400});
 let input={};try{input=JSON.parse(data.messages.at(-1).content)}catch{}
 const output={ok:true,body:'本地模拟：请核实农品资料后再执行。',answer:'本地模拟：这不是实际模型回答。',drafts:(input.channels||[]).map(channel=>({channel,title:'本地模拟文案',body:'独立模拟上游返回，未调用真实模型。'}))};
 return Response.json({choices:[{message:{content:JSON.stringify(output)}}]});
}};
