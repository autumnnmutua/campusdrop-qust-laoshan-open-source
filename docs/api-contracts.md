# 接口规范 API 契约

基址 `/api/v1`。当前是 Web Cookie 认证；微信 token/绑定接口尚未上线。输入 schema 来自 src/shared，`api-request-schemas.json` 由 `npm run api:generate` 生成，`npm run api:check` 纳入 verify，防止文档与代码结构漂移。自定义 Zod refine、数据库约束和权限不能仅用 JSON Schema 替代。

## 通用规则

- 写请求 JSON；Web 写请求 Origin 必须精确匹配部署 APP_ORIGIN。成功返回 JSON，错误返回 `{error:{code,message}}`。响应 no-store。
- 学生与管理员会话独立，主体始终从 session 解析，不接受客户端 userId/adminId 扩权。账号停用和管理员 scope 实时检查。
- 金额为整数分，时间为 Unix 秒。新升级：小件 100 分、大件 200 分。原大件已完成 100 分升级的历史订单不补扣差价。
- confirmedVersion 请求为 `{version: 当前订单版本整数, confirmed:true}`。缺失确认/额外字段返回 400；过时版本返回 409，客户端刷新并重新确认，不盲目重试修改。
- GET /orders 支持 page（默认 1）/pageSize（默认 100，上限 100），响应 `{orders,page,pageSize,hasMore}`。稳定按 createdAt DESC,id 排序；并发新增时 offset 分页可能移动，客户端按 id 去重。其他现有列表维持其原限制，不能误认为全量历史。
- 404 同时用于不存在和不属于当前用户的资源，防止枚举；401 为登录无效；403 为角色/Origin/自核验拒绝；409 为状态、版本或交接冲突；429 需按 Retry-After 等待。

## 学生订单操作（新客户端使用）

| 方法/路径 | 请求 schema | 成功响应 | 语义 |
|---|---|---|---|
| POST /orders/:id/cancel | confirmedVersion | `{order,refund}` | 未送达且无未完成实体交接才能取消；模拟退还实际付款和补款；订单保留 |
| GET /orders/:id/refund | 无 | `{refund:{amountFen,provider,status,createdAt?}}` | 有退款时 SUCCEEDED，无退款时 NONE；仅所有者，隐藏后仍可按 id 查询 |
| POST /orders/:id/hide | confirmedVersion | `{hidden:true}` | 仅终态/已送达订单可隐藏，不发起新退款；保留财务和审计 |
| PATCH /orders/:id/note | note | `{order}` | confirmedVersion + note，最多 120 字 |
| POST /orders/:id/upgrade | confirmedVersion | `{order,message}` | 后端按大小件算补款；重复成功不会再次收费 |
| POST /orders/:id/mock-pay | 无 | `{order,message}` | 首次模拟配送付款；重复幂等 |
| POST /orders/:id/tips/mock-pay | tip | `{payment,message}` | 完成后 MOCK 打赏；idempotencyKey 唯一 |

Order 新增 custodyState（NONE/STAFF/RETURNED/DELIVERED）、upgradeQuoteFen、pendingHandoff（待核验 id 或 null），保留 assigneePhone、serviceNotice、exceptionNote、refundableFen、upgradeFen、version 和快照字段。

退款由取消命令触发，GET refund 只读。当前无真实退款申请 API；未来真实支付引入异步退款时须独立版本演进，不能将 MOCK SUCCEEDED 当作微信资金到账。

旧客户端兼容：DELETE /orders/:id 保留旧“取消/退款/隐藏”组合操作，但同样受实体交接约束；无 body 的 POST cancel 仅允许取消未付款订单。新 Web 页面已使用显式 cancel/hide，取消后退款记录可查看。

## 管理员操作

| 方法/路径 | 请求 schema | 成功响应/语义 |
|---|---|---|
| PUT /admin/me/contact | adminContact | `{admin}`，只修改本人电话，不记录明文电话审计 |
| GET /admin/available | 无 | `{orders}`，最多 100 条，scope 过滤且不含电话、房间、备注、取件码 |
| POST /admin/orders/:id/claim | `{confirmed:true}` | `{batchId}`，并发仅一个接单者成功 |
| POST /admin/orders/:id/release | release | `{id,status:'WAITING_PICKUP',version,released:true}`；reason 必填、confirmed=true；退单后原配送员不能读详情 |
| GET /admin/orders/:id/handoffs | 无 | `{handoffs}`，仅当前订单授权者；包含位置、说明、申请人、核验状态 |
| POST /admin/orders/:id/handoffs | handoff | 201 `{handoffId}`；confirmedVersion + location（1–120字）、note（1–240字），只在配送异常且持有包裹时允许 |
| POST /admin/orders/:id/handoffs/:handoffId/confirm | confirmedVersion | `{confirmed:true}`；非申请人、有本订单 scope 的 SUPER/ZONE/BUILDING 管理员核验，普通配送员不可核验 |
| PATCH /admin/orders/:id/status | transition | `{order}`；保留旧 CANCELLED 退单别名，仍须交接校验，新客户端使用 release |
| POST /admin/orders/:id/pickup-code | `{action:'VIEW'或'COPY'}` | `{pickupCode}`；同事务审计、实时 scope、结束后隐藏 |
| GET /admin/tasks | taskQuerySchema | `{orders,page}`，30 条/页；支持 status/building/packageSize/deliveryMode |
| GET /admin/dashboard | 无 | `{counts}`，仅 scope 范围 |
| GET /admin/assignees | 无 | `{admins}`，配送员不能分配任务 |
| GET/POST /admin/batches | 无/batch | `{batches}` / 201 `{id}`，最多20单，同站点、有效接收者 |
| GET /admin/batches/:id | 无 | `{orders}`，逐订单过滤 scope |
| PATCH /admin/batches/:id/status | batchTransition | `{results:[{id,ok,code?}]}`，每单原子且允许明确部分失败 |
| GET /admin/audit | 无 | `{logs}`，SUPER_ADMIN，最近100条；无明文取件码或交接正文 |
| POST /admin/admins/:id/disable | 无 | `{ok:true}`，SUPER_ADMIN；未完成且未送达的分配任务存在时返回 ADMIN_HAS_TASKS |

HANDOFF_REQUIRED：包裹仍由配送员持有，需归还核验。HANDOFF_PENDING：待核验期间不能推进状态。SELF_CONFIRM：申请人不能自核验。交接请求的 location/note 仅在授权任务中展示，不写入 audit metadata。

归还后的业务路径：配送异常 → 填写归还交接 → 另一管理员核验 → 退回市场 → 新配送员接单 → 再次取件。可以在核验归还后由学生取消退款；不再误以为包裹仍在配送员手中。

## 其他已有接口

| 场景 | 路径 | schema/响应 |
|---|---|---|
| 公共资料 | GET /health、/dorm-buildings、/stations | service、buildings、stations |
| 学生认证 | POST /auth/register、/auth/login、/auth/logout | register/login；HttpOnly cookie |
| 学生资料 | GET/PATCH /me | profile；`{user,address?}` |
| 寝室 | GET/POST/PUT/DELETE /me/address | address；`{address}` 或 `{ok:true}` |
| 包裹 | GET/POST /parcels、GET/DELETE /parcels/:id | parcel；`{parcels}`/`{parcel}`/`{ok:true}` |
| 报价 | POST /quotes | quote；`{amountFen,packageSize,deliveryMode}` |
| 订单 | POST /orders、GET /orders/:id | order；`{order}` / `{order,events,payments}` |
| 管理员认证 | POST /admin/auth/login、/admin/auth/logout；GET /admin/me | login；cookie/`{admin}` |
| 授权资料 | GET /admin/dorm-buildings | `{buildings}` |
| 账号管理 | GET/POST /admin/admins；PUT /admin/admins/:id/scopes | createAdmin/角色scopes；SUPER_ADMIN |

## 可靠性扩展

交接修改/驳回、恢复码、错误监控及游标分页契约见 [可靠性与恢复](reliability.md)。当前市场不再限制为首100条，也不再使用客户端全量筛选；旧分页说明以该文档为准。

## 任务分类与工单订单信息

GET /admin/tasks增加group：ALL、ACTIVE、AWAITING_RECEIPT、CLOSED；非ALL时不能同时指定status，切换分类需重置cursor。Ticket新增可选orderContext（status、building、room、station），仅在原有owner/scope校验后返回。实现决策见feature-integration.md。
