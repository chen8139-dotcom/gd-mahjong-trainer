# 部署方案：www.jp703.xin/majiang/ 子路径静态发布

广东麻将训练是**纯静态 SPA**（构建产物约 300KB，无后端、无运行时 API），部署方式为：
**本地构建 → scp 直传 ECS → 宿主机 nginx 按子路径对外服务**。

不使用 love-space 的 `Gitee Go 构建 → 推 ACR → SSH 拉镜像重建容器` 管线——那套流程里的
Docker/ACR/镜像版本管理只为运输一个 `dist/` 目录而存在，对静态站是纯开销。GitHub Pages
部署（`.github/workflows/ci.yml`）不受影响，两条链路并存。

## 架构

```
笔记本                                ECS（root@120.79.192.82，Alibaba Cloud Linux 3）
──────                                ──────────────────────────────────────────────
PAGES_BASE=/majiang/ npm run build
        │
        ▼ scp -r dist/.
                        ────────►  /opt/gd-mahjong/releases/<UTC时间戳>/   ← 保留最近 5 个
                                    /opt/gd-mahjong/current   ──symlink──► ↑ 原子切换（mv -T）
                                    /opt/gd-mahjong/majiang   ──symlink──► current（固定，init 建好）
                                                                           │
                                    /etc/nginx/snippets/majiang-locations.conf
                                      ◄── cp-space.conf 443 块内一行 include 引用
                                                                           │
用户 ──https://www.jp703.xin/majiang/────────────────────────────────────► nginx 1.20.1
```

| 项 | 值 |
|---|---|
| 访问地址 | `https://www.jp703.xin/majiang/`（`jp703.xin/majiang/` 同样可达，同一 server 块） |
| HTTPS | 复用主站证书 `/etc/nginx/ssl/jp703.xin/`（SAN 含 jp703.xin + www.jp703.xin，**2026-12-20 到期**，随主站流程续期） |
| SPA 回退 | `try_files $uri $uri/ /majiang/index.html`（BrowserRouter 路由：/majiang/、/majiang/play、/majiang/calculator、/majiang/learn、/majiang/settings） |
| 子路径构建 | `PAGES_BASE=/majiang/`（vite.config.ts 既有机制，GitHub Pages 同款），资源 URL 带 /majiang/ 前缀，PWA scope 隔离在 /majiang/ 内 |

**为什么用子路径而不是独立子域名**：无需加 DNS 记录、无需签发新证书，复用主站 `jp703.xin`
的 vhost 与证书；代价是 URL 带 `/majiang/` 前缀，且本站的 location 片段与主站共用一个
server 块（通过 include 隔离，对 cp-space.conf 的侵入只有一行）。

## 首次部署

```bash
bash deployment/release.sh init      # 目录 + 固定软链 + 下发 snippet + 注入 include 行（幂等，可重跑）
bash deployment/release.sh deploy    # 构建 → 上传 → 切换 → 健康检查
```

`init` 对 `cp-space.conf` 的改动只有一行 `include /etc/nginx/snippets/majiang-locations.conf;`，
插入在其 443 server 块内唯一的锚点行（`ssl_certificate …/jp703.xin.pem;`）之后；改前自动
`.bak.mj-<时间戳>` 备份，`nginx -t` 失败会自动还原。改动 cp-space.conf 后记得把
`deployment/nginx/majiang-locations.conf` 与仓库保持同步（改 snippet 后重跑 `init` 即可）。

## 日常发布与回滚

```bash
bash deployment/release.sh deploy      # 发布（tsc 门禁失败会在构建处中断，不影响线上）
bash deployment/release.sh rollback    # 回滚到上一个 release
bash deployment/release.sh status      # 当前版本 / release 列表 / include 状态
```

发布是原子切换：`current` 软链经 `mv -T` 瞬间指向新目录，不存在半新半旧窗口；回滚 = 把软链
切回去，无状态、无副作用。`/opt/gd-mahjong/majiang` 软链永远指向 `current`，nginx 配置无需
随发布变更。

## 缓存策略与 PWA（snippet 已落地，此处说明原因）

| 路径 | Cache-Control | 原因 |
|---|---|---|
| `/majiang/assets/*` | `public, max-age=31536000, immutable` | Vite 产物文件名带内容 hash，内容变则名变，可放心永久缓存 |
| `/majiang/`（含 index.html、sw.js、manifest） | `no-cache` | Service Worker（`autoUpdate`）靠每次拿到最新 `sw.js` 感知发版；缓存了会导致用户停留旧版本 |

发版后客户端在下一次打开时由 SW 自动拉取新版本，无需用户手动清缓存。PWA 的 scope 被构建
限定在 `/majiang/` 内，不会干扰主站其它子应用。

## 自愈守卫（为什么主站配置被改写后本站还能活着）

`cp-space.conf` 由多个互不知情的脚本/会话共同维护（其它项目的子应用切换脚本、
`certbot --nginx`、人工编辑等），任何一次整体重写都会抹掉我们的 include 行，
`/majiang/` 随即 404。为此 `init` 会安装一个自愈守卫：

- `/opt/gd-mahjong/self-heal-include.sh`（源：[self-heal-include.sh](./self-heal-include.sh)）
- crontab 每分钟执行：include 缺失 → 自动补回（先 `.bak.mj-heal-<时间戳>` 备份）→
  `nginx -t` 通过才 reload，失败自动还原
- 日志：`/opt/gd-mahjong/self-heal.log`；锚点行也丢失时才需要人工介入

因此**最坏情况**下 `/majiang/` 的中断不超过 1 分钟，且无需人工发现。若要彻底避免
（消除这 1 分钟窗口），需要把 include 行加进其它项目切换脚本的模板里——那超出本仓库
的边界，遇到频繁抹写时再与相关项目协调。

## 安全约定与注意事项

- `deployment/ECSdeploy.pem`（SSH 私钥）与 `deployment/.env*` 已被 `.gitignore` 排除，**永不入库**；
  pem 解析顺序：`$PEM` 环境变量 → 本目录 → 相邻 love-space 项目的同名密钥（同一台 ECS）。
- 变更 nginx 配置一律走 `release.sh init` 下发 snippet（仓库内 `deployment/nginx/` 是唯一源），
  避免 ECS 上的手工漂移；主站 cp-space.conf 除那一行 include 外不做任何改动。
- **证书共用提醒**：本站与主站共用 `jp703.xin` 证书，到期时间 2026-12-20；若主站证书续期流程
  断供，本站同样受影响。另：ECS 上 `wiki.jp703.xin` 的证书已于 2026-11-12 过期（爱思 agnai 站
  域名），与本仓库无关但建议尽快处理。
