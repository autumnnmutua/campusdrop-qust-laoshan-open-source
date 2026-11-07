# Android 安装包（APK）

`android/` 是一个很小的安卓工程：一个全屏 WebView 打开已部署的 CampusDrop 网站。页面、账号和数据与浏览器、
“添加到主屏幕”的网页应用完全相同，网站更新后 App 不需要重新安装。

| 项 | 说明 |
| --- | --- |
| 包名 | `cn.campusdrop.app`（版本 3.9.0，versionCode 390） |
| 最低系统 | Android 7.0（API 24）；按 Android 15（API 35）编译 |
| 打开的网站 | 默认是 `wrangler.jsonc` 里的生产地址；构建时可用 `-PsiteUrl=https://你的域名` 换成别的地址 |
| 权限 | 网络、网络状态、定位（只在配送员共享实时位置时询问） |
| 依赖 | 只用安卓系统自带组件，不引入任何第三方库 |

App 内的行为：

- 网站自己的页面留在 App 里；电话号码、地图、微信 / 支付宝和其他网站交给手机上的对应应用打开。
- 上传照片（送达拍照、包裹识别）走系统的相册 / 相机选择器。
- 返回键先在页面间后退，退到首页再退出。
- 无法连接网站时显示“无法连接 CampusDrop”页，恢复网络或服务后点“重试”回到原来的页面。
- 登录状态保存在 App 内（与手机浏览器分开），有效期与网页版相同（学生 12 小时、管理员 2 小时）。
- 浏览器标识末尾带 `CampusDropApp/3.9.0`，以后需要时网站可以据此区分 App。

## 方式一：GitHub Actions 自动构建（推荐，不需要在电脑上装 Android Studio）

1. 把整个项目推送到 GitHub 仓库。
2. 打开仓库的 **Actions → Android APK → Run workflow**。网站地址留空就用默认生产地址；换了域名就填完整的 `https://…`。
3. 大约 5–10 分钟后，在这次运行页面底部的 **Artifacts** 下载 `campusdrop-apk`，里面是 `campusdrop-debug.apk`。
4. 把 APK 发到安卓手机上安装（第一次需要在系统设置里允许“安装未知来源应用”）。

`campusdrop-debug.apk` 用调试证书签名，适合实测阶段自己人安装。要发给更多同学或上架应用商店，用正式签名（见下）。

### 正式签名（可选）

正式发布时应在本机使用自行保管的签名文件和环境变量构建，不要把签名文件、账号、密码或密钥提交到 GitHub。

## 方式二：本机构建

需要 JDK 17 及以上和 Android SDK（装 Android Studio 最省事）。

```bash
cd android
./gradlew assembleDebug                                     # 输出 app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleDebug -PsiteUrl=https://你的域名           # 换网站地址
```

也可以直接用 Android Studio 打开 `android/` 文件夹，点 Run 安装到连着的手机上。正式签名时先设置
`ANDROID_KEYSTORE_PATH`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` 四个环境变量，再运行
`./gradlew assembleRelease`。

## 需要知道的限制

- **国内访问**：`*.workers.dev` 域名在部分校园网 / 运营商网络下可能打不开或很慢，App 只是打开网站，网站打不开 App 也打不开。
  正式实测建议给 Worker 绑定自己的域名，再用 `-PsiteUrl` 构建。
- **上架应用商店**：国内安卓应用商店上架通常需要软件著作权、ICP 备案等材料，App 本身不解决这些；实测阶段直接分发 APK 即可。
- **推送通知**：网页推送依赖手机上的浏览器推送服务，在 WebView 里不可用；App 内的站内消息照常显示。需要系统推送时，
  可以继续用浏览器版（“添加到主屏幕”）接收提醒。
- **另一种做法**：也可以用 PWABuilder（pwabuilder.com）把网站打包成 TWA（可信网页活动）安装包，体验与 Chrome 一致、支持网页推送，
  但要求手机装有 Chrome，并需要在网站上放置 `assetlinks.json`；国内很多手机没有 Chrome，所以这里默认用 WebView 方式。

请在实测前用不同品牌的手机试装，并验证相机上传、定位和站外链接。
