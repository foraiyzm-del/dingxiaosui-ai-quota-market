# 继续开发

先按 README 完成独立安装与构建。首次配置使用自己的密钥和数据库，示例套餐价格不作为正式报价。

## 代码边界

- `sidecar/quota.mjs` 负责次数账本；`commerce.mjs` 负责订单交付；`generation.mjs` 负责模型任务；`channels.mjs` 负责加密配置。修改时保持清晰职责。
- 新能力必须进入服务端校验、幂等哈希和权限校验。模型、渠道、价格及扣次规则不能信任浏览器提交值。
- 丁小穗 `lib/quota-center.ts` 处理新卡身份与中心客户端，`lib/quota-generation.ts` 处理生成适配；`ai.ts`、`media-jobs.ts` 保留原业务流程。
- 丁小穗根目录 HTML/JS/CSS 是静态源；`build-static.mjs` 和 `scripts/sync-public.mjs` 同步到 public。部分 public 文件为独有资源，不要清空整个 public。
- `apps/dingxiaosui/runtime/` 是业务源码，不是生成目录。

## 常用验证

根目录：

```sh
npm test
npm run check
node scripts/test-dingxiaosui-integration.mjs
```

丁小穗目录（先安装依赖）：

```sh
node scripts/test-quota-center-identity.mjs
node scripts/test-quota-generation.mjs
node scripts/test-event-sessions.mjs
node scripts/test-event-auth.mjs
npm run build
node scripts/test-event-direct-http.mjs
```

HTTP 回归需构建，原体验卡完整回归使用 8847 端口。浏览器检查需要 Playwright 的 Chromium 或通过 `CHROME_PATH` 提供 Chrome 路径，具体以对应脚本为准。

测试应验证越权访问、重复请求、首次兑换响应丢失、并发余额、明确失败与未知结果的区别、异步任务重启恢复，以及新旧卡兼容。不要把模拟模型输出当成真实模型质量证明。

## 数据与提交流程

新建分支，提交范围明确的修改，并说明问题、行为变化和验证命令。不要提交 `.env`、`local/`、数据库、完整卡密、真实订单、生产日志或媒体用户数据。许可证和第三方声明必须保留。数据库变化使用新的迁移，不能直接重置旧库。

更换支付商户、公开部署、真实 API 调用与模型花费由各自部署者控制。安装、构建、核心测试与本地启动不应自动触发真实付款或收费生成。
