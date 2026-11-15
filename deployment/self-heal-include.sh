#!/usr/bin/env bash
# 自愈守卫：cp-space.conf 会被本项目以外的脚本/会话（其它 agent 的子应用切换脚本、
# certbot --nginx、人工编辑等）整体重写，重写后本站的 include 行会丢失。
# 本脚本每分钟由 crontab 调用：发现 include 缺失即自动补回并重载 nginx。
# 只在缺失时动作；注入后 nginx -t 失败会自动还原备份。
# 由 `bash deployment/release.sh init` 安装到 ECS 的 /opt/gd-mahjong/ 并登记 crontab。
set -euo pipefail

CONF=/etc/nginx/conf.d/cp-space.conf
ANCHOR='ssl_certificate /etc/nginx/ssl/jp703.xin/jp703.xin.pem;'
INCLUDE='include /etc/nginx/snippets/majiang-locations.conf;'
ts="$(date '+%F %T')"

if grep -q 'majiang-locations.conf' "$CONF"; then
  exit 0
fi

if ! grep -qF "$ANCHOR" "$CONF"; then
  echo "$ts 锚点行也丢失了，无法自动注入，请人工检查 $CONF" >&2
  exit 1
fi

bak="$CONF.bak.mj-heal-$(date +%Y%m%d%H%M%S)"
cp -a "$CONF" "$bak"
sed -i "\|$ANCHOR|a $INCLUDE" "$CONF"

if nginx -t 2>/dev/null; then
  systemctl reload nginx
  echo "$ts 已自动补回 include 行（备份：$bak）"
else
  cp -a "$bak" "$CONF"
  nginx -t
  echo "$ts 注入后 nginx -t 失败，已还原备份（snippet 本身可能损坏）" >&2
  exit 1
fi
