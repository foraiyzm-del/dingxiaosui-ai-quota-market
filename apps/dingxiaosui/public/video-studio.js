'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const statusNames = {queued:'等待生成',running:'正在制作',succeeded:'已完成',failed:'生成失败',needs_attention:'需要核对'};
  const activeStatuses = new Set(['queued','running']);
  const segmentNames = ['土豆宴','面塑手作','一桌宴与一双手'];
  const defaultPreset = {
    title:'岚县，一桌宴与一双手',
    segments:[
      {prompt:'10秒，9:16竖屏。山西岚县土豆宴的写实创意影像：土豆表皮微距开场，切到暖色木桌上的陶碗与蒸屉，概念菜肴散发轻柔蒸汽。一双成年人的手将陶碗轻轻放下。自然侧光、朴实家常，镜头平稳。食物不魔法变形，不虚构餐馆标志。不生成文字、旁白、字幕和音乐。',narration:'一颗土豆，能做出多少种滋味？在山西岚县，土豆也能做成一桌宴。'},
      {prompt:'10秒，9:16竖屏。岚县面塑手作创意影像：固定近景，一双成年人的手在木案上缓慢捏压一片面团花瓣；切到白面莲花、桃子造型和红枣装饰细节。暖色自然窗光、真实面团纹理。不展示具体传承人，不做魔法生长，手指结构正常。不生成文字、旁白、字幕和音乐。',narration:'一团面，在手里慢慢长出花瓣，变成莲花、桃子，再点上红枣。'},
      {prompt:'10秒，9:16竖屏。暖米色木桌左侧为土豆宴概念菜肴，右侧为白面莲花和桃子面塑。镜头从手将面花轻放桌面的近景缓慢拉远，最后保持稳定，为标题留白。自然侧光，家常朴实，不冒充具体餐馆和真实活动。无物体漂浮、手指变形，不生成任何文字、旁白、字幕和音乐。',narration:'用人工智能，让资料里的味道与手艺，变成眼前的想象。岚县，一桌宴与一双手。'}
    ]
  };
  let workspace = null, selectedJob = null, jobs = [], scope = null;
  let posting = false, refreshing = false, polling = false, settingsSaving = false;
  let pending = null, timer = null, settingsRevision = null, initialized = false, identityEpoch = 0;
  let settingsHasVideoKey = false, settingsHasSpeechKey = false, settingsHasSpeechAccessToken = false;
  let resumeTarget = null;
  const storagePrefix = 'zdx-film-v1:';

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function showNotice(text, success = false) {
    $('#notice').textContent = text || '';
    $('#notice').hidden = !text;
    $('#notice').classList.toggle('is-success',success);
  }
  function settingsNotice(text, success = false) {
    $('#settings-notice').textContent = text || '';
    $('#settings-notice').hidden = !text;
    $('#settings-notice').classList.toggle('is-success',success);
  }
  function clearSecretInputs(){
    $('#video-api-key').value='';$('#speech-api-key').value='';$('#speech-access-token').value='';
  }
  function updateSpeechAuthMode(){
    const legacy=$('#speech-auth-mode').value==='legacy';
    $('#speech-api-fields').hidden=legacy;$('#speech-legacy-fields').hidden=!legacy;
    $('#speech-api-key').disabled=legacy;$('#speech-app-id').disabled=!legacy;$('#speech-access-token').disabled=!legacy;
    $('#speech-app-id').required=legacy;
    $('#speech-auth-help').textContent=legacy?'继续使用已有语音应用的 App ID 和 Access Token，无需迁移应用。该应用需要已开通语音合成 2.0。':'使用新版语音控制台生成的 API Key。';
  }
  function applyPublicSettings(settings){
    settingsRevision=settings.revision;
    settingsHasVideoKey=!!settings.hasVideoKey;settingsHasSpeechKey=!!settings.hasSpeechKey;settingsHasSpeechAccessToken=!!settings.hasSpeechAccessToken;
    $('#video-model').value=settings.videoModel||'';
    $('#speech-auth-mode').value=settings.speechAuthMode==='legacy'?'legacy':'apiKey';
    $('#speech-app-id').value=settings.speechAppId||'';
    clearSecretInputs();updateSpeechAuthMode();
    $('#video-api-key').placeholder=settingsHasVideoKey?'已保存；留空保留原密钥':'填写火山方舟 API Key';
    $('#speech-api-key').placeholder=settingsHasSpeechKey?'已保存；留空保留原密钥':'填写豆包语音 API Key';
    $('#speech-access-token').placeholder=settingsHasSpeechAccessToken?'已保存；留空保留原 Token':'填写该语音应用的 Access Token';
    $('#video-key-status').textContent=settingsHasVideoKey?'视频密钥已保存，页面不显示原文。':'尚未保存视频密钥。';
    $('#speech-key-status').textContent=settingsHasSpeechKey?'语音密钥已保存，页面不显示原文。':'尚未保存语音密钥。';
    $('#speech-token-status').textContent=settingsHasSpeechAccessToken?'语音 Access Token 已保存，页面不显示原文。':'尚未保存语音 Access Token。';
  }
  function localKey(suffix) { return scope ? storagePrefix + scope + ':' + suffix : null; }
  function readStorage(storage, suffix) {
    const key = localKey(suffix);
    if (!key) return null;
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
  }
  function writeStorage(storage, suffix, value) {
    const key = localKey(suffix);
    if (!key) return false;
    try { if(value === null) storage.removeItem(key); else storage.setItem(key,JSON.stringify(value)); return true; } catch { return false; }
  }
  function safeMediaUrl(value) {
    if(typeof value !== 'string') return null;
    try {
      const url = new URL(value,window.location.origin);
      if(url.origin !== window.location.origin || !url.pathname.startsWith('/api/films/') || url.username || url.password) return null;
      return url.pathname + url.search;
    } catch { return null; }
  }
  function resetIdentity() {
    identityEpoch++;
    stopPolling();
    workspace = null; selectedJob = null; jobs = []; pending = null; scope = null; initialized = false;
    $('#auth-notice').hidden = false;
    $('#workspace').hidden = true;
    $('#open-settings').hidden = true;
    $('#banner-settings').hidden = true;
    $('#settings-dialog').close();
    closeResumeDialog();
    clearSecretInputs();$('#speech-app-id').value='';
    $('#film-player').pause(); $('#film-player').removeAttribute('src'); $('#film-player').load();
    renderJob(); renderHistory(); renderCapabilities(); updateControls();
  }
  async function api(url, {method='GET',body} = {}) {
    let response;
    try {
      response = await fetch(url,{method,cache:'no-store',credentials:'same-origin',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(30000),...(body === undefined ? {} : {body:JSON.stringify(body)})});
    } catch {
      const error = new Error(method === 'POST' ? '提交回执暂未确认。请先刷新任务记录；再次点击会沿用同一请求，不会主动另发一条。' : '暂时无法连接本站服务，请检查网络后重试。');
      error.uncertain = method === 'POST';
      throw error;
    }
    let data;
    try { data = await response.json(); } catch {
      const error = new Error('本站暂未返回完整结果，请刷新状态核对。'); error.uncertain = method === 'POST'; throw error;
    }
    if (!response.ok) {
      if(response.status === 401 || response.status === 403) resetIdentity();
      const error = new Error(data.error || '请求未完成，请稍后再试。'); error.status = response.status;
      error.uncertain = method === 'POST' && response.status >= 500;
      throw error;
    }
    return data;
  }
  function setPreset(preset) {
    const value = preset?.segments?.length === 3 ? preset : defaultPreset;
    $('#film-title').value = value.title || defaultPreset.title;
    $('#segments').replaceChildren();
    value.segments.forEach((segment,index) => {
      const details = node('details',null,'segment'); details.open = index === 0;
      const summary = node('summary');
      const text = node('span',null,'segment-summary-text');
      text.append(node('strong',segmentNames[index]),node('small',`${index * 10}–${(index + 1) * 10} 秒`));
      summary.append(node('span',String(index+1).padStart(2,'0'),'segment-number'),text,node('span','›','segment-chevron'));
      const content = node('div',null,'segment-body');
      const voiceLabel = node('label'); voiceLabel.htmlFor = `narration-${index}`;
      const voiceHeading = node('span','讲述这段画面'); voiceHeading.append(node('em','知性女声'));
      const voice = node('textarea'); voice.id = `narration-${index}`; voice.name = `narration-${index}`; voice.rows=3; voice.maxLength=60; voice.required=true; voice.value=segment.narration || ''; voice.dataset.segment=String(index);
      voiceLabel.append(voiceHeading,voice,node('small','每段最多 60 字，建议 30–40 字，留一点时间给画面。'));
      const imageLabel = node('label'); imageLabel.htmlFor = `prompt-${index}`;
      const imageHeading = node('span','想看到怎样的镜头'); imageHeading.append(node('em','可调整'));
      const prompt = node('textarea',null,'prompt'); prompt.id = `prompt-${index}`; prompt.name = `prompt-${index}`; prompt.rows=4; prompt.maxLength=1800; prompt.required=true; prompt.value=segment.prompt || ''; prompt.dataset.segment=String(index);
      imageLabel.append(imageHeading,prompt); content.append(voiceLabel,imageLabel); details.append(summary,content); $('#segments').append(details);
    });
  }
  function draft() {
    return {title:$('#film-title').value.trim(),segments:[0,1,2].map(index=>({prompt:$(`#prompt-${index}`).value.trim(),narration:$(`#narration-${index}`).value.trim()}))};
  }
  function persistPending(value) {
    pending = value;
    return writeStorage(window.sessionStorage,'pending',value);
  }
  function renderCapabilities() {
    const capabilities = workspace?.capabilities;
    const banner = $('#capability-banner');
    banner.classList.toggle('is-ready',!!capabilities?.ready);
    banner.classList.toggle('is-missing',!!capabilities && !capabilities.ready);
    $('#open-settings').hidden = !workspace?.canConfigure;
    $('#banner-settings').hidden = !workspace?.canConfigure || !!capabilities?.ready;
    $('#missing-list').replaceChildren();
    const missing = Array.isArray(capabilities?.missing) ? capabilities.missing : [];
    $('#missing-list').hidden = !missing.length;
    for(const reason of missing) $('#missing-list').append(node('li',reason));
    if(!workspace) {
      $('#capability-title').textContent = $('#auth-notice').hidden ? '创作服务暂未连接' : '请先登录创作账号';
      $('#capability-summary').textContent = '你的草稿会保留在当前页面，连接服务后再提交生成。';
    } else if(capabilities?.ready) {
      $('#capability-title').textContent = '视频、配音与合成已配置';
      $('#capability-summary').textContent = '可以提交创作；任务会在本站显示真实进度，完成后直接播放与下载。';
    } else {
      $('#capability-title').textContent = '还差接口配置，即可开始创作';
      $('#capability-summary').textContent = workspace.canConfigure ? '先填写下方缺少的服务。分镜和旁白已准备好，保存配置后可继续。' : '请联系本站管理员配置下方服务。你可以先编辑分镜与旁白。';
    }
  }
  function updateControls() {
    const active = jobs.some(job=>activeStatuses.has(job.status));
    const unresolved = !!pending && !pending.jobId;
    const blocked = posting || active || unresolved;
    $('#creative-fields').disabled = !!blocked;
    $('#generation-consent').disabled = !!posting || !!active || !workspace;
    const complete = $('#film-title').value.trim() && [0,1,2].every(index=>$(`#prompt-${index}`)?.value.trim() && $(`#narration-${index}`)?.value.trim());
    $('#generate').disabled = !workspace?.capabilities?.ready || !complete || !$('#generation-consent').checked || posting || !!active;
    $('#generate-label').textContent = posting ? '正在提交…' : active ? '正在制作这条短片' : unresolved ? '确认这次提交的结果' : '生成 30 秒短片';
    $('#generation-help').textContent = active ? '生成需要一些时间，刷新页面后可继续查看进度。' : unresolved ? '当前请求的回执还未确认，暂时锁定内容；重试会使用原请求标识。' : workspace?.capabilities?.ready ? '依次生成镜头、配音，再合成字幕。请保持本站服务运行。' : '接口就绪后，可以在这里开始生成。';
    $('#refresh').disabled = refreshing || polling;
    $('#resume').disabled = posting || active || !selectedJob?.canResume;
    $('#confirm-resume').disabled = posting || active || !resumeTarget;
    $('#settings-fields').disabled = settingsSaving;
    $('#save-settings').disabled = settingsSaving || settingsRevision === null;
    $('#save-settings').textContent = settingsSaving ? '正在保存…' : '保存接口配置 ↗';
  }
  function renderHistory() {
    $('#history').replaceChildren(); $('#history-count').textContent = `${jobs.length} 条`;
    if(!jobs.length){ $('#history').append(node('p','完成的短片和处理中任务会保存在这里。','empty-history')); return; }
    for(const job of jobs) {
      const button=node('button',null,'history-item'); button.type='button'; button.classList.toggle('is-selected',job.id===selectedJob?.id);
      if(job.id===selectedJob?.id) button.setAttribute('aria-current','true');
      const meta=node('div'); const date=new Date(job.createdAt);
      meta.append(node('strong',job.title || '30 秒短片'),node('small',Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '时间待确认'));
      button.append(node('span',job.status==='succeeded'?'▷':'◷','history-icon'),meta,node('span',statusNames[job.status] || '待确认'));
      button.addEventListener('click',()=>selectJob(job)); $('#history').append(button);
    }
  }
  function renderJob() {
    const job = selectedJob;
    if(resumeTarget && (resumeTarget.epoch!==identityEpoch || resumeTarget.id!==job?.id || !job?.canResume))closeResumeDialog();
    $('#job-badge').textContent=job ? statusNames[job.status] || '待确认' : '尚未生成';
    $('#current-stage').textContent=job?.stage || (job ? statusNames[job.status] || '正在读取任务状态。' : '还没有提交生成任务。');
    $('#selected-job-title').textContent=job ? '当前任务进度' : '生成进度';
    $('#job-error').textContent=job?.error || ''; $('#job-error').hidden=!job?.error;
    $('#resume').hidden=!job?.canResume;
    $('#job-segments').replaceChildren();
    for(let index=0;index<3;index++) {
      const segment=job?.segments?.[index]; const status=segment?.status; const li=node('li'); const body=node('div');
      const complete=['succeeded','complete','completed'].includes(status);
      const active=['running','queued','submitting'].includes(status);
      li.classList.toggle('is-complete',complete); li.classList.toggle('is-active',active); li.classList.toggle('is-failed',['failed','needs_attention'].includes(status));
      body.append(node('strong',segmentNames[index]),node('small',segment?.stage || (status ? statusNames[status] || '待处理' : '等待提交')));
      li.append(node('span',String(index+1).padStart(2,'0')),body,node('i',complete?'✓':active?'·':'—')); $('#job-segments').append(li);
    }
    const output=job?.status==='succeeded' ? job.output : null;
    const videoUrl=safeMediaUrl(output?.videoUrl), downloadUrl=safeMediaUrl(output?.downloadUrl), subtitleUrl=safeMediaUrl(output?.subtitleUrl);
    const player=$('#film-player'); player.hidden=!videoUrl; $('#preview-placeholder').hidden=!!videoUrl;
    if(videoUrl) {
      if(player.getAttribute('src')!==videoUrl) {player.pause(); player.setAttribute('src',videoUrl); player.load();}
      $('#download-video').hidden=!downloadUrl; if(downloadUrl) $('#download-video').href=downloadUrl;
      $('#download-subtitles').hidden=!subtitleUrl; if(subtitleUrl) $('#download-subtitles').href=subtitleUrl;
      $('#output-actions').hidden=!downloadUrl&&!subtitleUrl;
      const info=[]; if(Number.isFinite(output.duration)) info.push(`${output.duration} 秒`); if(output.width&&output.height)info.push(`${output.width} × ${output.height}`); info.push('知性女声 · 中文字幕');if(output.subtitleTiming==='mixed-or-estimated')info.push('部分字幕按语句估时，请试听校对');
      $('#output-details').textContent=info.join(' · '); $('#output-details').hidden=false;
    } else {
      if(player.hasAttribute('src')){player.pause();player.removeAttribute('src');player.load();}
      $('#output-actions').hidden=true; $('#output-details').hidden=true;
      $('#placeholder-title').textContent=job?.status==='succeeded' ? '成片地址暂不可用' : job && activeStatuses.has(job.status) ? '正在制作你的短片' : job?.status==='failed' || job?.status==='needs_attention' ? '这次制作还未完成' : '成片将在这里显示';
      $('#placeholder-description').textContent=job?.status==='succeeded' ? '请刷新任务状态，核对本站保存的文件' : job && activeStatuses.has(job.status) ? '下方显示真实任务进度' : job?.error ? '请查看下方具体原因后继续' : '真实生成完成后，可直接播放和下载';
    }
  }
  function selectJob(job) {
    selectedJob=job; writeStorage(window.localStorage,'last-job',job.id); renderJob(); renderHistory(); updateControls(); schedulePoll();
  }
  function upsertJob(job,select = true) {
    if(!job || typeof job.id!=='string') return;
    jobs=[job,...jobs.filter(item=>item.id!==job.id)].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    if(pending?.jobId===job.id && !activeStatuses.has(job.status)) persistPending(null);
    if(select || selectedJob?.id===job.id){selectedJob=job;writeStorage(window.localStorage,'last-job',job.id);} renderJob(); renderHistory(); updateControls(); schedulePoll();
  }
  function stopPolling(){if(timer)clearTimeout(timer);timer=null;}
  function schedulePoll(){stopPolling();if(jobs.some(job=>activeStatuses.has(job.status)) && workspace)timer=setTimeout(()=>void pollJob(),4000);}
  async function pollJob(){
    const target=selectedJob && activeStatuses.has(selectedJob.status) ? selectedJob : jobs.find(job=>activeStatuses.has(job.status));
    if(polling||!target||!workspace)return;
    if(document.hidden){schedulePoll();return;}
    const id=target.id,epoch=identityEpoch;polling=true;updateControls();
    try{const data=await api('/api/films/jobs/'+encodeURIComponent(id));if(epoch===identityEpoch)upsertJob(data.job,false);}
    catch(error){if(epoch===identityEpoch)showNotice(error.message);}
    finally{polling=false;updateControls();schedulePoll();}
  }
  async function loadWorkspace(){
    if(refreshing)return;
    refreshing=true;updateControls();
    try{
      const data=await api('/api/films');
      const newScope=typeof data.storageScope==='string' && /^[a-zA-Z0-9_-]{8,128}$/.test(data.storageScope) ? data.storageScope : null;
      if(scope && newScope!==scope){identityEpoch++;selectedJob=null;pending=null;initialized=false;stopPolling();closeResumeDialog();}
      scope=newScope;workspace=data;jobs=Array.isArray(data.jobs)?data.jobs:[];
      if(!data.canConfigure && $('#settings-dialog').open)$('#settings-dialog').close();
      $('#auth-notice').hidden=true;$('#workspace').hidden=false;
      if(!initialized){
        setPreset(data.preset);initialized=true;
        const stored=readStorage(window.sessionStorage,'pending');
        if(stored && typeof stored.requestId==='string' && typeof stored.signature==='string') {
          try {const body=JSON.parse(stored.signature);if(body.title && body.segments?.length===3){pending=stored;if(!stored.jobId){setPreset(body);showNotice('已恢复上一条回执未确认的请求。请先刷新记录；需要再次提交时会沿用原请求。');}}} catch {writeStorage(window.sessionStorage,'pending',null);}
        }
      }
      const last=readStorage(window.localStorage,'last-job');
      const found=jobs.find(item=>item.id===selectedJob?.id) || jobs.find(item=>item.id===pending?.jobId) || jobs.find(item=>item.id===last) || jobs.find(item=>activeStatuses.has(item.status)) || jobs[0] || null;
      selectedJob=found;
      if(pending?.jobId && jobs.some(job=>job.id===pending.jobId && !activeStatuses.has(job.status)))persistPending(null);
      renderCapabilities();renderHistory();renderJob();schedulePoll();
    }catch(error){showNotice(error.message);renderCapabilities();}
    finally{refreshing=false;updateControls();}
  }
  async function submitFilm(event){
    event.preventDefault();if(posting||!workspace?.capabilities?.ready||!$('#generation-consent').checked)return;
    if(jobs.some(job=>activeStatuses.has(job.status)))return;
    const value=draft();if(!value.title||value.segments.some(item=>!item.prompt||!item.narration))return;
    const signature=JSON.stringify(value);
    if(pending && pending.signature!==signature){showNotice('上一次提交结果还未确认，请先核对任务记录，不能直接改动内容另发请求。');return;}
    if(!pending){
      if(!scope){showNotice('服务未提供当前账号的请求存储范围，暂时不能安全提交。请联系管理员检查配置。');return;}
      if(!persistPending({requestId:crypto.randomUUID(),signature,jobId:null})){pending=null;showNotice('浏览器未能保存请求标识，已阻止提交。请允许本站会话存储后再试。');return;}
    }
    posting=true;showNotice('');updateControls();const epoch=identityEpoch;
    try{
      const data=await api('/api/films',{method:'POST',body:{...JSON.parse(pending.signature),requestId:pending.requestId,consent:true}});
      if(epoch!==identityEpoch)return;
      if(!data.job?.id)throw Object.assign(new Error('未取得有效任务回执。请刷新记录核对，原请求标识已保留。'),{uncertain:true});
      persistPending({...pending,jobId:data.job.id});$('#generation-consent').checked=false;upsertJob(data.job);
      showNotice('任务已保存。镜头、配音和合成进度会在右侧更新。',true);
    }catch(error){
      if(epoch===identityEpoch){if(error.status && error.status<500 && !error.uncertain)persistPending(null);showNotice(error.message);}
    }finally{posting=false;updateControls();}
  }
  async function openSettings(){
    if(!workspace?.canConfigure)return;
    settingsRevision=null;settingsNotice('正在读取配置…');$('#settings-dialog').showModal();updateControls();
    try{
      const data=await api('/api/films/settings');
      if(!data.canConfigure){$('#settings-dialog').close();showNotice('当前账号不能修改接口配置。');return;}
      applyPublicSettings(data.settings);settingsNotice('');
    }catch(error){settingsNotice(error.message);}
    finally{updateControls();}
  }
  async function saveSettings(event){
    event.preventDefault();if(settingsSaving||settingsRevision===null||!workspace?.canConfigure)return;
    const videoKey=$('#video-api-key').value.trim(),speechAuthMode=$('#speech-auth-mode').value==='legacy'?'legacy':'apiKey';
    const body={videoModel:$('#video-model').value.trim(),speechAuthMode,speechResourceId:'seed-tts-2.0',speechVoice:'zh_female_zhixingnv_uranus_bigtts',revision:settingsRevision};
    if(videoKey)body.videoApiKey=videoKey;
    if(speechAuthMode==='legacy'){
      body.speechAppId=$('#speech-app-id').value.trim();
      const token=$('#speech-access-token').value.trim();if(token)body.speechAccessToken=token;
    }else{
      const speechKey=$('#speech-api-key').value.trim();if(speechKey)body.speechApiKey=speechKey;
    }
    settingsSaving=true;settingsNotice('');updateControls();
    try{
      const data=await api('/api/films/settings',{method:'PUT',body});
      clearSecretInputs();
      if(data.settings)applyPublicSettings(data.settings);
      settingsNotice('配置已保存。请关闭此窗口，核对内容后提交一次真实生成。',true);await loadWorkspace();
    }catch(error){settingsNotice(error.message);}
    finally{settingsSaving=false;updateControls();}
  }
  function closeResumeDialog(){
    resumeTarget=null;
    if($('#resume-dialog').open)$('#resume-dialog').close();
  }
  function openResumeDialog(){
    if(posting||!workspace||!selectedJob?.canResume||jobs.some(job=>activeStatuses.has(job.status)))return;
    resumeTarget={id:selectedJob.id,epoch:identityEpoch};
    $('#resume-job-title').textContent=selectedJob.title || '30 秒短片';
    updateControls();$('#resume-dialog').showModal();
  }
  async function confirmResumeJob(){
    const target=resumeTarget;
    if(posting||!workspace||!target||target.epoch!==identityEpoch||target.id!==selectedJob?.id||!selectedJob.canResume||jobs.some(job=>activeStatuses.has(job.status)))return;
    const {id,epoch}=target;
    posting=true;closeResumeDialog();showNotice('');updateControls();
    try{const data=await api('/api/films/jobs/'+encodeURIComponent(id)+'/resume',{method:'POST',body:{consent:true}});if(epoch===identityEpoch)upsertJob(data.job);}
    catch(error){if(epoch===identityEpoch)showNotice(error.message);}
    finally{posting=false;updateControls();}
  }
  $('#film-form').addEventListener('submit',submitFilm);
  $('#creative-fields').addEventListener('input',()=>{$('#generation-consent').checked=false;updateControls();});
  $('#generation-consent').addEventListener('change',updateControls);
  $('#refresh').addEventListener('click',()=>void loadWorkspace());
  $('#open-settings').addEventListener('click',()=>void openSettings());$('#banner-settings').addEventListener('click',()=>void openSettings());
  $('#close-settings').addEventListener('click',()=>$('#settings-dialog').close());
  $('#settings-dialog').addEventListener('close',clearSecretInputs);
  $('#speech-auth-mode').addEventListener('change',()=>{$('#speech-api-key').value='';$('#speech-access-token').value='';updateSpeechAuthMode();});
  $('#settings-form').addEventListener('submit',saveSettings);
  $('#resume').addEventListener('click',openResumeDialog);
  $('#close-resume').addEventListener('click',closeResumeDialog);
  $('#cancel-resume').addEventListener('click',closeResumeDialog);
  $('#resume-dialog').addEventListener('close',()=>{resumeTarget=null;updateControls();});
  $('#resume-dialog').addEventListener('cancel',()=>{resumeTarget=null;});
  $('#confirm-resume').addEventListener('click',()=>void confirmResumeJob());
  window.addEventListener('storage',event=>{if(event.key==='zdx-auth-change-v1'){resetIdentity();void loadWorkspace();}});
  window.addEventListener('focus',()=>{if(!posting&&!settingsSaving)void loadWorkspace();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!posting&&!settingsSaving)void loadWorkspace();});
  window.addEventListener('pagehide',stopPolling);
  setPreset(defaultPreset);void loadWorkspace();
})();
