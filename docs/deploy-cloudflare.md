# Cloudflare 后端部署

1. 使用 Node.js 22.12以上或24，执行 `npm install --include=dev`。
2. 使用自己的Cloudflare账户登录Wrangler，创建D1数据库。
3. 当前 `wrangler.jsonc` 的 production 环境已指向现有主站与 D1 数据库。部署到其他账户时，必须替换为自己的数据库 ID 与实际 APP_ORIGIN；staging 仍是占位配置。
4. 先用 `npx wrangler d1 migrations list DB --remote --env production --config wrangler.jsonc` 检查是否有待应用的迁移。有新迁移时先备份已有数据，再执行 `npm run db:migrate:production`；v1.1.0 没有数据库结构变更。
5. 执行 `npm run deploy` 构建并部署；Worker名称必须与配置一致。

使用本地环境时执行 `npm run db:migrate`、`npm run dev`。开发数据库与生产数据库隔离。

初始化管理员使用 `npm run admin:bootstrap`，通过本机环境变量提供CAMPUSDROP_ADMIN_USERNAME和CAMPUSDROP_ADMIN_PASSWORD；远端初始化参数为 `--remote-production`。密码至少12字符，脚本不会覆盖已有管理员。不要在文档或仓库中写入密码。

密码哈希采用scrypt，需要nodejs_compat。会话使用随机令牌，数据库保存摘要；Web接口校验精确Origin。账号/订单与CloudBase静态前端通过同域桥接时仍由此后端维护。

wrangler配置启用Workers日志及低比例追踪，并使用redact_query_string移除平台日志中的查询串。应用错误只记录脱敏路由、固定分类、HTTP状态和问题编号，不记录请求正文、Cookie、密码、取件码或工单内容。

生产配置模板不能包含真实Secret、默认弱密码或开发数据库。正式业务仅启用经运营确认的功能，当前支付提供程序不产生真实资金流转。
