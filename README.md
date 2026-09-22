# news-crawler → cls-news v2

并行 v2：**VIP 门控 → Matrix 分片扫描 → merge → 正文/调研/企微 → Pages**，同仓含 **推送复盘 `/perf`**。  
现网 `cls-news` / `dashboard` 冻结；影子期本仓 Pages ≠ 生产站，**默认不推企微**（`enable_push=false`）。

## 命令

```bash
cp config.example.json config.json
mkdir -p data/pools out

node src/cli.js gate [--force]          # 无新增 VIP → exit 3
node src/cli.js scan --shard 0 --shards 5
node src/cli.js merge --shards 5
node src/cli.js post --site-links [--no-push] [--no-research]
node src/cli.js perf                    # T+1～T+5 写入 pushes.db
```

## Actions

| Workflow | 作用 |
|----------|------|
| `collect.yml` | 生产主链（gate → matrix → merge → post → Pages） |
| `push-perf.yml` | 日更 `/perf` + `pushes.db`（保留新闻页） |
| `matrix-crawl.yml` | 仅压测扫描（可保留） |

`collect.yml` 输入：
- `shards` 默认 5
- `force` 忽略 VIP 门控
- `enable_push` 默认 **false**（影子期）
- `publish_pages` 默认 **false**（本仓未开 Pages 时勿开；开启前到 Settings → Pages → Source = GitHub Actions）

## Pages 结构（与现网一致）

- `/` `/cards/` 新闻表
- `/perf/` 推送复盘
- `pushes.db` / `status.json` / `research.json`

## 切流（稍后）

1. 本仓启用 GitHub Pages  
2. 影子跑通后：`cls-trigger` 的 `GH_REPO`/`GH_WORKFLOW` 改指本仓 `collect.yml`  
3. 旧仓 schedule / trigger 停用；紧急回滚指回 `cls-news`
