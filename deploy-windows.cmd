@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CampusDrop 生产部署
echo.
echo ==============================================
echo   CampusDrop 校园快递  v1.1.0  生产部署
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

echo [1/4] 安装依赖（首次约 1-3 分钟）...
call npm ci --include=dev --no-audit --no-fund
if errorlevel 1 goto :fail

echo.
echo [2/4] 检查 Cloudflare 登录状态...
call npx wrangler whoami | findstr /c:"You are logged in" >nul
if errorlevel 1 (
  echo 尚未登录。浏览器会打开 Cloudflare 授权页，请用管理该站点的账号登录并点 Allow。
  call npx wrangler login
  if errorlevel 1 goto :fail
)

echo.
echo [3/4] 检查生产配置...
call npm run production:check
if errorlevel 1 goto :fail

echo.
echo [4/4] 构建并发布到 Cloudflare...
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
