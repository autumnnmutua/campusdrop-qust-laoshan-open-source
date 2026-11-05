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
| 登录状态（v3.5.1） | GET /auth/session、GET /admin/auth/session | 无；`{signedIn}`，未登录也返回 200 |
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

## v3.0：合并配送、常用配送规则、天气联动、准时率

| 方法/路径 | 请求 schema | 成功响应 | 语义 |
|---|---|---|---|
| POST /order-groups | groupOrder | 201 `{group}` | 同一学生、同一站点的 2–6 件 ACTIVE 包裹一次建单；每件仍是独立订单（独立计价、取消、退款、交接），共享 group_id 与收货码。任一包裹已有订单返回 409 ORDER_EXISTS，不同站点 400 GROUP_STATION；中途失败会撤销本次已建的订单 |
| GET /order-groups/:id | 无 | `{group:{id,createdAt,origin,orders,totalFen,unpaidFen,unpaidCount}}` | 仅所有者；不属于当前用户返回 404 |
| POST /order-groups/:id/mock-pay | 无 | `{group,paid,missed,message}` | 支付全部未付款成员；预约时段先检查剩余名额是否够全部成员（不够 409 SLOT_FULL），每件仍用与单件相同的条件写入，名额不会超订 |
| POST /order-groups/:id/cancel-unpaid | 无 | `{group}` | 取消仍未付款的成员；已付款成员请在各自订单页取消 |
| GET /me/rules | 无 | `{rules}` | 常用配送规则，最多 3 条 |
| POST /me/rules | ruleCreate | 201 `{rules}` | weekdays 为位掩码（bit0=周一 … bit6=周日）；dropPlace 只能配合 DOWNSTAIRS |
| PATCH /me/rules/:id | ruleUpdate | `{rules}` | 可改任意字段或 active 暂停/恢复 |
| DELETE /me/rules/:id | 无 | `{rules}` | 删除 |
| GET /weather | 无 | `{weather:{enabled,level,source,observed,notice,paddingMinutes}}` | 公开；level 为 CLEAR/WET/SEVERE；observed 来自 Open-Meteo（显示时须注明来源） |
| GET /admin/weather | 无 | `{weather,setting,fetchedAt,failedAt}` | 管理员 |
| PUT /admin/weather | weatherSetting | `{weather}` | 仅超级管理员；override 为 AUTO/CLEAR/WET/SEVERE，写审计 |
| GET /admin/punctuality?days=7\|14\|30&asap=45\|60\|90 | 无 | `{report}` | 按授权范围统计已送达订单的准时率（按配送员、楼栋、时段、天、天气） |

Order 新增 groupId、groupSize（同组未取消的订单数）、ruleId；待接订单（GET /admin/available）新增 groupId、groupSize。管理员认领（POST /admin/orders/:id/claim）合并配送中的一件时，同组其余已支付、未被接走的订单进入同一批次；推进 PICKED_UP / OUT_FOR_DELIVERY / DELIVERED_* 时同批次的同组订单一起推进（异常只作用于当前订单）；收货码核验（POST /admin/orders/:id/handoff-code）一次签收同批次中已出发或已送达的同组订单。合并配送订单不支持单件升级到寝（409 GROUP_UPGRADE）。

常用配送由每 10 分钟的定时任务执行：时段开始前 3 小时起至截止预约前 10 分钟，为规则所属学生已登记、无订单的包裹生成该时段的未付款订单（同一站点多件自动合并），发站内消息（kind RULE_ORDER，link 指向支付页）。规则生成的未付款订单在该时段截止预约时自动取消。

## v3.5：第二个站点、智能助手、AI 运营小结

| 方法/路径 | 请求 schema | 成功响应 | 语义 |
|---|---|---|---|
| GET /stations | 无 | `{stations}` | 按 sort_order 排序：YIHAIYUAN（颐海苑）、NANSHI（南苑十号楼对面） |
| GET /sends | 无 | 新增 `stations:[{code,name}]`、`suggested` | suggested 为按地图步行路线离学生寝室最近的站点 |
| POST /sends | sendCreate | 201 `{send}` | 新增可选 stationCode；省略时用离寝室最近的站点；站点不可用 409 LOCATION_INACTIVE |
| POST /assistant | assistantAsk | `{reply:{answer,source,model,fallbackReason,links,references}}` | 仅学生；15 分钟 30 次；source 为 MODEL 或 LOCAL；fallbackReason 为 NOT_CONFIGURED / DAILY_LIMIT / MODEL_ERROR；links 只来自服务端固定列表 |
| GET /assistant/status | 无 | `{configured,model,faq}` | 公开；是否配置了大模型 |
| GET /admin/ops-summary?days=7\|14\|30 | 无 | `{summary:{days,bullets,source,model,fallbackReason,generatedAt,facts}}` | 管理员；按授权范围统计；15 分钟 12 次 |

发送给大模型的内容只有问题、最近 6 轮对话和服务端整理的订单状态摘要（状态、站点、楼栋、时段），不含姓名、电话、房间号、取件码、收货码和备注。大模型地址只接受 HTTPS（开发环境允许本机 http）。

## v3.7.1：优惠券、一键体验的超级管理员

| 方法/路径 | 请求 schema | 成功响应 | 语义 |
|---|---|---|---|
| GET /coupons | 无 | `{coupons:[{id,name,summary,expiresAt,state}]}` | 学生；“我的优惠券”（专属券、新人券、自动匹配的优惠码），state 为 AVAILABLE / USED / EXPIRED |
| GET /coupons/quote?orderId= 或 ?groupId=[&code=] | couponQuoteQuery | `{quote:{amountFen,orders,options,best,code?}}` | 学生；列出这次付款可用的券与优惠金额，best 为不需要输码的最省钱的一张；带 code 时（大小写不限，15 分钟 30 次）核对优惠码，更划算时 best 指向它 |
| POST /orders/:id/mock-pay、POST /order-groups/:id/mock-pay | payWithCoupon（可省略） | 同前 | 可带 `{couponId, code?}`（凭码使用的券必须带码）；服务端重新校验与计算，同一事务写入优惠记录、订单优惠与支付；券不可用 409 COUPON_UNAVAILABLE；不带参数即不用券（兼容旧页面） |
| GET /admin/coupons | 无 | `{coupons:[AdminCoupon]}` | 超级管理员（含体验中的超级管理员，只看本次体验的券与只读的预置券） |
| POST /admin/coupons | couponCreate | 201 `{id}` | kind：CODE / PERSONAL（usernames）/ NEW_USER；usage：PER_ACCOUNT / ONCE_TOTAL；重复码 409 COUPON_CODE_TAKEN；用户名不存在 400 COUPON_USERS_MISSING |
| PUT /admin/coupons/:id/status | couponStatus | `{ok}` | 停用或重新启用（只能改自己范围内的券） |

**金额规则**：打折券 discountValue 为仍需支付的百分比（50 = 五折），立减券为分；可设满减门槛与最多减；每单至少支付 0.01 元。订单的 `discountFen` 为优惠金额，`amountFen` 仍为原价。取消退款按实付金额退，全部订单取消后优惠记录变为 RELEASED（券退回）。

**体验中的超级管理员**：`requireSuper` 对体验账号返回 403 DEMO_READONLY（全站设置、公告、管理员、天气、群机器人、地图校准、账号恢复）；`GET /admin/admins`、`/admin/audit` 只返回本次体验的数据，`/admin/errors`、`/admin/announcements`、代寄件为空。`PUT /demo/role` 的 role 为 `courier` / `super`（旧值 `senior` 仍接受）；`GET /demo/status` 新增 `studentUsername`。

## v3.7：更多可配送楼栋、一键体验的第三个身份与初始数据

| 方法/路径 | 请求 schema | 成功响应 | 语义 |
|---|---|---|---|
| POST /demo/start | demoStart | 201 `{ok,status:{active,auto,courierName,seniorName,adminRole}}` | 在 v3.6 基础上：另建第三个体验身份（v3.7.0 为 ZONE_ADMIN“高级配送员”，v3.7.1 起为 SUPER_ADMIN“超级管理员”，仍只限本 demo_group）和 7 位邻居学生，写入约三周的已完成订单（评价、打赏）、当天的待接 / 已接单 / 已取件 / 配送中 / 已送达未确认 / 配送异常订单、5 张售后工单和排班；每天最多 DEMO_DAILY_LIMIT 次（默认 12，按北京时间日期），超过 429 DEMO_DAILY_LIMIT |
| GET /demo/status | 无 | 新增 `seniorName`、`adminRole`（`courier` / `senior` / null） | `adminRole` 为当前管理员 Cookie 所登录的体验身份 |
| PUT /demo/role | demoRole | `{role}` | 体验会话；把管理员 Cookie 换成本次体验的演示配送员（`courier`）或第三个身份（`super`，旧值 `senior`）；旧体验没有第三个身份时 409 DEMO_ROLE_MISSING |
| POST /demo/end | `{}` | `{ok}` | 本次体验的全部账号退出登录并停用；手上还有未完成体验订单的配送员账号保持启用（数据库触发器不允许停用），但没有会话、无法登录 |
| GET /dorm-buildings | 无 | 新增 12 栋：NORTH_B1–B4、GYM、EAST_1–3（北区）、LIBRARY_HALL、ADMIN_HALL、ACTIVITY_CENTER、ART_CENTER（南区） | 楼栋代码校验放宽为 `^[A-Z][A-Z0-9_]{1,23}$`，是否存在、是否启用以数据库为准（寝室、管理员楼栋授权、公告定向同此） |

**体验范围修正**：可分配配送员列表和批次分配原来只认 `demo_group IS NULL` 的配送员，现在按当前管理员所在的 demo_group 匹配（真实管理员仍只看到真实配送员）；预计送达时间的历史样本排除体验订单。

## v3.6：一键体验、智能体助手、一句话下单、成效看板、单量预测、截图识别大模型兜底

| 方法/路径 | 请求 schema | 成功响应 | 语义 |
|---|---|---|---|
| POST /demo/start | demoStart | 201 `{ok,status:{active,auto,courierName}}` | 公开；口令为 DEMO_PASSCODE（未设置或设为 `off` 时关闭 → 404 DEMO_DISABLED）；口令错误 403 DEMO_PASSCODE；每 IP 15 分钟 12 次、全站每小时 120 次。创建一对体验账号（学生 + 配送员，同一 demo_group）、北苑4号楼 301 的寝室和 3 件包裹，同时写入学生与管理员两个会话 Cookie |
| GET /demo/status | 无 | `{status:{active,auto,courierName}}` | 用任一体验会话查询；非体验账号返回 active=false |
| POST /demo/tick | `{}` | `{steps,auto}` | 体验会话；auto 开启时，模拟配送员把已支付的体验订单推进一步（付款 6 秒后接单 → 14 秒后取件 → 10 秒后出发 → 75 秒后送达）；15 分钟 600 次 |
| PUT /demo/auto | demoAuto | `{auto}` | 开关自动配送；关闭后由访客扮演配送员 |
| POST /demo/end | `{}` | `{ok}` | 停用两个体验账号、删除会话并清除 Cookie |
| POST /agent/plan | agentPlan | `{plan:{answer,drafts,steps,source,model,fallbackReason}}` | 仅学生；与智能助手共用 15 分钟 30 次。生成配送草稿，不创建订单；草稿由页面调用 POST /orders 或 /order-groups 确认 |
| POST /assistant | assistantAsk | `reply` 新增可选 `drafts`、`steps` | 句子是在要求安排配送时附带草稿；配置大模型时由大模型通过 function calling 调用 list_waiting_parcels / list_open_slots / quote / draft_delivery |
| GET /assistant/status | 无 | 新增 `vision`、`visionModel` | 截图识别大模型兜底是否可用 |
| POST /parcels/vision | 原始图片（image/jpeg、image/png、image/webp，≤ 800 KB） | `{codes,model}` | 仅学生；仅当配置了大模型且 AI_VISION 不为 off；15 分钟 10 次；每日上限为 AI_DAILY_LIMIT 的 1/5（至少 10 次），超过 429 VISION_LIMIT；未开启 404 VISION_OFF；模型失败 502 VISION_FAILED；图片类型与内容不符 415。图片不保存、不记录 |
| GET /impact | 无 | `{impact:{all,last7,onTimeRate,onTimeSample,mergedParcels,since,generatedAt}}` | 公开；只含汇总数字；只统计真实订单；缓存 5 分钟 |
| GET /admin/forecast | 无 | `{forecast:{days,trend,trendApplied,backtest,perCourier,perCourierBasis,weather,historyDays,generatedAt},staffing}` | 管理员；按授权范围统计；排班对比（staffing）仅超级管理员 |

**体验数据隔离**：users、admin_users、delivery_orders 新增 demo_group。orderScope 与接单市场只让同一 demo_group 的配送员看到体验订单，真实管理员看不到；体验订单不占时段名额、不发群通知与站内推送、不进入成效看板与楼栋热度；体验账号无密码、不能用用户名登录、不出现在管理员列表；代寄件对体验账号返回 403 DEMO_UNSUPPORTED。每日任务停用超过 24 小时的体验账号。

**草稿校验**（与下单一致，但不写库）：包裹属于本人、尚未下单；合并配送须同一站点且不超过 6 件；约定地点只能配楼下；时段须开放且名额足够；暂停接单时（体验账号除外）不生成草稿。发给大模型的工具结果只有包裹编号 P1、P2…、站点、大小、承运商和时段，不含取件码、姓名、电话、房间号。
