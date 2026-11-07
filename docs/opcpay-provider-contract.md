# 一人付协议核对记录

核对日期：2026-11-07。本文记录公开文档和 SDK 的已确认契约，不代表商户项目已开通、真实套餐已存在或生产支付已验证。此次未使用 API Key，未购买、核销或修改商户后台。

同日周/月扩展重新核对：公开契约版本仍为下述提交，COUNT 核销仍无 SKU 参数，不能以一次核销判定购买了哪档卡。现实现为 trial/week/month 三个独立专用收款配置；每个项目只含自己金额的 COUNT 1 套餐。单一配置的历史说明仍适用于每档分别校验。商户实际状态见 [独立商城最新记录](standalone-payment-connected-20261107.md)，此协议文档不代替真实探针或付款验收。

## 来源与版本

- [一人付官网](https://ai6666.com/opcpay/)与[服务端文档](https://ai6666.com/opcpay/docs/)。
- [公开 OpenAPI](https://ai6666.com/opcpay/api/v1/pay/developer/openapi.json)：文档版本 `1.1.2`，协议运行版本 `1.1`。其中示例是结构说明，不是商户运行时数据。
- [SDK 当前核对提交](https://github.com/Yapie0/opcpay/tree/cfcfb076ff1d30aef455fbde358d0a96943bcfa5)：`cfcfb076ff1d30aef455fbde358d0a96943bcfa5`，提交时间 `2026-10-29T10:13:19+08:00`。
- 同一提交的[快速接入](https://github.com/Yapie0/opcpay/blob/cfcfb076ff1d30aef455fbde358d0a96943bcfa5/docs/quickstart.md)、[集成参考](https://github.com/Yapie0/opcpay/blob/cfcfb076ff1d30aef455fbde358d0a96943bcfa5/skills/opcpay/references/integration.md)、[SDK 实现](https://github.com/Yapie0/opcpay/blob/cfcfb076ff1d30aef455fbde358d0a96943bcfa5/index.mjs)、[类型定义](https://github.com/Yapie0/opcpay/blob/cfcfb076ff1d30aef455fbde358d0a96943bcfa5/index.d.ts)和[交付示例](https://github.com/Yapie0/opcpay/blob/cfcfb076ff1d30aef455fbde358d0a96943bcfa5/examples/node/server.mjs)。公开仓库提供 SDK 和示例，不能据此声称已审计支付服务端实现。

### 基址差异

SDK 默认基址是 `https://ai6666.com/opcpay/api/pay/v1`；同日公开 OpenAPI 的 `servers.url` 是 `https://pay.66opc.com/api/pay/v1`。这是已发现的文档差异，本次未用凭证验证两者等价。接入以 SDK 默认值为依据；正式配置时用项目凭证只读检查实际基址、能力和套餐，不能因文档域名不同自动转发凭证或跟随重定向。

所有业务接口使用服务端 Bearer 鉴权与 JSON，Key 不进入浏览器、仓库或日志。SDK 请求禁止重定向，超时为 60 秒。

## 请求与响应

下列路径均相对于经确认的 API 基址；`?` 表示可选字段。字段约束和分支见上述 OpenAPI。

| 操作 | 请求正文 | 关键返回 |
| --- | --- | --- |
| `GET /capabilities` | 无 | `api_version`、`provider_configured`、`capabilities`、`webhook_events`、`limitations` |
| `GET /product` | 无 | `capability_status`、`billing_mode?`、`quota_unit?`、`charging_options` |
| `POST /purchase` | `{user_id,idempotency_key,sku_id?,callback_url?}` | `status: READY/FAILED/UNKNOWN`、`idempotency_key`；可有 `purchase_url`、`purchase_qr_code`、`expire_time`、`charging_option` |
| `POST /purchase/query` | `{user_id,idempotency_key}` | 购买请求记录；原返回值位于 `response`，`payment_status` 固定为 `NOT_AVAILABLE` |
| `POST /access` | `{user_id,amount:1}` | 次数分支：`access_granted`、`requires_consumption`、`quota_unit`、`total`、`used`、`remaining`、`as_of_time` |
| `POST /consume` | `{user_id,idempotency_key,amount:1,reason}` | 直接返回 `Consumption` |
| `POST /consumption` | `{user_id,idempotency_key}` | 直接返回 `Consumption`，没有 `response` 包装 |

`Consumption` 必有 `status: SUCCEEDED/FAILED/PROCESSING/UNKNOWN`、`confirmed`、`idempotency_key`；正常业务响应还可有 `consume_status`、`consume_order_id`、`consume_reason`、`quota_unit`、`consumed`、`remaining`、`reason_code`、`update_time`。处理以平台 `status` 和 `confirmed` 为准。`consume_order_id` 是消费流水号，不是支付交易号；`remaining` 是该次成功核销后的历史余额，实时余额另查 `/access`。

### 身份和参数

- `user_id` 来自当前应用服务端已认证账号的稳定内部 ID，购买、查询、核销始终相同；不使用昵称、时间戳或每次随机生成的身份。Key 只访问所属项目，不要求以支付宝买家账号代替应用账号。
- `user_id` 与 `idempotency_key` 均为 1–128 字符，无首尾空白；业务编号在项目内唯一，先持久化再请求。
- `consume.amount` 必须是 JSON 整数；`COUNT` 固定为 `1`，`POINT` 允许 `1–99999999`。本项目使用 `COUNT`。
- `reason` 为 1–256 字符的非空白简短服务说明，由服务端保存且重试不变；不放隐私、完整提示词或 JSON。
- `callback_url` 是页面返回地址，不是支付通知；HTTPS、无账号信息，主机和端口须与项目官网一致，最多 512 字节。
- 次数模式的 `/access` 不要求 `decision=ALLOW`；`decision` 属于买断/时长模式。次数余额充足仍不代表已经核销。

## 9.90 元固定卡的映射

应用交付一张包含“文案 10、图片 15、视频 2”的自有额度卡。对一人付而言，该卡整体对应 **1 次权益**：购买增加 1 次，领卡正式核销 1 次。`10+15+2=27` 是应用内额度构成，不是本次一人付核销量。

服务端从真实 `/product` 的 `charging_options` 选定固定 SKU，至少验证：

```text
product.capability_status = ENABLED（新增购买时）
product.billing_mode = QUANTITY
product.quota_unit = COUNT
charging_option.sku_id = 服务端配置的固定 SKU
charging_option.billing_mode = QUANTITY
charging_option.entitlement_rule = QUOTA
charging_option.quota_unit = COUNT
charging_option.quota_amount = 1
charging_option.currency = CNY
charging_option.price = 9.90 元（按十进制金额精确比较）
```

`price` 是以元计的十进制字符串；`quota_amount` 是购买增加的数量。`plan_id` 和 `price_version` 用于展示或记录，不是购买参数。金额、数量和 SKU 不接受前端任意改写；创建购买时显式传入已核实的 `sku_id`。不传 SKU 或传空字符串会由顾客在支付宝选套餐。价格和套餐在支付宝配置，本接口不能提交自定义价格。

当前公开契约仅支持支付宝；`purchase` 没有 `channel` 参数，也不接收 `price/plan_id/price_version`。JSON 多余字段可返回 `400 INVALID_ARGUMENT`，不能自行增加付款渠道字段。

## 核销和交付恢复

1. 请求前保存用户、业务操作 ID、一人付幂等编号、数量、单位、原因和交付意图；应用对用户与操作、核销编号、交付回执分别保证唯一。
2. `/access` 只判断当前是否有足够权益。`purchase.status=READY`、扫码、页面回跳、余额增加均不是某笔支付成交凭证。
3. 发起或恢复 `/consume` 始终使用原编号和全部原参数。只有同时满足以下条件才交付：

   ```text
   status === "SUCCEEDED"
   confirmed === true
   idempotency_key === 保存的原核销编号
   consumed === 1
   quota_unit === "COUNT"
   ```

4. 网络超时、进程重启、`UNKNOWN` 或 `PROCESSING` 时不交付，先查询原 `/consumption`。该接口只查询，不新建扣减；查询失败时可按保存的同号原参数恢复 `/consume`，不得换号重扣。
5. `/consumption` 的 `404 NOT_FOUND` 表示本项目未找到原请求；不证明上游一定未扣减。上游未找到或结果未知仍可能为 `UNKNOWN`。核销用户、数量或原因改变会出现 `409 IDEMPOTENCY_CONFLICT`；其他错误不能靠更换编号绕过。
6. 已确认核销而本地交付失败，只恢复原交付。发卡和唯一回执应在同一数据库事务提交；外部服务使用唯一 outbox/任务号。只有明确失败才允许开始新的业务操作。

购买也保存原意图：同号变更用户、SKU 或返回地址可产生 `409 IDEMPOTENCY_CONFLICT`；旧入口过期可产生 `409 PURCHASE_ENTRY_EXPIRED`，确认失效后才为新的购买意图生成新号。`/purchase/query` 只是本地入口记录，不查询逐笔付款。

## 聚合权益与单 SKU 边界

OpenAPI 将 `access.total` 定义为当前有效发放额度的聚合总量。`/access` 和 `/consume` 都没有 SKU 参数，接口暴露的是所属项目内该用户的额度；不能反推本次核销来自哪个 SKU、哪笔订单或具体支付金额。

因此本固定卡方案应使用专用一人付项目，仅配置对应的 9.90 元、1 次 SKU，并核对是否存在历史或赠送余额。单 SKU 降低不同商品权益混用的风险，但不新增逐笔交易证明能力。界面和交付记录应准确表述“核销 1 次权益领取额度卡”，不能把购买请求记录改称已付款订单。

## 能力、退款与商品范围

公开能力文档列出购买入口、权益查询、核销及其记录、权益/核销通知；当前逐笔交易、交易列表、退款、退款查询和账单未开放，有效鉴权后对应入口返回 `501 CAPABILITY_NOT_AVAILABLE`。`automatic_renewal` 与 `consumption_reversal` 为未开放能力。`capabilities=true` 只表示入口已实现，正式配置、授权和项目状态仍需满足；本次没有商户运行时能力证据。

次数与积分核销没有自动撤销或自动返还。确认核销后的交付恢复不能重复扣减；退款和失败补偿需走相应商户售后渠道。接口未开放退款不等于商户可一律拒绝退款，参见[支付信息说明](https://ai6666.com/opcpay/payment-info/)与[服务协议第 10–11 节](https://ai6666.com/terms/)（协议更新日期 2026-11-03）。

公开接入文档允许在核销确认后交付对应业务，示例交付报告；此次没有找到专门批准“1 次权益兑换自有卡密”的明确文字，也未发现该模式被明确禁止。通用业务交付契约可作为技术实现依据，不能据此声称平台已批准该商品。正式上线前，商户仍需确认其已授权商品范围、真实套餐、交付说明和售后安排。

## 复核方法与尚未验证项

以下命令仅查询公开来源，不需要商户凭证：

```powershell
git ls-remote https://github.com/Yapie0/opcpay.git refs/heads/main
$contract = Invoke-RestMethod 'https://ai6666.com/opcpay/api/v1/pay/developer/openapi.json'
$contract.info
$contract.servers
$contract.paths.'/consume'.post
$contract.paths.'/consumption'.post
```

后续复核应对比新的提交与 OpenAPI，不能假设本文永远代表当前行为。真实项目的 `/capabilities`、`/product`、9.90 元 SKU、基址可用性、购买到账、真实核销、卡密交付及售后均尚未由此次只读研究验证。模拟测试结果不能替代这些生产证据。
