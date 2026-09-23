# news-crawler

财联社 VIP 新闻采集：门控 → 分片扫描 → 合并 → 正文/调研 → 企微推送 → GitHub Pages。

线上站点：https://jxie8301-pixel.github.io/news-crawler/

## 流水线

1. **gate** — VIP 差集门控（无新增 → exit 3，整轮跳过）
2. **scan** — Matrix 分片扫股票池个股新闻流（默认 5 片）
3. **merge** — 按文章 id 合并分片结果
4. **post** — 拉正文、调研、导出；可选企微（`--no-push` 关闭）
5. **Pages** — 发布 `/`、`/cards/`、`/perf/` 等静态页

股票关联来自个股新闻流并集（及 `quotes_info`），不是 VIP 页上的「焦点一只」。

触发：外部 `cls-trigger`（Cloudflare）在 VIP 水位变化时 `workflow_dispatch` → `collect.yml`。  
VIP 列表：优先直连 `www.cls.cn`；失败则回退 `https://jxie.ccwu.cc/vip`（CF 边缘代拉）。外部触发时 gate 会**优先走 CF**。  
行情 `x-quote`：直连失败回退 `https://jxie.ccwu.cc/xquote`（`push-perf` 交易日历/日K 同路径）。

## 本地命令

```bash
cp config.example.json config.json
mkdir -p data/pools out

node src/cli.js gate [--force]                          # 无新增 VIP → exit 3
node src/cli.js scan --shard 0 --shards 5
node src/cli.js merge --shards 5
node src/cli.js post --site-links [--no-push] [--no-research]
node src/cli.js shadow                                  # 对照另一站点 news.json（可选）
node src/cli.js perf                                    # T+1～T+5 写入 pushes.db
```

需要 Node ≥ 18。企微 / MiniMax 用环境变量：`WECOM_WEBHOOK`、`MINIMAX_API_KEY`。

## Actions

| Workflow | 作用 |
|----------|------|
| `collect.yml` | 主链（gate → matrix → merge → post → Pages） |
| `push-perf.yml` | 推送复盘页；当前仅手动，需要日更时再开 `schedule` |

`collect.yml` 输入：

| 输入 | 默认 | 说明 |
|------|------|------|
| `shards` | `5` | 分片数 |
| `force` | `false` | 忽略 VIP 门控强制跑 |
| `assume_new_vip` | `false` | 外部已判定有新 VIP；拉取 VIP 失败时软继续（CF 哨兵会传 `true`） |
| `enable_push` | `true` | 是否推企微 |
| `publish_pages` | `true` | 是否发本仓 Pages |

仓库 Secrets：`WECOM_WEBHOOK`、`MINIMAX_API_KEY`。  
Pages Source 需为 **GitHub Actions**。

## 数据与站点

- **`data` 分支**：持久化 `pushed.json`、股票池、`pushes.db`、`seeds/`（采集成功后由 Actions 写回，勿 merge 进 `main`）
- **Pages**：
  - `/`、`/cards/` — 新闻表
  - `/perf/` — 推送复盘
  - `/status.json`、`/news.json`、`/research.json`、`/pushes.db`
