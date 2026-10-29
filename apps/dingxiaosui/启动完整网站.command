#!/bin/zsh
set -e
cd "$(dirname "$0")"

task_node=''
for candidate in "$(command -v node 2>/dev/null || true)" "$HOME/.local/bin/node" "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" '/opt/homebrew/bin/node' '/usr/local/bin/node'; do
  if [[ -x "$candidate" ]] && "$candidate" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
    task_node="$candidate"
    break
  fi
done
if [[ -z "$task_node" ]]; then
  echo '需要 Node.js 22.13 或更新版本，请先安装 Node.js。'
  read '?按回车退出…'
  exit 1
fi
export PATH="$(dirname "$task_node"):$PATH"
unset ZLG_GATEWAY_REQUIRED ZLG_GATEWAY_SECRET

"$task_node" --input-type=module - <<'JS'
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const origin='http://127.0.0.1:8825';
async function ready(){
  try{
    const r=await fetch(origin+'/index.html',{redirect:'manual',signal:AbortSignal.timeout(1500)});
    if(!r.ok)return false;
    const html=await r.text();
    return html.includes('紫丁香计划')&&html.includes('landing.js');
  }catch{return false;}
}
function openSite(){
  spawn('open',[origin],{stdio:'ignore'}).on('error',()=>console.log('请在浏览器打开 '+origin));
}
if(await ready()){
  console.log('完整网站正在运行，已打开首页。');
  openSite();
}else{
  if(!fs.existsSync('.next/standalone/server.js'))throw Error('尚未构建，请先按“本机运行说明.md”安装依赖并构建。');
  console.log('紫丁香完整网站 · 本地版');
  console.log('请保持此窗口开启；停止服务按 Ctrl+C。');
  const child=spawn(process.execPath,['scripts/local-handoff.mjs','start'],{stdio:'inherit'});
  let ended=false;
  child.on('error',error=>{ended=true;console.error(error.message);process.exitCode=1;});
  child.on('exit',(code,signal)=>{ended=true;process.exitCode=signal?0:(code??1);});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
  let opened=false;
  for(let attempt=0;attempt<60&&!ended;attempt++){
    if(await ready()){openSite();opened=true;break;}
    await delay(500);
  }
  if(!opened&&!ended)console.log('启动仍在进行，请查看上方日志，稍后访问 '+origin);
}
JS
