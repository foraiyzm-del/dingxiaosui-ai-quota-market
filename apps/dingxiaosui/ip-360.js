(() => {
  const angles=[
    {degree:0,name:'正面',x:0,y:0},
    {degree:45,name:'右前',x:33.333,y:0},
    {degree:90,name:'右侧',x:66.667,y:0},
    {degree:135,name:'右后',x:100,y:0},
    {degree:180,name:'背面',x:0,y:100},
    {degree:225,name:'左后',x:33.333,y:100},
    {degree:270,name:'左侧',x:66.667,y:100},
    {degree:315,name:'左前',x:100,y:100},
  ];
  const frame=document.querySelector('#character-frame');
  const label=document.querySelector('#angle-label');
  const dots=document.querySelector('#angle-dots');
  const play=document.querySelector('#angle-play');
  let index=0,timer=null,dragX=null;
  dots.innerHTML=angles.map((angle,i)=>`<button type="button" data-angle="${i}" aria-label="查看${angle.name} ${angle.degree}度">${i+1}</button>`).join('');
  function render(){
    const angle=angles[index];
    frame.style.backgroundPosition=`${angle.x}% ${angle.y}%`;
    frame.setAttribute('aria-label',`丁小穗${angle.name} ${angle.degree}度毛绒实物概念图`);
    label.textContent=`${angle.name} · ${angle.degree}°`;
    dots.querySelectorAll('button').forEach((button,i)=>{button.classList.toggle('active',i===index);button.setAttribute('aria-pressed',String(i===index));});
  }
  function step(amount){index=(index+amount+angles.length)%angles.length;render();}
  function pause(){if(timer)clearInterval(timer);timer=null;play.textContent='自动旋转 ▶';play.setAttribute('aria-pressed','false');}
  document.querySelector('#angle-prev').addEventListener('click',()=>{pause();step(-1);});
  document.querySelector('#angle-next').addEventListener('click',()=>{pause();step(1);});
  dots.addEventListener('click',event=>{const button=event.target.closest('[data-angle]');if(!button)return;pause();index=Number(button.dataset.angle);render();});
  play.addEventListener('click',()=>{if(timer){pause();return;}timer=setInterval(()=>step(1),850);play.textContent='暂停旋转 ‖';play.setAttribute('aria-pressed','true');});
  frame.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();pause();step(event.key==='ArrowRight'?1:-1);}});
  frame.addEventListener('pointerdown',event=>{dragX=event.clientX;frame.setPointerCapture(event.pointerId);});
  frame.addEventListener('pointermove',event=>{if(dragX===null)return;const distance=event.clientX-dragX;if(Math.abs(distance)<32)return;pause();step(distance>0?-1:1);dragX=event.clientX;});
  frame.addEventListener('pointerup',()=>{dragX=null;});
  frame.addEventListener('pointercancel',()=>{dragX=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  document.querySelector('#print-brief').addEventListener('click',()=>window.print());
  render();
})();
