# Release Candidate 检查清单

本清单对应应用代码基线 `d49ec64`，数据库迁移版本 `0008_service_workflows.sql`。检查日期为 2026-09-12。

## 已完成

- [x] 依赖安装、敏感信息扫描、API schema 同步、lint、TypeScript 类型检查与 Vite 正式构建通过。
- [x] D1 迁移、校园/宿舍/站点 seed、密码哈希 Workers runtime、学生与管理员权限测试通过。
- [x] 报价矩阵、活动订单去重、重复支付、非法状态转换、订单归属与管理员scope越权测试通过。
- [x] 注册、寝室、取件码登记、小件到寝3元报价、模拟支付、市场接单、取件、配送、学生签收、售后及模拟打赏闭环通过。
- [x] 站内消息、多轮退单历史、售后状态机、批量取件码全有或全无权限与脱敏审计通过。
- [x] 管理员任务分类、异常草稿取消、退单理由必填、本页一键全选/清空通过。
- [x] 学生首页最近3件折叠、更多/收起、移除后即时消失及刷新保持通过。
- [x] 360px 学生视口、桌面管理员视口、登录后刷新保持、退出后401及切换账号路径通过。
- [x] Cloudflare 与 Netlify 健康接口、静态路由、同域API和跨站共享后端闭环通过；临时验收身份和业务数据已删除，审计记录保留。
- [x] GitHub Actions 对应用代码基线执行 verify 与高危依赖审计并通过。

## 生产发布记录

- Cloudflare：`https://campusdrop-qust-laoshan-production.esthertreu3724.workers.dev`
- Cloudflare Worker 版本：`ff1b3c13-1446-46fc-99ff-e444ebdf57f2`
- Netlify：`https://campusdrop-qust-laoshan.netlify.app`
- Netlify deploy：`6aa50f45aebd83aa65d67335`
- GitHub 开源快照：`https://github.com/autumnnmutua/campusdrop-qust-laoshan-open-source`

## 上线边界

- 当前支付、退款和打赏只记录 MOCK 成功状态，不发生真实资金流转。
- 站内消息需要用户进入网站查看，没有短信、微信订阅消息或系统推送。
- 管理员批量取件信息只在页面临时展示，不提供导出；无法阻止已经看到信息的人员截图。
- Netlify 是同一 Workers/D1 后端的镜像入口，不是独立数据库或灾备写入节点。上游不可用时 Netlify 业务API也会不可用。
- 生产运营前仍需补充真实运营主体、隐私政策、用户协议、投诉渠道、数据保留期限和支付资质；源码中的学校名称不代表学校授权。
