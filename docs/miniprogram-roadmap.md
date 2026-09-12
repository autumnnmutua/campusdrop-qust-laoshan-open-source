# 微信小程序交接路线

当前只交付 Web 客户端，没有创建小程序工程。本项目为独立校园服务应用，非学校或菜鸟官方产品；当前支付不产生真实资金流转。

## 可以复用

`src/shared/delivery.ts` 的取件码规范化、`src/domain/commerce.ts` 的价格矩阵和状态转换规则不依赖 React。`src/domain/password.ts` 仅用于服务器，不得打包进小程序。`src/shared/contracts.ts` 的输入约束也不依赖 React；小程序客户端可复用兼容的校验实现，但服务器始终是价格、权限、状态与归属的权威。D1 表、唯一约束、快照和触发器由后端继续维护。

现有 `/api/v1` 契约：

| 场景 | 接口 |
| --- | --- |
| 校园资料 | GET /dorm-buildings、/stations |
| 用户与寝室 | GET/PATCH /me；GET/POST/PUT/DELETE /me/address |
| 包裹 | GET/POST /parcels；GET/DELETE /parcels/:id |
| 报价与订单 | POST /quotes、/orders；GET /orders、/orders/:id |
| 模拟支付 | POST /orders/:id/mock-pay |
| 模拟打赏 | POST /orders/:id/tips/mock-pay |
| 管理员 | /admin 下的任务、批次、状态、敏感值查看与审计接口 |

新增客户端不得直连 D1、读取密码哈希或绕过 admin_scopes；敏感取件码继续通过有审计的服务端接口按权限返回。业务服务当前依赖 Worker 的 Env/D1 与 HTTP 错误类型，因此属于服务端模块，不能直接打包到小程序。

## 必须替换或新增的适配层

1. 认证：现有 Web 使用 HttpOnly、Secure、SameSite=Strict Cookie 和 Origin 检查。小程序需独立登录交换端点，服务端校验微信登录凭证并映射内部 user id；设计短期凭据、撤销、刷新与安全存储。不能简单取消现有 Origin 校验或让客户端指定用户身份。
2. 支付：当前 MockPaymentProvider 仅演示。未来真实微信支付必须新增服务端 provider，验证回调签名、金额、商户与订单归属，处理重复回调、超时、关单、退款、对账。客户端支付回调不能直接标记订单成功。打赏也遵循独立支付规则。
3. 网络：配置小程序合法 HTTPS 请求域名；通过 transport 层统一请求、错误、认证续期和幂等键。正式自定义域名与现有 workers.dev 回退地址分别管理。

## 需要重写的界面

React Router、DOM、CSS、浏览器 Cookie 读取环境、Clipboard API、HTML dialog、焦点管理与 Playwright Web 页面选择器不能直接复用。PickupCodeInput、DormSelector、PriceSummary、OrderTimeline 等可复用交互规范和共享校验，需实现小程序组件。桌面管理员后台保留 Web；ImagePlaceholder 后续按各客户端资源要求替换。

## 验收顺序

先固定接口契约和认证适配测试，再实现注册/登录、寝室、包裹、订单主链。实施变更时应执行业务与越权验证，并增加小程序网络层和真机验收。最后单独接入真实支付沙箱与生产验证；已有非真实交易数据不能作为真实交易凭证迁移。
