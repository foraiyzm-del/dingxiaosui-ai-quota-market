# 生产部署说明

这份说明给负责把发卡网和丁小穗放到公司服务器上的同事。两个程序是分开的：发卡网管激活码和次数，丁小穗是领导打开创作的网站。浏览器不要直接访问 `127.0.0.1`。

## 2026-11-07 固定卡版本升级

本版本可以只部署独立发卡中心，原丁小穗应用继续使用自己的账户、作品和服务。更新已有站点前，先确认线上丁小穗实际使用的 `QUOTA_CENTER_URL`、对应中心数据目录和平台凭证；备份该中心的 SQLite、`local/config.json`、`local/project-keys.json` 与支付配置，再升级代码。保留同一账本、加密主密钥和项目凭证。不要将本机测试 `local/` 上传覆盖线上，也不要用新空账本直接接管已有用户。

1. 使用 Node.js 24+，在新版本目录运行 `npm ci`、`npm test`、`npm run check`；从现有部署保留私密数据和配置。独立中心可用 `scripts/export-standalone.mjs` 导出，不需要重新部署丁小穗。
2. 在中心后台核对已启用的 `dingxiaosui` 平台、真实三能力渠道以及真实工作台 HTTPS 地址。生产配置不启用 `localModelMock`、`localSimulation` 或 `opcpayPaymentTest`。检查渠道配置不自动发起收费模型请求。
3. 显式建立以下三个商品，交付方式为 `on_payment`，套餐价格与额度完全匹配。初始化草稿不会自动变成这些在售商品；保留原订单、旧商品和旧卡。

| productId | packageId | 名称 | priceCents | quota（text/image/video） |
| --- | --- | --- | --- | --- |
| `dingxiaosui-opcpay-trial` | `trial` | 丁小穗尝鲜卡 | 990 | 10/15/2 |
| `dingxiaosui-opcpay-week` | `week` | 丁小穗周卡 | 2990 | 30/45/6 |
| `dingxiaosui-opcpay-month` | `month` | 丁小穗月卡 | 9900 | 100/150/20 |

4. 运行 `node scripts/setup-opcpay.mjs --add-fixed-packages` 准备私密模板。根字段是尝鲜卡，`packages.week`、`packages.month` 分别绑定专用项目，每个项目只允许一个对应价格的 `QUANTITY / COUNT 1` 套餐。API Key 只写入服务器私有 `local/opcpay.json`；按已有商户资料填写 `skuId`、`merchantProjectName` 与交付许可确认。先运行 `node scripts/probe-opcpay.mjs --all`，各档 `differences` 为空后设置对应 `enabled:true`。
5. 配置真实 `publicOrigin`、`allowedHosts` 与 HTTPS 反向代理（见下文）；采用单 Node 进程守护，不能启用多进程 cluster。购买者使用持久恢复码找回权益；没有支付完成自动回跳，用户扫码后回原兑换页面查询。
6. 重启中心后检查首页三档、`/api/opcpay/info?package=trial|week|month` 的 `ready`、金额与额度。实际浏览器检查购买、卡密交付及到线上丁小穗的激活链接，同时验证旧账户与旧卡余额。三档入口分别是 `/opcpay`、`/opcpay?package=week`、`/opcpay?package=month`。
7. 公网实付由用户亲自扫码，分别记录权益到账、同号核销、唯一交付、准确激活及重复刷新结果；本地模拟和只读探针不能替代公网实付。退款由一人付官方客服人工处理，取消本地兑换不等于现金退款。

回滚时保留升级后产生的订单和核销记录，优先回退代码；不要直接覆盖为旧数据库备份。下一节是首次部署完整双系统的说明，已有线上中心升级时不重新初始化其数据。

## 服务器上要先有什么

- Node.js 24 或更新版本
- 一台能同时跑两个程序的 Linux 服务器
- 一个 HTTPS 域名给发卡网，一个 HTTPS 域名给丁小穗
- Nginx 放在前面，负责证书和转发

程序默认只听本机 `127.0.0.1`。Nginx 和程序在同一台机器时保持这样即可。如果两个程序不在同一台机器，把发卡网配置 `local/config.json` 里的 `host` 改成 `0.0.0.0`，并用防火墙只允许丁小穗那台机器访问。

## 第一次安装

在服务器上：

```sh
git clone https://github.com/foraiyzm-del/dingxiaosui-ai-quota-market.git
cd dingxiaosui-ai-quota-market
npm ci
cd apps/dingxiaosui
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npm run build
cd ../..
node scripts/setup.mjs
node scripts/start.mjs
```

第一次启动会在 `local/ACCESS.md` 写下管理后台密码。这个文件不要外传，也不要提交到 Git。

然后：

1. 用浏览器打开 `https://发卡网域名/admin`，配好 APIMart 渠道、丁小穗平台和 99 元月卡等原有商品。
2. 平台默认模型保持：文案 `deepseek-v4.1-flash`，图片 `gpt-image-2.5-flare`，视频 `seedance-2.0-mini`。不要把全站改成领导卡的模型。
3. 在「业务平台 → 接入」复制丁小穗的平台凭证。
4. 在卡密页保存「丁小穗扫码域名」，填 `https://丁小穗域名`，不要带路径。

丁小穗进程要带这三个环境变量（不要写进网页，也不要加 `NEXT_PUBLIC_` 前缀）：

```sh
QUOTA_CENTER_URL=https://发卡网域名
QUOTA_PLATFORM_KEY=刚才复制的平台凭证
SHOP_PRODUCT_URL=https://发卡网域名/?service=dingxiaosui-creator
APP_ORIGIN=https://丁小穗域名
APP_ENV=production
PASSWORD_AUTH_ENABLED=1
EVENT_ACTIVATION_ENABLED=1
ZLG_GATEWAY_REQUIRED=0
DING_BUILD_ID=构建目录里的 BUILD_ID
```

图片和视频的后台补拉默认开启，作品生成后即使页面关着也会继续保存并确认扣次。只有要临时关掉时才设置 `MEDIA_BACKGROUND_ENABLED=0`。

`QUOTA_CENTER_URL` 必须是丁小穗服务器能够访问的地址。两个程序分开放时，不要填 `http://127.0.0.1:3199`，除非 Nginx 和两个程序确实在同一台机器并且只走本机转发。

如果发卡网要通过域名访问，在 `local/config.json` 增加：

```json
{
  "publicOrigin": "https://发卡网域名",
  "allowedHosts": ["发卡网域名"]
}
```

也可以不改文件，在启动环境里设置 `CENTER_PUBLIC_ORIGIN` 和 `CENTER_ALLOWED_HOSTS`。没配域名时，Nginx 带着正式域名来访问会被拒绝，页面会表现为打不开或兑换失败。

## Nginx

两个站点都要把读超时放到 600 秒。文案有时要一两分钟。高清视频实际大约 3 分钟，等待和代理超时要留到 5 分钟以上，避免做到一半被掐断。

```nginx
server {
  listen 443 ssl;
  server_name 发卡网域名;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:3199;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
  }
}
```

丁小穗把 `3199` 换成它的端口（本地预览是 `8845`），`server_name` 换成丁小穗域名。

## 用 systemd 守护

`/etc/systemd/system/quota-center.service`：

```ini
[Unit]
Description=发卡网
After=network.target

[Service]
WorkingDirectory=/opt/dingxiaosui-ai-quota-market
ExecStart=/usr/bin/node scripts/start.mjs
Restart=always
RestartSec=3
Environment=CENTER_PUBLIC_ORIGIN=https://发卡网域名
Environment=CENTER_ALLOWED_HOSTS=发卡网域名

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/dingxiaosui.service` 同样 `Restart=always`，`WorkingDirectory` 指到 `apps/dingxiaosui`，启动命令用项目原来的 `scripts/start-event-preview.mjs`，并把上面的环境变量写进 `Environment=`。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now quota-center dingxiaosui
```

进程崩溃后会自己拉起来。更新代码后执行 `sudo systemctl restart quota-center dingxiaosui`。

如果更熟悉 pm2，也可以：

```sh
pm2 start scripts/start.mjs --name quota-center
pm2 start apps/dingxiaosui/scripts/start-event-preview.mjs --name dingxiaosui --cwd apps/dingxiaosui
pm2 save
pm2 startup
```

## 日志

systemd 已经把输出收进 journal：

```sh
journalctl -u quota-center -u dingxiaosui -f
```

要落到文件并按天切割，新增 `/etc/logrotate.d/dingxiaosui`：

```
/var/log/dingxiaosui/*.log {
  daily
  rotate 14
  missingok
  compress
  copytruncate
}
```

pm2 用户执行 `pm2 install pm2-logrotate`。

## 数据库

发卡网启动时已经打开 SQLite 的 WAL。不要在程序运行时直接拷贝 `local/center.sqlite` 这一个文件，那样会漏掉正在写入的日志，备份可能打不开。

每天备份：

```sh
node scripts/backup-sqlite.mjs local/center.sqlite local/backups
```

丁小穗的数据在 `apps/dingxiaosui/.local-event-runtime/`，用同样的命令备份里面的 sqlite 文件。备份和 `local/config.json`、丁小穗的加密主密钥要放在一起保管。只有数据库、没有密钥，渠道密钥和卡密都解不开。

可以用 cron：

```cron
15 3 * * * cd /opt/dingxiaosui-ai-quota-market && /usr/bin/node scripts/backup-sqlite.mjs local/center.sqlite local/backups
```

## 上线后自查

在服务器项目目录执行：

```sh
CENTER_URL=http://127.0.0.1:3199 DING_URL=http://127.0.0.1:8845 node scripts/prod-healthcheck.mjs
```

它会告诉你：

- 发卡网和丁小穗是否在线
- 丁小穗能不能连上发卡中心
- APIMart 密钥是否有效，以及这个密钥还剩多少余额（接口有返回时）
- 每个渠道还能发多少次
- 最近一小时有多少失败任务

最后一行是「检查通过」就说明这几项目前正常。密钥不会打印出来。

## 领导体验卡怎么印

这批卡和 99 元月卡不是同一个商品。每张是 **10 次文案、15 张图、2 条视频**，有效期 90 天。只有这批卡使用更强的模型：文案 `claude-sonnet-5-5`，图片仍是 `gpt-image-2.5-flare` 1k，视频 `seedance-2.5`、720p、5 秒、无声。99 元月卡继续用原来的模型和 480p 视频。

建议一次做 120 张：100 张发给领导，20 张留作备用。

先确认 APIMart 账户里的钱够用。按公开单价估算，100 张如果全部用完大约 **1800 元人民币**，120 张大约 **2200 元**（视频按每条 1.08 美元，文案按输入 1.6 美元、输出 8 美元每一百万字，图片按每张 0.01 美元从高估计；汇率按 7.2 只供备款，以 APIMart 账单为准）。以前按 50 次文案、100 张图、3 条视频估算的约 3400 元已经作废，以这次 10 / 15 / 2 为准。

在服务器项目目录执行：

```sh
node scripts/issue-leader-cards.mjs --quantity 120 --days 90 --origin https://丁小穗域名
```

制卡前会用 APIMart 的模型列表检查这把密钥有没有领导卡要用的模型。没有权限时会用中文写出缺哪几个，并停下来。密钥已经能用保底模型、只是高配还没开通时，可以加 `--allow-missing-models` 先把卡印出来，生成时会自动改用已开通的模型。

生产站点入口是 `https://zdx.aiglink.cn/workbench.html`。制卡时 `--origin` 填 `https://zdx.aiglink.cn`（把工作台地址贴进来也可以，程序会只用域名）。二维码和 CSV 里的链接是 `https://zdx.aiglink.cn/redeem?code=激活码`。这是丁小穗同一个 Next 服务上的页面，和 `/workbench.html` 在同一进程里。更新代码后必须重新构建并重启丁小穗，旧进程里没有 `/redeem`，扫码会打开失败。

如果渠道里已经登记过发码额度，而这批卡需要的次数不够，命令会停下来并写明还差多少。确认要自动补上差额时再加 `--top-up`。已经做过一批又要再做，加 `--force`。

命令成功后，在 `local/leader-cards/` 里会有：

- 一个 CSV：卡号（DXS-0001 这种）、激活码、套餐、有效期、扫码链接、空的「领取人」列
- 一个 ZIP：每张卡一个二维码 PNG，文件名就是卡号

把 CSV 和 ZIP 交给印刷厂。激活码没有 0 和 O、没有 1 和 I、也没有 L，4 位一组。扫码打开的是 `https://丁小穗域名/redeem?code=...`，页面会先填好激活码，领导自己点确认才会兑换。

后台也可以做同样的事，但命令更不容易选错商品：管理后台 → 卡密库存 → 选「领导体验卡」→ 发放方式选「实体卡」→ 数量 120、有效天数 90 → 生成。然后点「导出 CSV」和「导出二维码」。作废未发出的卡用「整批作废未兑换」。查询某一张用卡号，能看到有没有兑换、还剩多少次。

已经兑换的卡不能从后台直接作废额度。过了 90 天还没兑换的卡不能再激活；已经兑换过的卡，之后再用同一张码打开，仍然能回到原来的作品。
