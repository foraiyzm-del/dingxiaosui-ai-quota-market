# 业务平台与发卡中心接入

发卡中心负责商品、库存、订单交付及平台独立次数；业务平台负责自己的登录用户和具体业务体验。商品对应一个平台，SKU 对应这个平台的次数包。渠道和模型绑定在平台上，不由买家或浏览器指定。

主服务使用 Node HTTP 与 SQLite，默认只监听 `127.0.0.1:3199`。仓库中的丁小穗已接入组合购买、激活、生成与作品持久化流程。核心测试使用隔离数据库、模拟支付回调和模拟上游；开发者需配置自己的渠道、支付与部署环境。

## 凭证与用户身份

在后台「业务平台 → 接入凭证」获取本平台的服务地址和凭证。凭证也保存在本机 `local/project-keys.json`；上游 API Key 与该平台服务凭证是不同凭证。

所有 `/api/v1/` 接口使用：

```http
Authorization: Bearer <本平台的服务端凭证>
Content-Type: application/json
```

凭证只保存在业务平台后端，不能放入网页 JavaScript 或前端构建变量。中心根据凭证确定 `projectId`，覆盖请求体同名字段。`userId` 必须由业务平台后端从已验证的登录会话取得，不能接受浏览器任意指定他人账号。一个平台的凭证不能读取另一个平台的余额、卡密或生成任务。

`/platform/{id}` 是本地接入演示，以浏览器 Cookie 作为演示账户；其 `/api/platforms/{id}/...` 接口不替代正式平台的登录系统。旧 `/demo` 只模拟账本，不调用模型。

## 两种接法

| 接法 | 适用业务 | 扣次责任 |
| --- | --- | --- |
| `generate` | 一次服务对应一个模型生成任务 | 中心预留、调用上游、判定结果并结算 |
| `reserve → commit/cancel` | 原平台已有复杂流程，一次业务可能调用多个模型 | 原平台执行业务并决定交付结果，中心维护次数账本 |

同一次服务只能选择一种接法。`generate` 已包含扣次，不要在外层再调用 `reserve` 或 `commit`。

## 服务端 SDK

项目提供 `sdk/client.mjs`，无需额外 npm SDK。将该模块放在业务平台后端使用：

```js
import { createUsageClient } from './sdk/client.mjs';

const usage = createUsageClient({
  baseUrl: process.env.QUOTA_CENTER_URL, // 根地址或以 /api/v1 结尾的地址均可
  apiKey: process.env.QUOTA_PLATFORM_KEY,
});

// userId 来自后端已验证的登录会话。
await usage.redeem({ userId, code: submittedCode });
const balance = await usage.balance(userId);

// requestId 在业务数据库中保存；网络重试必须使用同一值和相同内容。
const job = await usage.generate({
  userId,
  requestId: persistedBusinessRequestId,
  capability: 'text',
  prompt: '为这款包装撰写一段营销文案……',
});

// 图片和视频都可能先返回 running；持久保存 job.id，再查询原任务。
const current = await usage.job({ id: job.id, userId });
```

SDK 方法为 `redeem({userId,code,idempotent?})`、`balance(userId)`、`generate({...})`（支持下文全部生成扩展参数）、`job({id,userId})`、`reserve({userId,requestId,units,capability?})`、`commit(usageId)`、`cancel(usageId)`。非 2xx 响应抛出带 `status` 的错误。默认请求超时为 130 秒，可按已配置渠道的等待时间设置 `timeoutMs`；客户端超时不表示中心取消了任务。

## 兑换和余额

基地址：`http://127.0.0.1:3199`。成功直接返回对象，错误返回非 2xx 及 `{ "error": "错误信息" }`。

| 操作 | 方法与路径 | 输入或结果 |
| --- | --- | --- |
| 兑换卡密 | `POST /api/v1/redeem` | `{userId,code}` → `{codeId,projectId,userId,units,balance}` |
| 查询余额 | `GET /api/v1/balance?userId=...` | 返回下方余额结构 |

```json
{
  "projectId": "packaging-design",
  "userId": "u_123",
  "granted": 100,
  "available": 98,
  "reserved": 1,
  "consumed": 1
}
```

始终满足 `granted = available + reserved + consumed`。同一个用户在另一个平台拥有另一份余额。库存卡必须已出售才能兑换；历史直接签发卡保持原兑换规则。每张卡只能入账一次，默认重复兑换返回 409。

平台后端可显式传 `{userId,code,idempotent:true}`：仅同平台、同一张卡、同一持久用户身份允许重放，返回原 `codeId/units/quota`、当前 `balance` 和 `replayed:true`，不再次增加余额；其他用户仍返回 409。丁小穗先保存卡哈希与稳定身份映射，再用该模式兑换，因此首次响应丢失也能安全恢复。不能仅凭总余额推断卡已到账，浏览器不能指定用户身份。

### 文字、图片、视频独立次数

组合卡使用 `quota: {"text":3,"image":1,"video":1}`，对应文案 3 次、图片 1 张、视频 1 个。`units:5` 仅是摘要，不代表五次额度可以在不同能力间互换。缺少 `quota` 的历史卡继续计入共享次数，不迁移为任意某种能力。

兑换过组合卡的账户额外返回以下字段，原顶层字段为所有桶的总和；纯共享账户和新空账户仍返回原结构：

```json
{
  "shared": {"granted":0,"available":0,"reserved":0,"consumed":0},
  "byCapability": {
    "text": {"granted":3,"available":3,"reserved":0,"consumed":0},
    "image": {"granted":1,"available":1,"reserved":0,"consumed":0},
    "video": {"granted":1,"available":1,"reserved":0,"consumed":0}
  }
}
```

`generate` 按请求的 `capability` 扣除对应能力次数。原平台自行执行时，`reserve` 同样必须传入 `capability` 才能使用分项次数；未传时只可使用历史共享次数，不能绕过分项限制。扣除顺序为所选能力桶优先、不足部分由共享次数补充；不能借用其他能力余额。退款恢复本次原先扣除的各个桶。相同 `requestId` 改变能力或数量均返回 409。

前端应以 `byCapability[capability].available + shared.available` 判断当前能力可用次数；没有 `byCapability` 时兼容使用原顶层 `available`。不要以组合账户的顶层总余额判断某一能力是否还有次数。

## 中心执行模型任务

| 操作 | 方法与路径 | 输入或结果 |
| --- | --- | --- |
| 获取可用视频时长 | `GET /api/v1/generation-options?userId=...` | `{video:{available,durationSeconds,durationOptions,resolution}}`，仅返回已鉴权平台中该用户的规格，不含渠道凭证 |
| 创建或重试原任务 | `POST /api/v1/generate` | `{userId,requestId,capability,prompt,size?,seconds?}` → `Job` |
| 获取任务／查询视频进展 | `GET /api/v1/generation/{id}?userId=...` | `Job` |
| 获取受保护的媒体 | `GET /api/v1/generation/{id}/content?userId=...&index=0` | 图片／视频二进制，仍须平台 Bearer 凭证；图片序号当前仅 0 |

`capability` 为 `text`、`image` 或 `video`；`requestId` 最长 160 字符，提示词最长 20,000 字符。尺寸格式为 `1024x1024` 等或 `auto`；通用视频秒数校验范围 1–120；APIMart Seedance 2.0 / mini / fast / 2.5 在本平台仅允许 5、10、15 秒，未传则沿用卡片默认。其他 APIMart 模型不得用该接口突破原默认时长。前端应使用 `generation-options` 返回的 `durationOptions`，不自行推断所有渠道都支持新时长。图片一次请求固定生成一张。模型、渠道与每次扣除次数均由平台配置决定，客户端提交其他模型或接口地址不会覆盖路由。

业务平台扩展字段：文字可传 `messages:[{role:"system"|"user"|"assistant",content:string}]`（最多 64 条、总长 131072 字符）、`responseFormat:"json_object"`、`maxTokens:1..32768`。JSON 模式只在返回非空 JSON 对象时扣次，否则返还；业务平台额外的内容校验失败需核对原任务，不能再调用一次或擅自退款。图片／视频可传 `aspectRatio:"1:1"|"3:4"|"4:3"|"16:9"|"9:16"`，上游模型仍有自己的支持范围。

APIMart 图生图接受 `referenceImage` PNG/JPEG/WebP data URL（原始文件最多 6 MiB，校验真实容器）。中心先上传，再将临时 URL 传给生成接口；生成提交前上传失败返还次数。原图不在中心持久保存，全部扩展字段参与幂等哈希，换图必须使用新的请求 ID。只对已鉴权的 `/api/v1/generate` 放宽请求体至 9 MiB。

`Job` 的主要字段为 `{id,projectId,userId,requestId,capability,status,units,output,error,tokenUsage,estimatedCostCents,costIsEstimate,createdAt,updatedAt}`。输出格式：

| 能力 | `output` |
| --- | --- |
| 文字 | `{text}` |
| 图片 | `{images:[{url}]}` 或 `{images:[{dataUrl}]}` |
| 视频 | `{videoUrl?,contentAvailable}`；有 `contentAvailable` 时可用鉴权下载接口 |

浏览器不能拿平台服务凭证直接访问视频接口。业务平台后端应鉴权用户后转发内容，或保存到自己的受控媒体存储。临时上游图片／视频链接可能过期，不等同于永久存储。

| 任务状态 | 次数处理与恢复 |
| --- | --- |
| `queued` / `running` | 次数已预留，等待调用或视频结果；不得另建相同任务重复执行 |
| `succeeded` | 已结算消费；重复查询或重试原请求不再次计费 |
| `failed` | 明确失败，已预留次数返还；不会自动重发原请求 |
| `uncertain` | 超时、连接中断或协议无法识别，保留预留，等待核对 |

唯一键为 `(projectId,userId,requestId)`。同一键、相同请求内容重试返回原任务；改变内容返回 409。中心持久保存任务并避免重复发送生成 POST。明确的上游拒绝可返还次数，HTTP 5xx、超时等含糊结果保留预留。管理员通过后台核对上游任务或账单，再确认扣次或返还；不要先返还再自动重跑。

服务运行期间后台定时查询已知的图片和视频任务，关闭页面不影响查询。重启后恢复已知媒体任务；在发出生成请求后中断且未取得上游任务 ID 的任务转为待核对，不能自动重发。渠道有未结算媒体任务时，不能删除其模型或更改接口地址与路径。

估算费用来自后台模型价格与上游 token 用量；未配置成本返回 `null`。它不是供应商账单，也不是净利润。

## 原平台自行执行复杂业务

| 操作 | 方法与路径 | 输入或结果 |
| --- | --- | --- |
| 预留次数 | `POST /api/v1/usage/reserve` | `{userId,requestId,units:1,capability?:"image"}` → `{usage,balance}` |
| 成功结算 | `POST /api/v1/usage/{usageId}/commit` | `{}` → `{usage,balance}` |
| 失败返还 | `POST /api/v1/usage/{usageId}/cancel` | `{}` → `{usage,balance}` |

`usage` 包含 `{id,projectId,userId,requestId,units,status,createdAt,settledAt}`，状态为 `reserved`、`committed`、`cancelled`。`userId/requestId` 最长 200 字符；`units` 为 1–1,000,000 的整数。相同用户和请求 ID 重试相同次数的预留会返回原记录；不同次数返回 409。重复相同结算动作幂等，反向改变已结算结果返回 409。

这组接口只维护账本，不替原平台执行模型。平台必须在自己的持久业务任务中保存请求 ID、执行状态、`usageId` 和结果，并用唯一约束及执行锁保证只执行一次：

```js
// 在业务数据库中原子抢占任务后，仅全新任务执行此流程。
const { usage: reservation } = await usage.reserve({
  userId,
  requestId: persistedBusinessRequestId,
  units: 1,
  capability: 'image', // 必须匹配实际业务；组合额度不能省略能力类型。
});
// 将 reservation.id 和 in_flight 状态写入业务数据库。
// 执行已有平台的工作流，可包含多次 API 调用。
// 结果确认完整并持久保存后：
await usage.commit(reservation.id);
// 只有确定失败且不交付时，才使用 usage.cancel(reservation.id)。
```

模型执行超时或状态不明时保留预留，并进入业务恢复队列。`commit` 响应丢失只重试 `commit`，不能重做模型调用；`cancel` 同理。次数接口本身没有自动超时返还，也不能仅凭 `reserved` 判定此前模型未执行。一次业务有多次调用时，由业务平台决定整体成功与计费规则，不能对每一步再调用中心 `generate` 造成重复扣次。

常见状态码：400 参数无效；401 凭证无效；402 次数不足；404 平台范围内找不到资源；409 幂等、库存或状态冲突；429 限流。调用端必须检查 HTTP 状态。

## 商品、库存与订单接口

公开商城接口不使用平台 Bearer 凭证。每笔订单使用自己的访问 `token`，邮箱只是联系方式，不是取卡凭证。

| 操作 | 方法与路径 | 输入或结果 |
| --- | --- | --- |
| 商品列表 | `GET /api/shop/products` | `{products,platforms,qrConfigured,payment}` |
| 创建订单 | `POST /api/shop/orders` | `{productId,email,packageId}`、`{productId,email,customUnits}` 或 `{productId,email,customQuota:{text,image,video}}`，三种选法互斥；返回订单及 `token` |
| 查询订单／取卡 | `GET /api/shop/orders/{id}?token=...` | 订单；仅已交付时包含完整 `code` |
| 发起支付 | `POST /api/shop/orders/{id}/pay?token=...` | `{method:"wxpay"}` 或 `alipay`；易支付返回 `redirectUrl` |
| 提交人工付款线索 | `POST /api/shop/orders/{id}/proof?token=...` | `{reference,payer,paidAt}`；仅人工收款模式 |
| 取消待付款订单 | `POST /api/shop/orders/{id}/cancel?token=...` | `{}`；已提交资料不能自行取消 |

价格与次数以服务端商品配置重新计算并保存快照，客户端报价无效。SKU 含 `stockAvailable`；商品的 `customStock` 为 `{units,available}` 列表。自定义价格以微元保存、向上取整到分；一元为 1,000,000 微元，一分为 10,000 微元。

商品 `fulfillment` 为 `stock`（默认，兼容历史商品）时，下单预留一张商品、SKU、平台、总次数及分项组合均匹配的卡。固定 SKU 库存与自定义库存分别匹配；自定义订单不能从任意固定套餐拆卡。没有匹配库存则拒绝下单。

商品 `fulfillment:"on_payment"` 时，下单无需预先库存，不会生成可兑换卡；通过支付回调验签或管理员核实到账后，按订单固化的 `quota`、平台和数量生成一张卡、激活并交付。重试付款通知或审批返回原卡，订单下单后的商品编辑不改变此次交付。该方式同样保留库存和批次审计记录。

固定组合 SKU 在 `packageOptions[]` 内加入 `quota` 即可，`units` 由服务端计算总和。开放自由组合需 `fulfillment:"on_payment"` 及以下配置：

```json
{
  "quotaPricing": {
    "enabled": true,
    "unitPriceMicros": {"text":100000,"image":200000,"video":500000},
    "maxCounts": {"text":100,"image":100,"video":100}
  }
}
```

以上仅为格式示例价格。每元等于 1,000,000 微元；服务端以整数精确计算 `ceil(sum(数量×单价微元)/10000)` 分，合计后统一向上取整。`maxCounts` 默认每项 1,000,000，设置 0 可关闭该能力；开放项单价必须为正整数。组合数量各为非负整数，合计须在 1–1,000,000 内；不接受未知能力。分项商品不能改用旧 `customUnits` 获得可互换的共享额度。组合订单只校验此次选中的平台能力路由，不因未购买能力的渠道停用而阻塞。

订单当前没有客户端幂等键；下单响应丢失应核对原订单，不能拿生成任务的 `requestId` 当下单幂等键。

待付款 `pending` 在 30 分钟后过期；人工付款资料提交后为 `submitted`，自提交时起预留 24 小时。过期或取消释放库存并显示 `expired` / `cancelled`。核账与库存交付在同一数据库事务内完成，正常直接成为 `fulfilled`；历史 `approved` 状态仍兼容。相同订单重复确认不换卡，相同交易号不能交付第二笔订单。

卡密库存是 `available → reserved → sold`，兑换状态另记。未售库存卡不可兑换。批量导出不会激活库存；旧 `/api/admin/codes` 仍是直接签发卡的兼容接口，不会自动加入商城库存，新商品制卡使用库存接口。

## 后台配置接口

`POST /api/admin/login` 使用 `{password}` 建立 HttpOnly 管理会话；以下接口使用该 Cookie，平台 Bearer 凭证不能代替管理会话。

| 操作 | 方法与路径 | 主要字段 |
| --- | --- | --- |
| 汇总状态 | `GET /api/admin/state` | 平台、渠道、商品、库存、批次、订单、次数和生成任务 |
| 新增／更新渠道 | `POST /api/admin/channels` | `{id,name,baseUrl,apiKey?,enabled,models,protocol?,endpoints?,videoRequestFormat?,timeoutMs?}` |
| 新增／更新平台 | `POST /api/admin/platforms` | `{id,name,url,description,enabled,unitsPerUse,bindings}` |
| 查看平台服务凭证 | `POST /api/admin/platforms/{id}/credential` | 返回 `{projectId,apiKey,baseUrl}`，仅管理员主动查看 |
| 保存商品 | `POST /api/admin/products` | `{id,projectId,name,description,units,priceCents,active,packageOptions,customPricing,fulfillment?,quotaPricing?}`；SKU 可带 `quota` |
| 批量生成库存 | `POST /api/admin/inventory/generate` | `{productId,packageId,quantity}` 或 `{productId,units,quantity}` |
| 导出批次卡密 | `GET /api/admin/inventory/export?batchId=...` | 含完整卡密，需私密保存 |
| 人工核账发卡 | `POST /api/admin/shop-orders/{id}/approve` | `{confirmed:true,verifiedReference,note}`；已关闭订单经核对可用 `recovery:true` |
| 核对生成结果 | `POST /api/admin/generation/{id}/resolve` | `{action:"commit"或"cancel",note}` |
| 支付配置 | `GET/POST /api/admin/payment-settings` | `{mode,gatewayUrl,merchantId,apiKey?,publicBaseUrl,enabledMethods}` |
| 恢复已到账异常订单 | `POST /api/admin/payment-issues/{id}/recover` | `{confirmed:true,note}`，这里的 `id` 为订单 ID |
| 上传人工收款码 | `POST /api/admin/payment-qr` | PNG/JPEG/WebP 原始字节，不是 multipart；最大 2 MiB |
| 退出 | `POST /api/admin/logout` | 清除管理会话 |

渠道模型格式为 `{id,capability,pricing?}`，可选价格字段为 `perRequestCents`、`inputPerMillionCents`、`outputPerMillionCents`，单位均为分，允许非负小数。密钥加密保存，列表只返回 `hasKey/keyHint`；更新时空密钥沿用原值。

平台绑定格式为 `bindings:[{capability,channelId,model}]`。每种能力最多一个绑定。`ready/readiness` 说明配置是否完整可用，不代表已经真实连通上游。旧 SKU 路由字段为兼容历史数据保留；新生成任务使用平台路由，不使用买家提交的 SKU 路由。

`protocol` 支持 `openai-compatible` 与 `apimart`。OpenAI 兼容协议默认相对路径为 `text:chat/completions`、`image:images/generations`、`video:videos`、`videoStatus:videos/{id}`、`videoContent:videos/{id}/content`，视频默认 multipart，可设 `videoRequestFormat:"json"`。APIMart 使用 JSON 视频请求、`video:videos/generations` 和 `videoStatus:tasks/{id}`，自动识别图片与视频异步任务，详见 [APIMart 接入说明](apimart-integration.md)。请求超时可设 1,000–300,000 毫秒。其他厂商协议不能仅靠改路径保证兼容，需按实际文档适配请求和响应。

默认上游 HTTP 客户端拒绝本机、内网和保留地址，固定 DNS 解析结果连接，不跟随重定向。渠道允许保存地址不等于允许运行时向任意内部地址发请求；本地模拟上游的放行仅用于隔离测试配置。

## 支付通知和异常恢复

人工模式需商家在真实收款账单核对，客户资料不自动发卡。易支付使用签名收银台链接及 `/api/payment/notify` 异步通知；实现兼容 V1 MD5 协议，参考 [易支付接口文档](https://yzf.yzfpay.com/doc/v1_legacy_api.html)。

通知支持 GET 或表单 POST，拒绝重复参数，校验签名、商户、订单金额、支付方式、成功状态和唯一交易号。验签通过后先持久保存到账信息，再尝试交付库存。重复通知幂等；到账后库存交付失败保存 `needs_review`，后台核实并补足库存后恢复。浏览器 `/payment-return/{token}` 只跳回订单，不批准支付。

支付配置中的 `publicBaseUrl` 必须是实际可接收通知的 HTTPS 域名。当前 loopback 服务尚未提供该公网入口，实际商户参数及回调连通性需要正式接入时验收。支付退款不在当前接口内，次数 cancel 也不是退款操作。

## 数据与验证

订单、库存、次数、生成任务和加密配置共用 `local/center.sqlite`。订单私有链接、完整卡密、平台服务凭证及渠道密钥不能进公共日志。根加密密钥在 `local/config.json`，恢复必须配套备份该配置、数据库和 `local/project-keys.json`；运行时 SQLite WAL 使用一致性备份工具或 `VACUUM INTO`，不能只随手复制主数据库。

`npm run check` 检查脚本语法；`npm test` 使用隔离数据验证核心行为。测试包括完整购卡到兑换消费流程，以及真实本地 HTTP 适配器的文字请求、视频 multipart、轮询、下载和超时处理。模拟支付通知与本地 HTTP 上游通过不代表真实交易或付费模型已验收。当前按单进程运行，不宣称已完成多实例部署、正式用户接入或公网支付接入。
