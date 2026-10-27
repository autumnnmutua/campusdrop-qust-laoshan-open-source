@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CampusDrop 生产部署
echo.
echo ==============================================
echo   CampusDrop 校园快递  v2.6.0  生产部署
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js。请先安装 Node.js 22 LTS：https://nodejs.org/
  goto :fail
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo [错误] Node.js 版本过低，需要 22 或 24。当前主版本：%NODE_MAJOR%
  goto :fail
)
if %NODE_MAJOR% GEQ 25 (
  echo [错误] 本项目支持 Node.js 22 或 24，当前主版本：%NODE_MAJOR%
  goto :fail
)

echo [1/5] 安装依赖（首次约 1-3 分钟）...
call npm ci --include=dev --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo [2/5] 检查 Cloudflare 登录状态...
call npx wrangler whoami | findstr /c:"You are logged in" >nul
if errorlevel 1 (
  echo 尚未登录。浏览器会打开 Cloudflare 授权页，请用管理该站点的账号登录并点 Allow。
  call npx wrangler login
  if errorlevel 1 goto :fail
)

echo.
echo [3/5] 检查生产配置...
call npm run production:check
if errorlevel 1 goto :fail

echo.
echo [4/5] 数据库升级
echo   v2.6 需要迁移 0010_live_campus.sql（收货码、预约时段、订单聊天、地图校准、推送订阅、账号注销）。
echo   它只新增列、表和触发器，不删除任何账号或订单。没升级过 v2.0 的话还会一并列出 0009。
echo   如果显示 No migrations to apply，说明已经升级过，按 N 跳过即可。
echo   线上数据库待执行的迁移：
call npx wrangler d1 migrations list DB --remote --env production --config wrangler.jsonc
echo.
choice /c YN /m "  现在执行数据库升级吗？按 Y 执行，按 N 跳过"
if errorlevel 2 goto :skipmigrate
echo   wrangler 会再确认一次，输入 y 回车即可。
call npm run db:migrate:production
if errorlevel 1 goto :fail
goto :deploy
:skipmigrate
echo   已跳过。注意：列表里还有 0010 时不能跳过，新版代码依赖它，跳过后订单页面会报错。
choice /c YN /m "  确认线上已经没有待执行的迁移吗？按 Y 继续发布，按 N 退出"
if errorlevel 2 goto :fail

:deploy
echo.
echo [5/5] 构建并发布到 Cloudflare...
call npm run deploy
if errorlevel 1 goto :fail

echo.
echo ==============================================
echo   部署完成！
echo   https://campusdrop-qust-laoshan-production.esthertreu3724.workers.dev
echo   （浏览器若仍显示旧版，按 Ctrl+F5 强制刷新）
echo ==============================================
pause
exit /b 0

:fail
echo.
echo 部署没有完成。请把上面的报错截图或复制给 Claude。
pause
exit /b 1
