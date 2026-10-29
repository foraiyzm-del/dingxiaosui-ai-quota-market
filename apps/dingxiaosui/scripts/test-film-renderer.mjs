import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {checkRenderer,renderFilm} from '../runtime/film-renderer.mjs';

// Synthetic test pattern + sine waves verify composition only, not AI generation or TTS quality.
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'zdx-film-renderer-test-'));
const ready=await checkRenderer({});
const run=(binary,args)=>new Promise((resolve,reject)=>{const child=spawn(binary,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(new Error(stderr)));});
const video=path.join(temp,'moving-test-pattern.mp4');
await run(ready.ffmpegPath,['-hide_banner','-loglevel','error','-n','-f','lavfi','-i','testsrc2=size=360x640:rate=30:duration=9.8','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',video]);
const narration=['一颗土豆，也能做成一桌宴。','一团面，在手里变成莲花。','岚县，一桌宴与一双手。'];
const audios=[];
for(const [index,duration] of [7.2,10.8,13].entries()){
  const file=path.join(temp,`tone-${duration}.wav`);audios.push(file);
  await run(ready.ffmpegPath,['-hide_banner','-loglevel','error','-n','-f','lavfi','-i',`sine=frequency=${440+index*100}:sample_rate=48000:duration=${duration}`,'-c:a','pcm_s16le',file]);
}
const input=[
  {videoPath:video,audioPath:audios[0],narration:narration[0]},
  {videoPath:video,audioPath:audios[1],narration:narration[1],subtitles:[{text:'蒸汽升起，家常食材有了许多种滋味。',start:0,end:3},{text:'一团面，在手里捏出花瓣，变成莲花、寿桃，再点上一颗红枣。',start:3,end:10.8}]},
  {videoPath:video,audioPath:audios[0],narration:narration[2]},
];
await assert.rejects(()=>renderFilm({directory:temp,segments:[...input.slice(0,2),{...input[2],audioPath:audios[2]}]}),/超过 12 秒/);
await assert.rejects(()=>renderFilm({directory:temp,segments:input.slice(0,2)}),/恰好 3 段/);
await assert.rejects(()=>renderFilm({directory:temp,segments:[{...input[0],subtitles:[{text:'错误时间',start:8,end:9}]},...input.slice(1)]}),/字幕时间戳无效/);
const shortVideo=path.join(temp,'too-short.mp4');
await run(ready.ffmpegPath,['-hide_banner','-loglevel','error','-n','-i',video,'-t','9.4','-an','-c:v','copy',shortVideo]);
await assert.rejects(()=>renderFilm({directory:temp,segments:[{...input[0],videoPath:shortVideo},...input.slice(1)]}),/至少 9.5 秒/);
const rendered=await renderFilm({directory:temp,segments:input,title:'合成模块测试，非 AI 成片'});
assert.equal(rendered.width,720);assert.equal(rendered.height,1280);assert.ok(Math.abs(rendered.duration-30)<0.1);
assert.equal(rendered.segments[0].timingSource,'estimated');assert.equal(rendered.segments[1].timingSource,'provider');
assert.ok(Math.abs(rendered.segments[1].audioSpeed-1.125)<0.001);assert.ok(Math.abs(rendered.segments[1].audioDuration-9.6)<0.001);
assert.ok(rendered.segments.every(segment=>segment.holdSeconds<=0.5));
const srt=await fs.readFile(rendered.srtPath,'utf8'),ass=await fs.readFile(rendered.assPath,'utf8');
assert.match(srt,/一颗土豆/);assert.match(srt,/00:00:19,600/);assert.match(ass,/AI 生成 · 非实拍/);
// Regression for the real sample: a 17th-character period became a lone line,
// and a comma at the second line's start detached from the phrase before it.
const captionLines=srt.trim().split(/\n\s*\n/).flatMap(block=>block.split('\n').slice(2));
assert.ok(captionLines.every(line=>! /^[，。！？；：、,.!?;:…）】》〉」』”’]/u.test(line)&&Array.from(line).length<=17),'Caption wrapping must keep closing punctuation with preceding text within 17 characters');
for(const cue of input[1].subtitles)assert.ok(captionLines.join('').includes(cue.text),'Wrapping must preserve every narration character');
const probe=JSON.parse(await run(ready.ffprobePath,['-v','error','-show_streams','-show_format','-of','json',rendered.videoPath]));
assert.ok(probe.streams.some(stream=>stream.codec_type==='video'&&stream.codec_name==='h264'));
assert.ok(probe.streams.some(stream=>stream.codec_type==='audio'&&stream.codec_name==='aac'));
assert.equal(probe.streams.find(stream=>stream.codec_type==='video').r_frame_rate,'30/1');
// Extract an actual output frame for visual review of CJK glyphs and safe areas.
const screenshot=path.join(temp,'rendered-frame-12s.png');
await run(ready.ffmpegPath,['-hide_banner','-loglevel','error','-n','-ss','12','-i',rendered.videoPath,'-frames:v','1',screenshot]);
await assert.rejects(()=>renderFilm({directory:temp,segments:[{...input[0],videoPath:screenshot},...input.slice(1)]}),/媒体时长无效|实际生成的视频/);
await fs.writeFile(path.join(temp,'verification.json'),JSON.stringify({kind:'synthetic-composition-test-not-ai-video',rendered,screenshot,checks:['30s','720x1280','30fps','H264+AAC','caption text and timing','caption lines preserve text and never start with closing punctuation','10.8s narration retimed without truncation','13s narration rejected','bad cue rejected','short video rejected','still image rejected']},null,2),{flag:'wx'});
console.log(JSON.stringify({passed:true,kind:'synthetic-composition-test-not-ai-video',output:rendered.videoPath,screenshot,verification:path.join(temp,'verification.json')},null,2));
