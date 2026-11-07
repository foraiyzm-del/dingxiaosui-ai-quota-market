# 独立发卡与额度平台

这是一份可独立安装和运行的发卡中心源码。商城、后台、订单、库存、平台凭证、文案／图片／视频次数账本和模型路由均在本包中；不需要丁小穗源码，也不需要构建 Next.js。

目前只有**丁小穗完成业务应用适配**。其他项目可以按同一服务端协议接入，但新增项目、创建商品或运行多项目模拟，不等于这些项目已经完成登录、作品保存和正式业务验收。原开发副本已完成用户确认实付 9.90 元、真实权益核销、发卡及丁小穗激活验收；随后按用户要求将原账本、商户配置和项目凭证迁入**本机独立商城 3399**，随后又开放周卡、月卡，当前状态见下段。商城按用户最新要求只留丁小穗、一二大模型、酒擎、红帆党建四个入口，后三者暂未开放购买；营销文案、包装设计两个无业务的示例平台及商品已移除。本轮迁移未再次付款或核销，模型仍使用本地模拟。最新记录见 [独立商城支付接通验收](docs/standalone-payment-connected-20261107.md)，先前实付证据见 [真实支付与交付验收](docs/opcpay-live-acceptance-20261107.md)。

商城显示尝鲜卡、周卡、月卡（主推）、旺季卡及自由组合。本机 3399 已开放三档支付宝入口：尝鲜卡 9.90 元（10/15/2）、周卡 29.90 元（30/45/6）、月卡 99.00 元（100/150/20），分别绑定已只读核对的专用收款项目，每次核销 COUNT 1 兑换一张卡。周/月模拟发卡、激活通过，真实付款尚未验收；旺季卡为预览，自由组合单价待配置。三档隔离模拟运行 `node scripts/start-opcpay-packages-demo.mjs`，详情见上述最新验收记录。

## 安装和启动

使用 Node.js 24+。以下安装步骤用于新导出的源码目录；源码导出不含任何私密配置、交易数据或商户 Key：

```sh
npm ci
npm test
npm run check
npm start
```

不需要 `apps/`、pnpm 或丁小穗构建。`package.json` 与 `package-lock.json` 按原字节保留，包名和版本没有因导出改写。

新导出目录默认商城为 `http://127.0.0.1:3199/`，后台为 `/admin`。首次启动生成本目录自己的 `local/config.json`、`local/center.sqlite` 和 `local/ACCESS.md`；管理员凭证在 `local/ACCESS.md`，由部署者在本机查看。空白源码安装不会自动具备商户支付或收费模型配置。

本机已配置实例为 `E:\codex\quota-market-standalone`，地址 `http://127.0.0.1:3399/`。它已接收授权的本地实付测试数据，继续运行时直接在该目录执行 `npm start`，保留现有 `local/`，不要重新初始化或用新导出覆盖。`localModelMock:true` 保持模型模拟；尝鲜卡、周卡与月卡使用各自真实一人付配置，周/月尚未实付验收。服务已运行时不重复启动。

丁小穗作为独立业务应用运行于 `http://127.0.0.1:8945/workbench.html`，由完整仓库执行 `node scripts/start-dingxiaosui-attached.mjs` 连接 3399，沿用原应用数据和构建快照。旧 3499 联调中心已停止，并由 `MIGRATED.json` 阻止重新启动；应用启动器不在本源码包中。

目录中的 `local/` 属于本次部署的私有数据，不随源码包导出。换端口可先运行 `node scripts/setup.mjs`，在本机配置中修改 `port` 后再 `npm start`；不要覆盖已经运行的另一套服务。停止服务使用 Ctrl+C。

本地多项目模拟入口为：

```sh
node scripts/start-multiproject-demo.mjs
```

它使用单独的模拟数据和默认 3299 端口；具体演示商品与操作见 [独立平台接入说明](docs/standalone-integration.md)。模拟项目仅用于证明隔离下单、发卡和扣次，不代表新的外部项目已经接入。

## 接入一个新项目

1. 在「API 渠道」配置自己的服务端渠道、协议和模型；在「业务平台」新建稳定且唯一的项目标识，例如 `new-project`，绑定其文案、图片、视频能力，并填写该项目的真实业务网址。
2. 在「商品套餐」为该项目创建商品和分项套餐，如 `quota: {text:10,image:15,video:2}`。`units` 总数只是摘要，三种额度不能互换。可选择库存交付，或在核实付款后按订单快照签发一张卡。
3. 让客户从本商城选择该项目商品并下单。订单及卡绑定自己的项目；支付入口、人工到账核验和后台交付使用中心自己的配置。
4. 在「业务平台 → 接入凭证」取得该项目的服务端凭证，只保存在新项目后端。新项目从已认证会话取得稳定用户身份，然后调用兑换、余额和生成接口。
5. 新项目自己负责登录、作品归属、结果持久化和重启恢复。上线前验证跨用户／跨项目隔离、同号重试、余额不足、明确失败和结果未知等分支。

服务端接入示例：

```js
import { createUsageClient } from './sdk/client.mjs';

const usage = createUsageClient({
  baseUrl: process.env.QUOTA_CENTER_URL,
  apiKey: process.env.QUOTA_PLATFORM_KEY,
});

// userId 由后端已验证的登录会话确定；不采用浏览器传入的任意账号。
await usage.redeem({ userId, code: submittedCode, idempotent: true });
const balance = await usage.balance(userId);
const job = await usage.generate({
  userId,
  requestId: persistedRequestId,
  capability: 'image',
  prompt: confirmedPrompt,
});
```

`requestId` 必须先保存在业务数据库，重试保持同号和相同内容。`generate` 负责预留和结算，外层不要再扣一次。图片／视频可能经历 `running → ready → succeeded`；保存 `job.id` 后查询原任务，将最终媒体保存到该项目自己的受控存储，再由后端调用 `usage.deliver({id:job.id,userId,action:'accept'})` 确认同一结果并结算。

若新项目已有复杂模型流程，可使用 `reserve → commit/cancel`，并在 `reserve` 明确传 `capability`。成功且结果已持久化才 `commit`；只有明确失败才 `cancel`；超时或结果未知继续核对原任务，不能先返还再重新生成。完整接口、权限和错误状态见 [中心 API 与 SDK](docs/integration.md)，APIMart 映射见 [协议适配说明](docs/apimart-integration.md)。

## 保留的丁小穗固定权益卡

通用商城不需要开启 OPcPay。包内保留现有 `/opcpay` 固定入口、服务端恢复逻辑、私密配置模板和只读探针；只有明确启用配置时才展示相应入口。

该入口只支持上述三档丁小穗固定卡，周/月分别通过 `/opcpay?package=week`、`/opcpay?package=month` 进入。三档分别核销各自项目 1 次权益，交付自己的套餐快照。它没有自动扩展为所有项目的通用 OPcPay 商品。权益核销交付记录也不计入现金营收。

`node scripts/setup-opcpay.mjs` 只准备本机私密模板，`node scripts/probe-opcpay.mjs` 只核对真实商户能力和套餐；使用前需由部署者配置自己的项目、固定商品和凭证。新导出的源码包不包含任何商户 Key，也不包含需要丁小穗源码的应用启动脚本。本机 3399 实例的配置与原 3499 实付账本是在用户授权后单独迁入的私有运行状态，不属于源码导出。原卡及 10／15／2 额度已在迁移后的页面验证，未另建付款或再次核销；新部署仍需自行配置并验收。用户已确认该专用项目可交付自有卡、退款经官方客服人工处理，但未实际办理退款。协议边界见 [OPcPay 契约记录](docs/opcpay-provider-contract.md)。

## 导出规则与测试范围

在完整仓库中显式指定一个**不存在**的目标目录，其父目录需已存在：

```sh
node scripts/export-standalone.mjs --dest /path/to/new-quota-center
```

Windows 示例：

```powershell
node scripts/export-standalone.mjs --dest E:\codex\new-quota-center
```

工具只复制经过逐文件审查的清单，不覆盖、不合并已有目录。来源路径中的符号链接或目录联接会被拒绝；未列入清单的文件即使使用 `.mjs` 或 `.png` 扩展名也不会复制。`apps/`、`local/`、数据库、密钥、环境配置、`node_modules/`、`.git/` 和 `artifacts/` 均不进入独立包。

`docs/standalone-export-manifest.json` 记录每个输出文件的来源、字节数、SHA-256、明确剔除项及缺失的可选文档。`docs/standalone-acceptance-20261107.md` 是可选验收说明：存在时导出，不存在时在 manifest 明确记录，不影响工具可用性。

导出前检查选中代码的相对模块引用和 `apps` 耦合。新增测试必须明确纳入或说明剔除原因，否则导出失败。独立包继续通过原 `npm test` 运行所有带入的测试，没有修改 npm 命令来掩盖失败。

以下 6 个文件因为依赖应用源码或其启动环境留在完整仓库，并没有在独立包中执行：

| 原测试文件 | 剔除原因 |
| --- | --- |
| `tests/dingxiaosui-attached.test.mjs` | 验证独立丁小穗应用快照、私有数据和子进程启动；对应应用启动器仅在完整仓库。 |
| `tests/demo-guards.test.mjs` | 同文件混合中心和丁小穗守卫，直接导入丁小穗 APIMart 协议；完整仓库继续验证。 |
| `tests/media-recovery.test.mjs` | 读取丁小穗媒体任务与恢复实现。 |
| `tests/static-build.test.mjs` | 执行丁小穗静态构建；同文件的一个健康检查小测试也随完整文件保留，不拆改原测试。 |
| `tests/studio-reference-selection.test.mjs` | 读取丁小穗 Studio 与参考图业务代码。 |
| `tests/upstream-body.test.mjs` | 比较中心与丁小穗 SSE/APIMart 实现；中心协议仍由独立生成测试覆盖。 |

其余带入的中心测试覆盖订单、库存、平台隔离、分项额度、幂等生成、渠道预算、支付签名与权益卡恢复。完整仓库的双系统集成和业务前端回归仍须在完整仓库单独运行，不能以独立包通过代替。

## 部署和许可

正式部署需要中心自己的域名、HTTPS、反向代理和支付配置；平台服务端与中心之间的地址必须可达。备份数据库时保留对应加密主密钥和凭证，建议使用 `node scripts/backup-sqlite.mjs` 做 SQLite 一致性备份。不得用模拟数据替换正式库。

[MIT 许可证](LICENSE)、[安全说明](SECURITY.md)和[原始第三方声明](THIRD_PARTY_NOTICES.md)原样保留。原始声明中 `apps/dingxiaosui/` 的第三方路径属于完整仓库，不代表那些应用文件包含在本独立包中。依赖由 `npm ci` 按锁文件安装，其许可证随各依赖保留。
