# Cloudflare 后端部署

1. 使用 Node.js 22.12以上或24，执行 `npm install --include=dev`。
2. 使用自己的Cloudflare账户登录Wrangler，创建D1数据库。
3. 在wrangler.jsonc的production环境填入数据库ID及实际APP_ORIGIN；当前值为公开占位配置，不能直接发布。
4. 执行 `npm run db:migrate:production` 应用迁移。首次部署初始化空库，已有数据则先备份。从 v1.x 升级到 v2.0 需要应用新增的 `0009_engagement.sql`（只新建表，不修改已有数据）。升级到 v2.6 必须应用 `0010_live_campus.sql`（新增列、表和触发器），否则新版订单查询会失败。升级到 v2.7 必须应用 `0011_campus_operations.sql`（新增列、表、索引和触发器，并重建站内消息触发器），否则下单和订单查询会失败。
5. 执行 `npm run deploy` 构建并部署；Worker名称必须与配置一致。

使用本地环境时执行 `npm run db:migrate`、`npm run dev`。开发数据库与生产数据库隔离。

初始化管理员使用 `npm run admin:bootstrap`，通过本机环境变量提供CAMPUSDROP_ADMIN_USERNAME和CAMPUSDROP_ADMIN_PASSWORD；远端初始化参数为 `--remote-production`。密码至少12字符，脚本不会覆盖已有管理员。不要在文档或仓库中写入密码。

密码哈希采用scrypt，需要nodejs_compat。会话使用随机令牌，数据库保存摘要；Web接口校验精确Origin。账号/订单与CloudBase静态前端通过同域桥接时仍由此后端维护。

wrangler配置启用Workers日志及低比例追踪，并使用redact_query_string移除平台日志中的查询串。应用错误只记录脱敏路由、固定分类、HTTP状态和问题编号，不记录请求正文、Cookie、密码、取件码或工单内容。

生产配置模板不能包含真实Secret、默认弱密码或开发数据库。正式业务仅启用经运营确认的功能，当前支付提供程序不产生真实资金流转。

## v2.7：定时任务、照片与运营设置

- **定时任务**：`triggers.crons` 为 `["*/10 * * * *"]`（production、staging 环境各一份；本地开发不会自动按计划触发）。这个触发器每 10 分钟运行 `frequentJobs`（超时未付款订单、包裹等待提醒、滞留订单群通知、常用配送规则和天气刷新），并在北京时间 11:20 同时执行每日清理。保留对旧每日触发器的兼容；清理时间从原来的 11:17 调整至 11:20。这样每个环境只占用一个触发器，适配 Cloudflare 免费套餐每账户最多 5 个的限制。
- **送达照片**：`PUT /api/v1/admin/orders/:id/photo` 接收原始图片正文（`image/jpeg` 或 `image/webp`，≤200 KB，校验文件头），存入 D1 `delivery_photos`；读取接口以 data URL 返回，符合 `img-src 'self' data:`。CloudBase / Netlify 代理只转发 JSON（8 KB 上限），照片功能仅在直接访问 Worker 时可用。照片 30 天后由每日任务删除。
- **只读进度链接**：`GET /api/v1/track/:token`，32 位十六进制令牌，按 IP 限流，响应不含姓名、电话、房间号和取件码；订单结束一天后失效。管理端接口不返回令牌。
- **运营设置**：`app_settings` 表保存暂停接单、群机器人和按排班计算名额三项，只有超级管理员可写，写入记审计日志。群机器人地址只允许 `qyapi.weixin.qq.com`、`open.feishu.cn`、`open.larksuite.com`，读取时脱敏；同一事件按 `webhook_log` 去重，只发一次。
- **实时通道断开**：退出登录或停用管理员时，向该用户频道发布 `bye`，`LiveHub` 以 4001 关闭连接，前端不再重连。

## v2.6：实时通道、推送与地图

- **Durable Object**：`wrangler.jsonc` 顶层与 production / staging 环境都声明了 `LIVE → LiveHub` 绑定（Durable Object 绑定不会被环境继承，所以每个环境各写一份），迁移标签 `v1-live-hub` 使用 `new_sqlite_classes`，免费套餐可用。部署时自动创建，无需手动操作。未绑定时 `/api/v1/live` 返回 503，前端自动改为轮询。
- **WebSocket 鉴权**：`/api/v1/live`（学生）与 `/api/v1/admin/live`（管理员）要求 `Origin` 与 `APP_ORIGIN` 完全一致并校验会话 Cookie；每个用户一个频道，最多 12 个并发连接。事件只包含订单 ID 和类型。
- **扇出机制**：数据库触发器为每个面向学生的变化写入 `inbox_messages`；写请求开始前记录收件箱水位，成功响应后在 `ctx.waitUntil` 中用 `UPDATE … SET pushed_at … RETURNING` 认领新行，再发布到实时通道并（非学生本人操作时）发送 Web Push。
- **Web Push 密钥**：`npm run push:keys` 生成 P-256 密钥对；以 Secret 方式设置 `VAPID_PUBLIC_KEY`（base64url 原始 65 字节公钥）、`VAPID_PRIVATE_KEY`（base64url 私钥 d）、`VAPID_SUBJECT`（`mailto:` 或站点地址）。本地开发写入 `.dev.vars`。推送端点只允许各浏览器官方推送服务域名，防止被当作开放转发。
- **收货码**：只在学生自己的订单详情接口返回；配送员核验接口按订单限流（15 分钟 6 次），一次批处理完成送达与签收，并写入 `handoff_verified_at`。重建的 `student_receipt_guard` 触发器只允许“学生本人”或“已核验收货码的管理员”把订单置为完成。
- **地图校准**：`map_calibration` 只由超级管理员通过 `PUT /api/v1/admin/map-calibration` 写入，并记录审计日志。未校准时服务端不投影任何 GPS 坐标。
- **代理部署**：CloudBase 云函数、Netlify Functions 只做 HTTP 转发，无法升级 WebSocket；功能完整，实时性退回为 20 秒轮询。

