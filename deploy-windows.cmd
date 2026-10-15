@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CampusDrop 生产部署
echo.
echo ==============================================
echo   CampusDrop 校园快递  v2.3.0  生产部署
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
echo   如果还没升级过 v2.0，这里会列出迁移 0009：只新建“公告”和“评价”两张表，不会改动或删除已有账号和订单。
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
echo   已跳过。网站仍可正常下单，但公告、评价和数据看板会显示为空；之后可运行 npm run db:migrate:production 补上。

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
