# news-crawler → cls-news v2

并行 v2：**VIP 门控 → Matrix 分片扫描 → merge → 正文/调研/企微 → Pages**，同仓含 **推送复盘 `/perf`**。  
现网 `cls-news` / `dashboard` **冻结**（见 `../dashboard/FROZEN.md`）；影子期本仓默认 **不推企微、不发 Pages**。

## 命令

```bash
cp config.example.json config.json
mkdir -p data/pools out

node src/cli.js gate [--force]          # 无新增 VIP → exit 3
node src/cli.js scan --shard 0 --shards 5
node src/cli.js merge --shards 5
node src/cli.js post --site-links [--no-push] [--no-research]
node src/cli.js shadow                  # 对照现网 Pages news.json
node src/cli.js perf                    # T+1～T+5 写入 pushes.db
```

## Actions

| Workflow | 作用 |
|----------|------|
| `collect.yml` | 主链（gate → matrix → merge → post → shadow → 可选 Pages）；外部 `cls-trigger` 只应 dispatch 这个 |
| `push-perf.yml` | `/perf`（影子期 **仅手动**；切流后再开 schedule） |

`collect.yml` 输入：
- `shards` 默认 5
- `force` 忽略 VIP 门控
- `enable_push` 默认 **false**
- `publish_pages` 默认 **false**（需先 Settings → Pages → Source = GitHub Actions）

产物 artifact：`pipeline-out`（merged / shadow-report / 导出）、`site`（完整站点目录）。

## 影子期检查清单

1. 跑 `collect.yml`（建议 `force=true` 若无新 VIP；`enable_push`/`publish_pages` 保持关）
2. 下载 `pipeline-out` → 看 `shadow-report.json`（仅本轮有 / 仅现网有）
3. 下载 `site` 本地打开 `index.html` / `perf/` 验收版式
4. 现网 `cls-news` 不停、不改

## 切流清单（稍后）

1. 本仓启用 Pages（Actions 源）
2. 配置 Repository secrets：`WECOM_WEBHOOK`、`MINIMAX_API_KEY`
3. 影子跑通后：`cls-trigger-cf` 的 `GH_REPO`/`GH_WORKFLOW` 改指本仓 `collect.yml`
4. `collect.yml` 默认打开 `enable_push` / 需要时 `publish_pages`
5. 恢复 `push-perf.yml` 的 `schedule`
6. 停旧仓 trigger / 旧 `push-perf` schedule；紧急回滚指回 `cls-news`

## Pages 结构（与现网一致）

- `/` `/cards/` 新闻表
- `/perf/` 推送复盘
- `pushes.db` / `status.json` / `research.json`
