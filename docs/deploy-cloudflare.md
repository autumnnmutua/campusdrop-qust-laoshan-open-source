# Cloudflare 后端部署

1. 使用 Node.js 22.12以上或24，执行 `npm install --include=dev`。
2. 使用自己的Cloudflare账户登录Wrangler，创建D1数据库。
3. 在wrangler.jsonc的production环境填入数据库ID及实际APP_ORIGIN；当前值为公开占位配置，不能直接发布。
4. 执行 `npm run db:migrate:production` 应用迁移。首次部署初始化空库，已有数据则先备份。
5. 执行 `npm run deploy` 构建并部署；Worker名称必须与配置一致。

使用本地环境时执行 `npm run db:migrate`、`npm run dev`。开发数据库与生产数据库隔离。

初始化管理员使用 `npm run admin:bootstrap`，通过本机环境变量提供CAMPUSDROP_ADMIN_USERNAME和CAMPUSDROP_ADMIN_PASSWORD；远端初始化参数为 `--remote-production`。密码至少12字符，脚本不会覆盖已有管理员。不要在文档或仓库中写入密码。

密码哈希采用scrypt，需要nodejs_compat。会话使用随机令牌，数据库保存摘要；Web接口校验精确Origin。账号/订单与CloudBase静态前端通过同域桥接时仍由此后端维护。

wrangler配置启用Workers日志及低比例追踪，并使用redact_query_string移除平台日志中的查询串。应用错误只记录脱敏路由、固定分类、HTTP状态和问题编号，不记录请求正文、Cookie、密码、取件码或工单内容。

生产配置模板不能包含真实Secret、默认弱密码或开发数据库。正式业务仅启用经运营确认的功能，当前支付提供程序不产生真实资金流转。
