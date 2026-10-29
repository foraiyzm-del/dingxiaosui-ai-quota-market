# 历史工具与当前开发入口

公开仓库采用 Next.js standalone、Node.js SQLite 与本地媒体存储。当前 `package.json` 中的 `dev`、`build`、`start`、`build:local`、`start:local` 均使用 Next/Node 路径；运行方法以仓库根 README 和 `docs/quota-center-integration.md` 为准。

旧项目曾使用 Vinext、Cloudflare 和宿主提供的 Sites 构建绑定。对应的 `.openai/hosting.json`、`build/` 宿主插件和专用运行文件不在本次源码中，因此这条旧托管链路不是可直接运行的公开开发入口。为避免与 Next 自动发现冲突，公开副本不包含失效的 `vite.config.ts`。

以下保留脚本仅用于阅读原实现和迁移参考，不在当前 npm 启动或验收命令中，不能作为完整的 Cloudflare 部署方案直接运行：

- `scripts/run-framework.mjs`、`scripts/execution-profile.mjs`：旧框架及宿主执行环境选择。
- `scripts/init-tenancy-test.mjs`、`scripts/start-tenancy-test.mjs`、`scripts/prepare-tenancy-test.mjs`：依赖旧 Wrangler 构建与 D1 夹具的测试辅助工具。
- `scripts/start-ai-test.mjs`、`scripts/ai-test-upstream.mjs`：旧 Wrangler 模拟模型入口。
- `scripts/sites-env.*`、`scripts/install-ci.*` 等安装辅助工具：保留实现参考；当前依赖安装直接按根 README 使用锁定的 pnpm 版本。

公开副本还排除了两个缺少可选输入的离线脚本：`build-shanxi-map.mjs` 依赖未随原交接提供的 GeoJSON，`scripts/test-film-studio.mjs` 依赖未公开的内部 Codex 演示服务器。已经生成的静态地图、正式媒体业务模块和对应受支持的测试仍保留，不影响当前产品运行。

原始交接目录未作这些删除；以上整理仅作用于公开发布副本。没有更改锁定依赖、线上数据库或业务逻辑。
