# 消息、签收与售后

## 学生操作

- 消息入口展示未读数、分页列表和标为已读操作。新接单、状态变化、退单、退款记录和售后回复/状态变化由数据库事务生成站内通知。仅登录本人能读写自己的消息。
- 订单显示累计退回次数及当前第几轮配送。退单理由按订单版本顺序排列，避免同秒退单顺序混乱。全部历史理由在学生及当前有权限的管理员订单页显示；未接单市场不泄露这些可能含个人信息的自由文本。
- 配送员标记楼下/寝室送达后，学生在订单详情二次确认收货，完成后可进行模拟打赏。管理员不能替学生将订单推进为COMPLETED。旧的已完成订单保留历史状态，不要求追补签收。
- 待签收订单暂不可隐藏，防止签收入口丢失；收货异常时可发起售后。签收不等于放弃售后。
- 售后从订单详情发起，支持未收到、破损、送错、退款和其他问题。每个订单只能有一个未关闭工单，避免重复受理。学生可补充说明，处理完成后关闭工单或重新打开。

## 管理员操作

- 售后工作台按照实时订单scope过滤工单，不能用工单ID扩大订单访问权限。流程：待受理→处理中→回复处理方案→标记已解决→学生关闭/重开。
- 工单本身不会改变配送状态或执行退款，更不会产生真实收费。回复及状态修改有版本校验，文本不写入脱敏审计metadata。
- 任务页“批量取件清单”最多选择当前页20条未结束的授权订单，返回取件码、站点、寝室、电话和备注。服务端在一次D1事务内读取并为每条订单记录脱敏查看审计。
- 批量取件清单和批次创建均提供“全选本页（最多20单）”与清空操作；翻页、筛选或刷新后会清空选择，避免把上一页任务误带入新批次。
- 任一所选订单无权限、已取消或已完成，则整批不返回数据，不记录成功查看。批量显示不提供导出接口。
- 清单30秒自动隐藏，切换页面、折叠清单、点击隐藏或订单版本变化立即清空；正在进行的请求结果也不会在隐藏/切换后重新显示。不能撤销用户已看见的内容或操作系统截图。

## 接口

| 方法/路径 | 用途 |
|---|---|
| GET /api/v1/messages?before=消息ID | 本人消息，30条/页，返回messages/unread/nextCursor |
| POST /api/v1/messages/:id/read | 标记本人单条消息已读 |
| POST /api/v1/messages/read-all | confirmed:true，全标已读 |
| POST /api/v1/orders/:id/receive | version、confirmed:true；本人确认收货 |
| POST /api/v1/tickets | orderId、category、subject、body；新建工单 |
| GET /api/v1/tickets | 本人工单，30条/页，before使用返回的nextCursor |
| GET /api/v1/tickets/:id | 本人工单与最近200条回复 |
| POST /api/v1/tickets/:id/messages | body、version；追加说明 |
| POST /api/v1/tickets/:id/status | status、version、confirmed:true；已解决后CLOSED或OPEN |
| GET /api/v1/admin/tickets | 按订单scope分页的售后工作台 |
| GET /api/v1/admin/tickets/:id | 授权工单详情 |
| POST /api/v1/admin/tickets/:id/messages | 管理员回复 |
| POST /api/v1/admin/tickets/:id/status | OPEN→IN_PROGRESS→RESOLVED，解决前必须已有管理员回复 |
| POST /api/v1/admin/orders/bulk-pickup | orderIds（不重复，1–20）、confirmed:true；返回items与expiresIn |

Order响应增加returnCount、returnHistory及receivedAt；当前轮次为returnCount+1。returnHistory包含reason、createdAt、adminName及用于排序的订单版本。接单不会清除退单原因。

站内消息不是短信、微信订阅或系统推送；需要进入网站查看，顶部未读数在页面可见时每30秒刷新。消息不包含完整取件码或自由文本。旧历史订单不会批量补发通知，以免制造未发生的新提醒。

新增迁移0008_service_workflows.sql。历史迁移、现有账户和演示订单均保留，真实支付仍未启用。

学生首页只展开最近3个有效包裹，其余通过“更多包裹”展开；取消或移除成功后立即从当前视图消失，刷新后仍以服务端状态为准。完整配送订单历史在“我的订单”中使用服务端分页读取。
