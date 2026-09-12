# CampusDrop

面向青岛科技大学崂山校区的开源校园包裹配送应用。采用 React、TypeScript 和 Vite，提供学生端与管理员工作台。

本项目由独立开发者维护，非青岛科技大学或菜鸟官方产品。学校名称用于说明适用校园，不代表官方授权。取件码由用户手动填写，不读取第三方物流账号。

## 在线访问

- Cloudflare Workers 主站：[campusdrop-qust-laoshan-production.esthertreu3724.workers.dev](https://campusdrop-qust-laoshan-production.esthertreu3724.workers.dev)
- Netlify 镜像站：[campusdrop-qust-laoshan.netlify.app](https://campusdrop-qust-laoshan.netlify.app)
- GitHub 开源仓库：[autumnnmutua/campusdrop-qust-laoshan-open-source](https://github.com/autumnnmutua/campusdrop-qust-laoshan-open-source)

两个站点使用同一套 Cloudflare Workers / D1 业务数据。Netlify 通过同域函数转发 API，因此登录 Cookie 属于 Netlify 自己的域名；账号与订单数据仍由同一后端校验和保存。

## 功能

- 学生账号、寝室资料与包裹登记。
- 服务端报价、配送订单、备注修改、取消及退款记录查询。
- 管理员角色授权、自行接单、批次管理、配送异常与双人交接核验。
- 站内消息、学生确认收货、售后工单与完整多轮退单记录。
- 管理员任务分类、本页一键全选、批量取件信息临时展示与敏感访问审计。
- 订单归属保护、会话刷新保持、退出及切换账号。
- 响应式界面、校园主题插画与移动浏览器兼容处理。

当前支付提供程序不发生真实扣款；支付、退款和打赏均为应用内流程记录。项目未接入微信支付或其他真实收费接口。

## 环境与开发

推荐 Node.js 22 LTS（22.12 或更高）或 Node.js 24，使用 npm。

```sh
npm install --include=dev
npm run build
npm run preview
```

构建产物为 `dist`，入口为 `dist/index.html`。本地静态开发使用 `npm run dev:static`；完整 Workers 开发使用 `npm run db:migrate` 后运行 `npm run dev`。仓库不预置用户或管理员密码，初始化管理员见部署文档。

## CloudBase GitHub 部署

| 字段 | 配置 |
| --- | --- |
| 根目录 | `.` |
| 框架 | Vite |
| Node.js | 22.12+ 或 24 |
| 安装命令 | `npm install --include=dev` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |

默认 `cloudbaserc.json` 声明静态应用，并包含 CloudBase CLI 必需的公开环境 ID `campusdrop-d6gtd6i0x85f66d2b`；不包含函数环境变量或云密钥。Fork 到其他环境时必须修改 `envId`。页面使用哈希路由，如 `/#/orders`，刷新不会请求不存在的静态目录。

**静态部署只发布前端。** 登录、订单和管理员功能需要同域 `/api/v1` 服务。仓库包含完整业务后端与可选 CloudBase API 桥接函数，详见 [CloudBase 部署](docs/deploy-cloudbase.md)。不得把 AI 网关地址作为订单接口。

## Netlify 部署

提供 netlify.toml 与同域API函数，静态界面调用已有业务后端。部署步骤见 [Netlify说明](docs/deploy-netlify.md)。

## 后端部署

- `src/worker` 与 `migrations`：Cloudflare Workers/D1 后端。
- `cloudbase/functions/campusdrop-api`：CloudBase 同域 API 桥接，不直接存储业务数据。
- `cloudbaserc.full.example.json`：完整资源部署示例，必须填写自己的环境ID、网站Origin和上游服务地址。
- `wrangler.jsonc`：公共模板，不含实际账户ID、数据库ID和运营域名。

现有数据库使用迁移增量更新，不应覆盖已应用迁移。部署前备份数据；不要将开发账户或密码写入生产seed。

## 消息、签收与售后

支持站内消息、学生确认收货、售后工单、管理员批量取件清单及完整多轮退单记录。流程与接口见 [服务流程](docs/service-workflows.md)。

## 可靠性与账号恢复

支持交接申请修改/驳回、一次性恢复码、服务端游标分页及管理员脱敏错误监控，详情见 [可靠性说明](docs/reliability.md)。写请求不自动重发，所有接口返回问题追踪编号。

## 维护

```sh
npm run lint
npm run typecheck
npm run api:check
npm run verify
```

GitHub Actions 负责代码检查和正式静态构建，不自动执行生产数据库变更。当前 main 源码树不包含测试账号、测试脚本或私有部署包；发布检查清单只记录公开的验证范围与平台版本，不包含凭据和测试数据。旧提交和已有标签仍保留历史内容。

## 许可与素材

项目源码采用 [MIT License](LICENSE)。第三方依赖遵循各自许可证。校园名称和第三方标识不因本项目许可证获得授权。当前校园主图为AI生成的艺术示意，不是真实校门摄影；使用前应自行确认应用场景和素材权利。

## CloudBase 自定义部署命令

如果平台日志显示直接执行 `tcb hosting deploy ./dist ...`，请在“版本配置”将自定义部署命令改为：

```sh
npm run deploy:cloudbase
```

该命令先安装锁定依赖（包含Vite），再构建并校验dist，最后调用平台已有tcb上传。任何一步失败立即停止。当前上传路径为 `/campusdrop`，与原应用一致；部署其他应用请修改cloudbaserc.json中的hosting.deployPath和envId。

不要继续使用旧的仅上传命令：它不读取配置中的buildCommand，也不会自动生成dist。修改仓库无法覆盖控制台保存的自定义命令，必须在平台改一次。若平台拆分安装/构建/部署三个步骤，则依次配置 npm ci --include=dev、npm run build 和原tcb上传命令。
