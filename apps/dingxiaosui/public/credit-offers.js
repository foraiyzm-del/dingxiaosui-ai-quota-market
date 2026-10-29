(() => {
 const notice=document.querySelector('#offer-service');if(!notice)return;
 fetch('/api/credit-plans',{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error();const value=await response.json();notice.textContent=value.service.available?'文字服务已配置 · 请先向工作人员确认试用结果，再选择套餐与发码方式。':`${value.service.reason} 请待服务恢复后再确认购买；已有激活码仍可兑换。`;notice.classList.toggle('is-paused',!value.service.available);}).catch(()=>{notice.textContent='服务状态暂时无法读取，请先向工作人员确认后再购买。已有激活码可在工作台兑换。';});
})();
