# APIMart 接入说明

核实日期：2026-10-29。本文描述本项目已实现的映射，公开价格仅作测试预算参考，真实账户扣费以 APIMart 消费日志为准。

## 后台配置

- 协议：`apimart`
- 接口地址：`https://api.apimart.ai/v1`
- 密钥：仅填写到本机后台，数据库加密存储。
- 文案：`deepseek-v4.1-flash`（领导体验卡这一批改为 `claude-sonnet-5-5`，失败时可降到 deepseek）
- 图片：`gpt-image-2.5-flare`
- 视频：`seedance-2.0-mini`（领导体验卡这一批改为 `seedance-2.5`，720p、默认 5 秒、无声；失败时可降到 `seedance-2.0` 720p）

领导体验卡的模型写在该批次的卡密上，不会替换上面这套全站默认。`seedance-2.5` 仍走 `POST /v1/videos/generations`，用 `duration`、`resolution`、`size`、`generate_audio`，返回 `data[0].task_id`，再用 `GET /v1/tasks/{task_id}` 查询。它默认带声、默认 720p，所以无声和本次选择的时长必须显式传；未选时长时沿用卡密默认值。

使用已有密钥时，还须确保密钥的模型限制允许以上模型。保存配置本身不会发起模型调用。

## 请求与任务

| 能力 | 提交地址 | 处理方式 |
| --- | --- | --- |
| 文案 | `POST /v1/chat/completions` | OpenAI 兼容非流式响应，取 `choices[0].message.content` |
| 图片 | `POST /v1/images/generations` | 从 `data[0].task_id` 读取任务号 |
| 视频 | `POST /v1/videos/generations` | 从 `data[0].task_id` 读取任务号 |
| 图片、视频结果 | `GET /v1/tasks/{task_id}` | `data.status` 和 `data.result.images[].url[]` / `data.result.videos[].url[]` |

任务提交后只预留相应次数，成功时扣次，明确失败时退回。重复请求不会重新发起 POST；服务重启后继续查询已保存的任务号。图片与视频均支持后台轮询。响应不明确时保留预留额度供人工核对，不会自动重复消费上游额度。

视频下载从结果中的 CDN 地址获取，不向 CDN 发送 APIMart API 密钥。原有地址/DNS 校验、大小限制和拒绝重定向的保护继续生效。

## 当前明确的默认规格

为避免上游自动选择昂贵规格，三个测试模型使用明确参数：

- 文案：非流式，`max_tokens: 1024`。`deepseek-v4.1-flash` 默认会先做高强度推理，请求里显式带 `reasoning_effort: "none"` 和 `thinking: { type: "disabled" }`，避免正文出来前先耗掉几十秒和大量推理 token。`claude-sonnet-5-5` 不使用带 `-thinking` 的模型名，也不打开 extended thinking，只带 `reasoning_effort: "none"`，避免网关自行打开长推理。推理 token 若出现在用量里，按输出单价计入估算。
- GPT Image 2.5：每次一张，`size: "1:1"`、`resolution: "1k"`、`quality: "low"`，即 1024 × 1024 方图。
- Seedance 2.0：`duration: 5`、`resolution: "480p"`、`size: "16:9"`、`generate_audio: false`。

这些规格位于 `sidecar/apimart.mjs`。没有商品规格时，调用方指定的合法 `size`、`aspectRatio` 或视频 `seconds` 仍会覆盖对应参数。自 2026-11-06 起，已接入的 APIMart Seedance 2.0 / mini / fast / 2.5 可选择 5、10、15 秒。卡密保存的时长是默认值；已有领导卡无需重发。模型、分辨率和声音仍由卡片及平台控制，浏览器只能选择允许的时长，每次成功仍扣 1 次视频。旧体验卡默认 15 秒、720p、有声，也可选择 5 或 10 秒。其他渠道仍只在丁小穗提供原默认时长。

丁小穗文案使用 `messages` 保留业务提示词与知识库，JSON 模式，并按任务传输出长度（主对话 3500 tokens）。图生图先在服务端将不超过 6 MiB 的有效 PNG/JPEG/WebP 上传至 `/v1/uploads/images`，再用 `image_urls` 生成。图片与视频可通过受保护的中心内容接口下载到丁小穗。尚未实现所有模型的多模态参考和高级参数表单。

延长视频会增加供应商成本。内置 Seedance 2.5 参考价格明确按 5 秒计，估算随所选时长换算；已有渠道的自定义每请求价格没有时长基准，非默认时长显示未定价，避免误算。领导卡整批成本工具仍按卡片默认 5 秒估算，不能直接作为全部生成 15 秒的预算。

发布本次改动时需同时更新发卡中心与丁小穗，先发布中心（新增 `/api/v1/generation-options`）。新丁小穗读取该接口失败时暂不开放视频提交，图片仍可使用。

## 公开报价参考

APIMart 页面以约 **10 credits = 1 美元** 展示。

- Seedance 2.0 Mini，480P、无参考视频，公开 Gold 价为 0.1815 credits/秒，5 秒约 0.9075 credits。实际按最终输出结算。
- GPT Image 2.5 low 方图，官方文档给出的 196 个输出 token 费用为 0.00588 美元，另加提示词输入费用；实际账户折扣另算。
- DeepSeek V4.1 Flash，公开峰时展示输入约 0.2286 美元/百万 token、输出约 0.9143 美元/百万 token；非峰时和会员可能不同。

因此一张图、三次短文案和一段 5 秒视频的公开参考成本约 1 credit；不能将其当作严格报价或已授权消费上限。

## 官方来源

- [非流式文本接口](https://docs.apimart.ai/en/api-reference/texts/general/chat-completions-nostream.md)
- [GPT Image 2.5 请求参数及价格说明](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation.md)
- [Seedance 2.0 请求参数](https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md)
- [统一任务查询接口](https://docs.apimart.ai/en/api-reference/tasks/status.md)
- [Seedance 2.0 Mini 价格页](https://apimart.ai/zh/model/doubao-seedance-2-0-mini)
- [DeepSeek 模型价格页](https://apimart.ai/model/llm/deepseek)

适配器验证使用隔离 SQLite 内存库与模拟 HTTP 返回；真实 API 调用由实际账户联调单独记录，模拟通过不等于真实模型已生成成功。
