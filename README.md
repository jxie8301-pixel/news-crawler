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

## 切流清单（当前状态）

1. ~~本仓 `data` 已从现网同步（pushed / pools / pushes.db / seeds）~~
2. ~~`cls-trigger-cf` 已指向 `jxie8301-pixel/news-crawler` + `collect.yml` @ `main`~~
3. 配置 Repository secrets：`WECOM_WEBHOOK`、`MINIMAX_API_KEY`（企微默认已开）
4. 可选：本仓启用 Pages 后把 trigger/`publish_pages` 打开
5. 停本机 `cls-trigger`（若还在跑）；旧仓 `cls-news` 不再被 CF 触发
6. 恢复 `push-perf.yml` 的 `schedule`（需要日更复盘时）

## Pages 结构（与现网一致）

- `/` `/cards/` 新闻表
- `/perf/` 推送复盘
- `pushes.db` / `status.json` / `research.json`
