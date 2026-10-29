import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const WIDTH=720, HEIGHT=1280, FPS=30;
const DEFAULT_FONTS=[
  '/System/Library/Fonts/Supplemental/Songti.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
];

function run(binary,args,{cwd,timeout=120000,onData}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{cwd,stdio:['ignore','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='',settled=false;
    const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL')},3000).unref();finish(new Error('视频合成等待超时，输入文件已保留，可稍后重新合成。'));},timeout);
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve({stdout,stderr});};
    child.stdout.on('data',data=>{stdout=(stdout+data).slice(-2*1024*1024);onData?.(String(data));});
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-64000)});
    child.on('error',error=>finish(new Error(error.code==='ENOENT'?'未找到视频合成工具，请配置 FFmpeg 和 FFprobe。':'无法启动视频合成工具，请检查本机执行权限。')));
    child.on('close',code=>finish(code===0?null:Object.assign(new Error('视频合成工具执行失败，输入文件已保留。'),{diagnostic:stderr.slice(-12000)})));
  });
}

async function binaryPath(explicit,name){
  if(explicit){if(typeof explicit!=='string'||explicit.includes('\0'))throw new Error('合成工具路径无效');return explicit;}
  for(const item of [`/opt/homebrew/bin/${name}`,`/usr/local/bin/${name}`,`/usr/bin/${name}`]){
    try{await fs.access(item);return item}catch{}
  }
  return name;
}

/** Read-only preflight. No model call and no media render. */
export async function checkRenderer({ffmpegPath,ffprobePath,fontPath}={}){
  const ffmpeg=await binaryPath(ffmpegPath,'ffmpeg'), ffprobe=await binaryPath(ffprobePath,'ffprobe');
  const [{stdout:filters},{stdout:encoders}]=await Promise.all([
    run(ffmpeg,['-hide_banner','-filters']),run(ffmpeg,['-hide_banner','-encoders']),run(ffprobe,['-version']),
  ]);
  if(!/\bsubtitles\s+V->V/.test(filters))throw new Error('当前 FFmpeg 未包含 libass 字幕组件，请安装支持 subtitles 的版本。');
  if(!/\blibx264\b/.test(encoders)||!/^\s*A\S*\s+aac\s/m.test(encoders))throw new Error('当前 FFmpeg 缺少 H.264 或 AAC 编码器。');
  let font;
  for(const candidate of fontPath?[fontPath]:DEFAULT_FONTS){
    try{const stat=await fs.stat(candidate);if(stat.isFile()&&stat.size>100000){font=await fs.realpath(candidate);break}}catch{}
  }
  if(!font)throw new Error('未找到中文字体，请配置 FILM_FONT_PATH（宋体或 Noto Sans CJK 字体文件）。');
  const fontName=/songti|stsong/i.test(font)?'Songti SC':'Noto Sans CJK SC';
  return {ready:true,ffmpegPath:ffmpeg,ffprobePath:ffprobe,fontPath:font,fontName,width:WIDTH,height:HEIGHT,fps:FPS};
}

async function inspectMedia(ffprobe,file,type,index){
  if(typeof file!=='string'||file.includes('\0'))throw new Error(`第 ${index+1} 段${type==='video'?'视频':'配音'}文件路径无效。`);
  let actual,stat;
  try{actual=await fs.realpath(file);stat=await fs.stat(actual)}catch{throw new Error(`第 ${index+1} 段${type==='video'?'视频':'配音'}文件不存在。`)}
  if(!stat.isFile()||stat.size===0)throw new Error(`第 ${index+1} 段媒体文件为空。`);
  const result=await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',actual]);
  let info;try{info=JSON.parse(result.stdout)}catch{throw new Error(`第 ${index+1} 段媒体文件无法读取。`)}
  const stream=info.streams?.find(item=>item.codec_type===type&&!item.disposition?.attached_pic);
  if(!stream)throw new Error(`第 ${index+1} 段缺少有效${type==='video'?'动态视频':'配音音频'}轨道。`);
  const streamDuration=Number(stream.duration);
  const duration=Number.isFinite(streamDuration)&&streamDuration>0?streamDuration:Number(info.format?.duration);
  if(!Number.isFinite(duration)||duration<=0)throw new Error(`第 ${index+1} 段媒体时长无效。`);
  if(type==='video'){
    const [num,den]=String(stream.avg_frame_rate||'0/1').split('/').map(Number);
    // Image files or a one-frame cover must never stand in for generated footage.
    // Metadata cannot prove AI provenance or visual quality; the generation/QC layer must do that.
    if(/image2|png_pipe|jpeg_pipe|webp_pipe/.test(String(info.format?.format_name))||!den||num/den<1||Number(stream.nb_frames||2)<2)throw new Error(`第 ${index+1} 段必须是实际生成的视频，不能使用静态图片代替。`);
    if(duration<9.5)throw new Error(`第 ${index+1} 段视频只有 ${duration.toFixed(2)} 秒，无法组成 10 秒镜头；请提供至少 9.5 秒的动态视频。`);
    if(duration>120||stream.width>8192||stream.height>8192)throw new Error(`第 ${index+1} 段视频超出本次样片合成范围。`);
  }else if(duration>12.0001){
    throw new Error(`第 ${index+1} 段配音长达 ${duration.toFixed(2)} 秒，超过 12 秒；请缩短这一段文案后重新配音，不会截断旁白。`);
  }
  return {path:actual,duration,codec:stream.codec_name,width:stream.width,height:stream.height};
}

function cleanText(value,max=2000){
  if(typeof value!=='string')return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max);
}
function wrapText(text,width=16){
  const chars=Array.from(text.replace(/\s+/g,' '));const lines=[];
  const closing=char=>!!char&&/[，。！？；：、,.!?;:…）】》〉」』”’]/u.test(char);
  for(let start=0;start<chars.length;){
    let end=Math.min(start+width,chars.length);
    if(closing(chars[end])){
      let after=end;while(closing(chars[after]))after++;
      // Keep punctuation with its preceding character, allowing at most one
      // extra glyph. A longer closing sequence moves with the last character.
      if(after-start<=width+1)end=after;
      else{while(end>start+1&&closing(chars[end-1]))end--;if(end>start+1)end--;}
    }
    lines.push(chars.slice(start,end).join(''));start=end;
  }
  return lines.join('\n');
}
function assText(text){return text.replace(/\\/g,'＼').replace(/\{/g,'｛').replace(/\}/g,'｝').replace(/\r?\n/g,'\\N');}
function makeCues(segment,duration,index){
  const supplied=Array.isArray(segment.subtitles)&&segment.subtitles.length>0;
  if(supplied){
    if(segment.subtitles.length>200)throw new Error(`第 ${index+1} 段字幕条数过多。`);
    const cues=segment.subtitles.map(cue=>({text:cleanText(cue.text),start:Number(cue.start),end:Number(cue.end)}));
    let prior=0;
    for(const cue of cues){
      if(!cue.text||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||cue.end<=cue.start||cue.end>duration+0.15||cue.start<prior-0.01)throw new Error(`第 ${index+1} 段字幕时间戳无效，请重新检查配音字幕。`);
      prior=cue.end;
    }
    // Shorten a very long provider line into readable cards, retaining its timing range.
    const split=cues.flatMap(cue=>{
      const chars=Array.from(cue.text),count=Math.ceil(chars.length/30);
      return Array.from({length:count},(_,j)=>({text:wrapText(chars.slice(j*30,(j+1)*30).join('')),start:cue.start+(cue.end-cue.start)*j/count,end:Math.min(duration,cue.start+(cue.end-cue.start)*(j+1)/count)}));
    });
    return {cues:split,timingSource:'provider'};
  }
  const narration=cleanText(segment.narration);
  if(!narration)throw new Error(`第 ${index+1} 段缺少配音文案，无法生成字幕。`);
  const pieces=(narration.match(/[^，。！？；,.!?;]+[，。！？；,.!?;]?/gu)||[narration]).flatMap(piece=>{
    const chars=Array.from(piece.trim());const result=[];
    for(let i=0;i<chars.length;i+=24)result.push(chars.slice(i,i+24).join(''));
    return result;
  }).filter(Boolean);
  const weights=pieces.map(piece=>Math.max(1,Array.from(piece.replace(/[\s，。！？；,.!?;]/g,'')).length));
  const total=weights.reduce((a,b)=>a+b,0);let at=0;
  const cues=pieces.map((text,i)=>{const start=duration*at/total;at+=weights[i];return {text:wrapText(text),start,end:duration*at/total}});
  return {cues,timingSource:'estimated'};
}
function stamp(seconds,kind){
  const scale=kind==='ass'?100:1000,units=Math.round(Math.max(0,seconds)*scale);
  const h=Math.floor(units/(3600*scale)),m=Math.floor(units/(60*scale))%60,s=Math.floor(units/scale)%60,f=units%scale;
  return `${String(h).padStart(kind==='ass'?1:2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${kind==='ass'?'.':','}${String(f).padStart(kind==='ass'?2:3,'0')}`;
}
function subtitleFiles(cues,title,fontName){
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${WIDTH}\nPlayResY: ${HEIGHT}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,${fontName},36,&H00FFFFFF,&H00FFFFFF,&H00101010,&H78000000,0,0,0,0,100,100,0,0,1,2.2,0.7,2,60,60,165,1\nStyle: Label,${fontName},22,&H00FFFFFF,&H00FFFFFF,&H00242424,&H78000000,0,0,0,0,100,100,0,0,1,1.2,0,9,28,28,32,1\nStyle: Title,${fontName},54,&H00F7F0E8,&H00F7F0E8,&H00191311,&H78000000,1,0,0,0,100,100,1,0,1,2,1,8,50,50,170,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const line=(start,end,style,text,layer=0)=>`Dialogue: ${layer},${stamp(start,'ass')},${stamp(end,'ass')},${style},,0,0,0,,${assText(text)}\n`;
  const titleLines=title.includes('，')?title.replace('，','\n'):wrapText(title,12);
  const ass=header+line(0,30,'Label','AI 生成 · 非实拍',2)+line(0,3,'Title',titleLines,1)+line(28,30,'Title',titleLines,1)+cues.map(cue=>line(cue.start,cue.end,'Caption',cue.text)).join('');
  const srt=cues.map((cue,i)=>`${i+1}\n${stamp(cue.start,'srt')} --> ${stamp(cue.end,'srt')}\n${cue.text}\n`).join('\n');
  return {ass,srt};
}

/** Compose three already-generated video + narration pairs. This never generates AI footage. */
export async function renderFilm({directory,segments,title='岚县，一桌宴与一双手',ffmpegPath,ffprobePath,fontPath,onProgress}={}){
  if(typeof directory!=='string'||!directory||directory.includes('\0'))throw new Error('缺少有效的视频输出目录。');
  if(!Array.isArray(segments)||segments.length!==3)throw new Error('30 秒样片需要恰好 3 段视频和对应配音。');
  title=cleanText(title,100);if(!title)throw new Error('请填写短片标题。');
  const ready=await checkRenderer({ffmpegPath,ffprobePath,fontPath});
  const actual=[];const allCues=[];
  for(let i=0;i<segments.length;i++){
    const segment=segments[i];if(!segment||typeof segment!=='object')throw new Error(`第 ${i+1} 段素材无效。`);
    const [video,audio]=await Promise.all([inspectMedia(ready.ffprobePath,segment.videoPath,'video',i),inspectMedia(ready.ffprobePath,segment.audioPath,'audio',i)]);
    const rate=audio.duration>10?audio.duration/9.6:1;
    const {cues,timingSource}=makeCues(segment,audio.duration,i);
    allCues.push(...cues.map(cue=>({text:cue.text,start:i*10+cue.start/rate,end:Math.min((i+1)*10,i*10+cue.end/rate)})));
    actual.push({index:i,videoPath:video.path,audioPath:audio.path,sourceVideoDuration:video.duration,sourceAudioDuration:audio.duration,audioSpeed:rate,audioDuration:audio.duration/rate,holdSeconds:Math.max(0,10-video.duration),duration:10,timingSource,subtitles:cues.length});
  }
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const folder=path.join(await fs.realpath(directory),'render-'+randomUUID());await fs.mkdir(folder,{mode:0o700});
  const {ass,srt}=subtitleFiles(allCues,title,ready.fontName);
  const assPath=path.join(folder,'captions.ass'),srtPath=path.join(folder,'captions.srt'),videoPath=path.join(folder,'film.mp4');
  await Promise.all([fs.writeFile(assPath,ass,{flag:'wx',mode:0o600}),fs.writeFile(srtPath,srt,{flag:'wx',mode:0o600})]);
  // A fixed local font filename avoids filtergraph path escaping and loads the exact font.
  const fonts=path.join(folder,'fonts');await fs.mkdir(fonts,{mode:0o700});
  await fs.copyFile(ready.fontPath,path.join(fonts,'chinese'+path.extname(ready.fontPath)));
  const args=['-hide_banner','-loglevel','warning','-nostdin','-n'];
  for(const segment of actual)args.push('-i',segment.videoPath,'-i',segment.audioPath);
  const filters=[];
  for(let i=0;i<actual.length;i++){
    const segment=actual[i];
    filters.push(`[${i*2}:v:0]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=${Math.min(0.5,segment.holdSeconds+1/FPS).toFixed(6)},trim=duration=10,setpts=PTS-STARTPTS[v${i}]`);
    filters.push(`[${i*2+1}:a:0]aresample=48000,atempo=${segment.audioSpeed.toFixed(8)},apad=whole_dur=10,atrim=duration=10,asetpts=PTS-STARTPTS[a${i}]`);
  }
  filters.push('[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[vcat][acat]');
  filters.push('[vcat]subtitles=filename=captions.ass:fontsdir=fonts[vout]');
  args.push('-filter_complex',filters.join(';'),'-map','[vout]','-map','[acat]','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-r',String(FPS),'-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart','-t','30','-progress','pipe:1',videoPath);
  const reportProgress=value=>{try{onProgress?.(value)}catch{/* Progress observers must not interrupt an active encoder. */}};
  reportProgress({stage:'rendering',progress:0});
  let progressBuffer='';
  const render=await run(ready.ffmpegPath,args,{cwd:folder,timeout:600000,onData:chunk=>{
    progressBuffer+=chunk;let index;
    while((index=progressBuffer.indexOf('\n'))>=0){const line=progressBuffer.slice(0,index);progressBuffer=progressBuffer.slice(index+1);const match=/^out_time_us=(\d+)/.exec(line);if(match)reportProgress({stage:'rendering',progress:Math.min(0.99,Number(match[1])/30000000)});}
  }});
  await fs.chmod(videoPath,0o600);
  if(/fontselect: failed|Glyph .* not found|failed to find font/i.test(render.stderr))throw new Error('成片中文字形未完整加载，请检查中文字体后重新合成。');
  const probe=JSON.parse((await run(ready.ffprobePath,['-v','error','-show_streams','-show_format','-of','json',videoPath])).stdout);
  const video=probe.streams?.find(stream=>stream.codec_type==='video'),audio=probe.streams?.find(stream=>stream.codec_type==='audio'),duration=Number(probe.format?.duration);
  if(!video||!audio||video.width!==WIDTH||video.height!==HEIGHT||Math.abs(duration-30)>0.1)throw new Error('成片时长、尺寸或音轨校验未通过，文件已保留供检查。');
  reportProgress({stage:'complete',progress:1});
  return {videoPath,srtPath,assPath,duration,width:WIDTH,height:HEIGHT,fps:FPS,segments:actual};
}
