#!/usr/bin/env bash
# 广东麻将训练（gd-mahjong-trainer）ECS 静态部署脚本（本地运行，不走 Gitee Go → ACR → 容器）。
#
# 站点：https://www.jp703.xin/majiang/  （挂在 cp-space.conf 的 443 server 块内，路径挂载）
# 原理：dist 上传到 /opt/gd-mahjong/releases/<UTC时间戳>/，原子切换 current 软链；
#       nginx location 片段由 init 下发到 /etc/nginx/snippets/，cp-space.conf 仅有一行 include。
#
# 子命令：
#   init      幂等初始化：目录、/opt/gd-mahjong/majiang 软链、下发 nginx snippet、
#             在 cp-space.conf 注入 include 行（带 .bak 与 nginx -t 失败自动还原）
#   deploy    本地构建（PAGES_BASE=/majiang/）→ 上传 → 原子切换 → 健康检查 → 清理旧版本
#   rollback  把 current 切回上一个 release
#   status    查看当前版本、release 列表
#
# 环境变量（均可覆盖）：SITE_URL / ECS_IP / ECS_USER / PEM / REMOTE_ROOT / KEEP_RELEASES / PAGES_BASE
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SITE_URL="${SITE_URL:-https://www.jp703.xin}"
MAJIANG_PATH="${MAJIANG_PATH:-/majiang}"
ECS_IP="${ECS_IP:-120.79.192.82}"
ECS_USER="${ECS_USER:-root}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/gd-mahjong}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
PAGES_BASE="${PAGES_BASE:-$MAJIANG_PATH/}"
NGINX_SNIPPET="$SCRIPT_DIR/nginx/majiang-locations.conf"
# cp-space.conf 的 443 server 块内、全文件唯一的锚点行（include 插在其后）
HOST_CONF="/etc/nginx/conf.d/cp-space.conf"
ANCHOR="ssl_certificate /etc/nginx/ssl/jp703.xin/jp703.xin.pem;"
INCLUDE_LINE="include /etc/nginx/snippets/majiang-locations.conf;"
PEM="${PEM:-$SCRIPT_DIR/ECSdeploy.pem}"

# pem 解析顺序：$PEM → 本目录 → 相邻的 love-space 项目（同一台 ECS 的既有密钥）
if [ ! -f "$PEM" ] && [ -f "$SCRIPT_DIR/../../love-space/deployment/ECSdeploy.pem" ]; then
  PEM="$SCRIPT_DIR/../../love-space/deployment/ECSdeploy.pem"
fi
if [ ! -f "$PEM" ]; then
  echo "错误：找不到 SSH 私钥。请复制 love-space/deployment/ECSdeploy.pem 到 deployment/ 下（已被 .gitignore 排除），或用 PEM=<路径> 指定。" >&2
  exit 1
fi
chmod 600 "$PEM" 2>/dev/null || true

TARGET="$ECS_USER@$ECS_IP"
remote() { ssh -i "$PEM" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$TARGET" "$@"; }
scp_to() { scp -i "$PEM" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$@"; }

cmd_status() {
  echo "== $TARGET / $REMOTE_ROOT =="
  remote "echo \"current -> \$(readlink '${REMOTE_ROOT}/current' 2>/dev/null || echo '（未部署）')\"; echo 'releases:'; ls -1d '${REMOTE_ROOT}'/releases/*/ 2>/dev/null | sed 's/^/  /' || true"
  remote "grep -q 'majiang-locations.conf' '${HOST_CONF}' && echo 'nginx: include 已挂载 ✓' || echo 'nginx: 尚未 init（cp-space.conf 无 include 行）'"
  echo "站点：$SITE_URL$MAJIANG_PATH/"
}

cmd_init() {
  remote "mkdir -p '$REMOTE_ROOT/releases' /etc/nginx/snippets"
  # /opt/gd-mahjong/majiang -> current：固定软链，snippet 用 root 语义按此映射 URI（-sfn 幂等）
  remote "ln -sfn '$REMOTE_ROOT/current' '$REMOTE_ROOT/majiang'"
  scp_to "$NGINX_SNIPPET" "$TARGET:/etc/nginx/snippets/majiang-locations.conf"
  # 自愈守卫：cp-space.conf 会被本项目以外的脚本/会话整体重写（其它 agent 的子应用切换、
  # certbot --nginx 等），重写后 include 行会丢失。每分钟检查并自动补回。
  scp_to "$SCRIPT_DIR/self-heal-include.sh" "$TARGET:$REMOTE_ROOT/self-heal-include.sh"
  remote "chmod 700 '$REMOTE_ROOT/self-heal-include.sh'"
  remote "crontab -l 2>/dev/null | grep -qF 'self-heal-include.sh' || { (crontab -l 2>/dev/null; echo '* * * * * $REMOTE_ROOT/self-heal-include.sh >> $REMOTE_ROOT/self-heal.log 2>&1') | crontab -; }"
  remote "set -e
if ! grep -q 'majiang-locations.conf' '$HOST_CONF'; then
  if ! grep -qF '${ANCHOR}' '${HOST_CONF}'; then
    echo '错误：cp-space.conf 中找不到锚点行（${ANCHOR}），请手工在其 443 server 块内加入 include 行' >&2
    exit 1
  fi
  bak='${HOST_CONF}.bak.mj-'\$(date +%Y%m%d%H%M%S)
  cp -a '${HOST_CONF}' \"\$bak\"
  sed -i '\\|${ANCHOR}|a ${INCLUDE_LINE}' '${HOST_CONF}'
  if ! nginx -t 2>&1; then
    echo 'nginx -t 失败，已还原备份' >&2
    cp -a \"\$bak\" '$HOST_CONF'
    nginx -t
    exit 1
  fi
  echo \"include 行已注入（备份：\$bak）\"
fi
nginx -t && systemctl reload nginx
echo '✓ nginx 配置就绪并已重载'"
}

cmd_deploy() {
  remote "grep -q 'majiang-locations.conf' '$HOST_CONF'" || {
    echo "错误：ECS 上尚未挂载 nginx 片段，先执行 bash deployment/release.sh init" >&2
    exit 1
  }

  echo "==> 构建（PAGES_BASE=${PAGES_BASE}）"
  (cd "$REPO_ROOT" && PAGES_BASE="$PAGES_BASE" npm run build)

  local_ts="$(date -u +%Y%m%d%H%M%S)"
  rel_dir="$REMOTE_ROOT/releases/$local_ts"
  echo "==> 上传到 $rel_dir"
  remote "mkdir -p '$rel_dir'"
  scp_to -r "$REPO_ROOT/dist/." "$TARGET:$rel_dir/"

  echo "==> 原子切换 current -> $local_ts"
  remote "ln -sfn '$rel_dir' '$REMOTE_ROOT/.current.tmp' && mv -Tf '$REMOTE_ROOT/.current.tmp' '$REMOTE_ROOT/current'"

  echo "==> 清理旧版本（保留最近 $KEEP_RELEASES 个）"
  remote "ls -1d '$REMOTE_ROOT'/releases/*/ 2>/dev/null | sort | head -n -$KEEP_RELEASES | xargs -r rm -rf"

  echo "==> 健康检查"
  sleep 1
  local failed=0
  for path in "$MAJIANG_PATH/" "$MAJIANG_PATH/play" "$MAJIANG_PATH/calculator"; do
    if curl -fsS --max-time 15 "$SITE_URL$path" | grep -q "广东麻将训练"; then
      echo "  ✓ $SITE_URL$path"
    else
      echo "  ✗ $SITE_URL$path"
      failed=1
    fi
  done
  if [ "$failed" -ne 0 ]; then
    echo "健康检查失败！如需回退到上一版本：bash deployment/release.sh rollback" >&2
    exit 1
  fi
  echo "✓ 发布完成：$SITE_URL$MAJIANG_PATH/ （release ${local_ts}）"
}

cmd_rollback() {
  remote "bash -s" <<REMOTE_EOF
set -euo pipefail
cd '$REMOTE_ROOT'
cur="\$(basename "\$(readlink current)")"
prev="\$(ls -1 releases | sort | awk -v c="\$cur" '\$0 < c { last=\$0 } END { print last }')"
if [ -z "\${prev:-}" ]; then echo "没有更早的 release 可回滚"; exit 1; fi
ln -sfn "$REMOTE_ROOT/releases/\$prev" .current.tmp
mv -Tf .current.tmp current
echo "✓ current -> \$prev"
REMOTE_EOF
  echo "==> 回滚后健康检查"
  curl -fsS --max-time 15 -o /dev/null "$SITE_URL$MAJIANG_PATH/" \
    && echo "✓ $SITE_URL$MAJIANG_PATH/ 可访问" \
    || { echo "健康检查失败，请上 ECS 排查（ls -l $REMOTE_ROOT/current）" >&2; exit 1; }
}

case "${1:-}" in
  init)     cmd_init ;;
  deploy)   cmd_deploy ;;
  rollback) cmd_rollback ;;
  status)   cmd_status ;;
  *)
    sed -n '2,18p' "${BASH_SOURCE[0]}"
    echo "用法：bash deployment/release.sh {init|deploy|rollback|status}"
    exit 1
    ;;
esac
