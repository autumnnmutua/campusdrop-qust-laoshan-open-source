# Netlify 发布

Netlify发布静态界面与同域 `/api/*` 函数，业务数据由已有Workers/D1后端维护。不是复制数据库，也不在两个平台分别创建用户。

- 构建命令：npm run build；产物：dist。
- 函数目录：netlify/functions；API使用现代Request/Response处理方法。
- 函数环境变量：APP_ORIGIN为Netlify正式网站HTTPS origin，UPSTREAM_ORIGIN为业务Workers HTTPS origin。值在平台配置，不硬编码私人部署地址到源码。
- 登录Cookie通过同域API返回，保留Secure/HttpOnly/SameSite=Strict；不依赖第三方Cookie，不增加宽松CORS。
- API路由匹配优先于静态资源；函数验证实际Origin和请求大小后转发，不接收客户端指定的上游或凭据。
- Netlify静态版使用哈希路由，正式地址形如 /#/orders、/#/messages、/#/admin。根站点和函数应一起发布。
- 代理返回问题编号；不转发平台身份令牌和伪造的客户端IP。其余权限仍由后端实时校验。

本仓库仍支持独立Cloudflare构建，GitHub Actions检查默认静态构建。发布两个前端时先保证后端迁移完成，再验证两侧的登录、订单、消息、签收和工单。
