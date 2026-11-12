#!/usr/bin/env bash
# © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-2BC0D7ED5A
# CampusDrop v4.7.0 production deploy (macOS / Linux). Same steps as deploy-windows.cmd.
set -euo pipefail
cd "$(dirname "$0")"
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 22 ] || [ "$major" -ge 25 ]; then echo "需要 Node.js 22 或 24（当前 $major）"; exit 1; fi
echo "[1/5] 安装依赖..."; npm ci --include=dev --no-audit --no-fund
echo "[2/5] 检查 Cloudflare 登录..."; npx wrangler whoami | grep -q "You are logged in" || npx wrangler login
echo "[3/5] 检查生产配置..."; npm run production:check
echo "[4/5] 数据库升级（从 v4.6.1 升级到 v4.7.0 无新增迁移；更早版本须依次执行全部待处理迁移）"
echo "      从 v4.5 升级须执行 0020 至 0024；其中 0021 会清理已注销学生账号关联的部分自由文字和送达照片。"
echo "      执行前先备份数据库，并在副本上核查和演练。详见 CHANGELOG.md 中的 v4.6.0 说明。"
echo "      线上数据库待执行的迁移："
npx wrangler d1 migrations list DB --remote --env production --config wrangler.jsonc
read -r -p "      现在执行数据库升级吗？[y/N] " answer
if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
  echo "      wrangler 会再确认一次，输入 y 回车即可。"
  npm run db:migrate:production
else
  read -r -p "      列表中仍有待执行的迁移时不应发布。确认线上已经没有待执行的迁移？[y/N] " sure
  if [ "$sure" != "y" ] && [ "$sure" != "Y" ]; then echo "      已退出，未发布。"; exit 1; fi
fi
echo "[5/5] 构建并发布..."; npm run deploy
echo "部署完成：https://campusdrop-qust-laoshan-production.esthertreu3724.workers.dev"
