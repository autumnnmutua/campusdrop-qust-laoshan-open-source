# CloudBase 部署

## 静态网站

在 CloudBase GitHub 部署选择仓库的 main 分支与根目录 `.`，框架选择 Vite，Node选择22.12以上或24。

- 安装：`npm install --include=dev`
- 构建：`npm run build`
- 产物：`dist`

必须安装devDependencies，其中包含Vite和TypeScript。不要设置旧的 `dist/client` 或 `build` 路径。若平台只有旧Node版本，应先切换构建运行时，不能仅改框架名称。

默认cloudbaserc.json包含CLI必需的公开envId，适用于当前CloudBase环境的静态Git部署；部署到其他环境时修改envId。CLI 3.7.0即使命令传入-e仍会校验配置文件内的envId，不得删除该字段。静态部署不要求函数变量。部署失败时查看安装/构建日志的首个错误；构建成功而API404属于运行时路由未配置，二者需要分别排查。

## 完整业务

前端调用同源 `/api/v1`。先部署自己的 Workers/D1 后端，或者使用已有兼容服务。静态托管不能执行数据库查询。

可选使用 `cloudbaserc.full.example.json` 部署 CloudBase 桥接函数及网关。将示例复制到自己的部署目录，配置：

- `TCB_ENV_ID`：自己的CloudBase环境ID。
- `CAMPUSDROP_CLOUDBASE_ORIGIN`：实际网页HTTPS origin，无路径及末尾斜杠。
- `CAMPUSDROP_UPSTREAM_ORIGIN`：自己的业务后端HTTPS origin。

桥接函数为Nodejs20.19，入口index.main，超时30秒；将 `/api` 完整路径透传至campusdrop-api，并将 `/` 指向静态站点，两者必须同域。CloudBase平台认证关闭不代表取消业务认证，实际会话与权限仍由后端检查。

如果默认webapps域名不支持挂载函数，使用能同时承载这两条路由的网关或自定义域名。修改最终域名后同步修改APP_ORIGIN。不得全面关闭Origin检查解决登录问题。

## 验收与安全

health应返回200 JSON，站点和楼栋接口200 JSON；未登录orders/admin/me应返回401 JSON，而不是存储NoSuchKey或HTML页面。

密钥通过平台配置，不写入源码、VITE_*、GitHub或公开截图。_headers文件不是CloudBase响应头配置，应在托管网关设置安全响应头。哈希资源可长缓存，index.html保持更新校验。

支付点击后记录应用内成功状态，无真实扣款。服务不提供真实微信支付、短信身份认证或资金结算。桥接模式仍依赖上游服务可达性，并非数据库迁移。

官方资料：https://docs.cloudbase.net/cli-v1/hosting 、 https://docs.cloudbase.net/cli-v1/gateway 。

## CloudBase 自定义部署命令

如果平台日志显示直接执行 `tcb hosting deploy ./dist ...`，请在“版本配置”将自定义部署命令改为：

```sh
npm run deploy:cloudbase
```

该命令先安装锁定依赖（包含Vite），再构建并校验dist，最后调用平台已有tcb上传。任何一步失败立即停止。当前上传路径为 `/campusdrop`，与原应用一致；部署其他应用请修改cloudbaserc.json中的hosting.deployPath和envId。

不要继续使用旧的仅上传命令：它不读取配置中的buildCommand，也不会自动生成dist。修改仓库无法覆盖控制台保存的自定义命令，必须在平台改一次。若平台拆分安装/构建/部署三个步骤，则依次配置 npm ci --include=dev、npm run build 和原tcb上传命令。
