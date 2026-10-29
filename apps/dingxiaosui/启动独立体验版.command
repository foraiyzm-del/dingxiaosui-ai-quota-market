#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
node scripts/start-event-preview.mjs --port 8845
printf '\n程序已退出。若提示端口已占用，直接在浏览器打开 http://127.0.0.1:8845/account/event 即可。\n'
read -r '?按回车关闭窗口。'
