#!/usr/bin/env bash
# CampusDrop v2.6.0 production deploy (macOS / Linux). Same steps as deploy-windows.cmd.
set -euo pipefail
cd "$(dirname "$0")"
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 22 ] || [ "$major" -ge 25 ]; then echo "需要 Node.js 22 或 24（当前 $major）"; exit 1; fi
echo "[1/5] 安装依赖..."; npm ci --include=dev --no-audit --no-fund
echo "[2/5] 检查 Cloudflare 登录..."; npx wrangler whoami | grep -q "You are logged in" || npx wrangler login
echo "[3/5] 检查生产配置..."; npm run production:check
echo "[4/5] 数据库升级（v2.6 需要迁移 0010_live_campus.sql，只新增列、表和触发器，不删除已有数据；若显示 No migrations to apply 可直接跳过）"
echo "      线上数据库待执行的迁移："
npx wrangler d1 migrations list DB --remote --env production --config wrangler.jsonc || true
read -r -p "      现在执行数据库升级吗？[Y/n] " answer
if [ -z "$answer" ] || [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
  echo "      wrangler 会再确认一次，输入 y 回车即可。"
  npm run db:migrate:production
else
  read -r -p "      列表里还有 0010 时不能跳过（新版代码依赖它）。确认线上已经没有待执行的迁移？[y/N] " sure
  if [ "$sure" != "y" ] && [ "$sure" != "Y" ]; then echo "      已退出，未发布。"; exit 1; fi
fi
echo "[5/5] 构建并发布..."; npm run deploy
echo "部署完成：https://campusdrop-qust-laoshan-production.esthertreu3724.workers.dev"
