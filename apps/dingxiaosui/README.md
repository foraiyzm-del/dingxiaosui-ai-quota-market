# 丁小穗应用源码

农业品牌与农品营销创作平台，包含 Next.js 服务、静态工作台、文案与知识库、图片／图生图、异步视频、作品空间及原体验卡。已增加根目录发卡中心 QTA 卡接入，支持三类次数自由组合。

建议按 [仓库根 README](../../README.md) 使用双站启动入口。

## 单独安装与构建

```sh
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npm run build
npm start
```

统一要求 Node.js 24+。`npm start` 启动 8845 本地活动版；不读取生产环境账号、不会发卡或生成内容。未通过根目录双站脚本启动时，需要自行给服务端注入 `QUOTA_CENTER_URL`、`QUOTA_PLATFORM_KEY`、`SHOP_PRODUCT_URL`，才能连接发卡网。示例见 `.env.example`；启动脚本不自动加载它。

首次运行创建 `.local-event-runtime/`。管理员设置链接位于 `.local-event-runtime/data/admin-setup.txt`。数据库、主密钥与本机账号不在 Git 仓库中。

## 代码地图

| 目录／文件 | 用途 |
| --- | --- |
| `index.html` / `landing.html` / 根 JS 与 CSS | 工作台／官网静态源文件 |
| `app/`、`components/`、`hooks/` | Next 页面和 API |
| `lib/` | 业务规则、权限、知识库、模型、额度适配 |
| `db/`、`drizzle/` | 数据模型与追加式迁移 |
| `runtime/` | Node SQLite／文件存储、媒体恢复和可选短片合成源码 |
| `assets/`、`public/`、`vendor/` | 原始素材、发布资源和随附许可的样式 |
| `scripts/` | 构建、启动、迁移与隔离测试 |

页面应修改根静态源文件后重新构建；不要只改 public 中的生成副本，也不要删除 public 的独有资源。

QTA 卡与旧体验卡共存。新卡同码恢复原空间，三类次数由发卡中心维护；旧卡沿用原活动规则。真实生成费用由各自部署者的 API 服务商收取。

详见 [接入与故障说明](docs/quota-center-integration.md)、[第三方许可](THIRD_PARTY_NOTICES.md)。
