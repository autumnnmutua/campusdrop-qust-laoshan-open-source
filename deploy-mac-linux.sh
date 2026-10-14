#!/usr/bin/env bash
# CampusDrop v1.1.0 production deploy (macOS / Linux). Same steps as deploy-windows.cmd.
set -euo pipefail
cd "$(dirname "$0")"
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 22 ] || [ "$major" -ge 25 ]; then echo "需要 Node.js 22 或 24（当前 $major）"; exit 1; fi
echo "[1/4] 安装依赖..."; npm ci --include=dev --no-audit --no-fund
echo "[2/4] 检查 Cloudflare 登录..."; npx wrangler whoami | grep -q "You are logged in" || npx wrangler login
echo "[3/4] 检查生产配置..."; npm run production:check
echo "[4/4] 构建并发布..."; npm run deploy
echo "部署完成：https://campusdrop-qust-laoshan-production.esthertreu3724.workers.dev"
