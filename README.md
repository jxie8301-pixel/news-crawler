# news-crawler

与 `dashboard` **无代码引用、无共享依赖**。专门验证 **GitHub Actions Matrix → 分片扫描 → 合并**。

## 本地

```bash
cd news-crawler
cp config.example.json config.json
mkdir -p data/pools out
# 放入 all-a.json（可从 cls-news data 分支或 Pages 侧获取）

node src/cli.js scan --shard 0 --shards 4
node src/cli.js scan --shard 1 --shards 4
# …
node src/cli.js merge --shards 4
```

- 输出：`out/shard-{i}-of-{N}.json`，合并为 `out/merged.json`
- 任一片 **scanTimeoutMinutes** 超时 → 该片 `exit 4`，articles 为空；**merge 整轮 ok=false**

## 参数（config.json）

| 字段 | 含义 |
|------|------|
| `concurrency` | 每片并发，默认 5 |
| `requestDelayMs` | 间隔下限 80–150ms 随机 |
| `scanTimeoutMinutes` | 单片超时（与 dashboard 语义一致：超时作废该片） |
| `matrixShards` | 默认分片数 |
| `poolFile` | 股票池 JSON 路径 |

## Actions

`workflow_dispatch` → `.github/workflows/matrix-crawl.yml`

- `scan`：matrix 0..3 并行（inputs.shards 可改，需同步改 matrix 列表）
- `merge`：下载 artifact → `merge` → 上传 `merged.json`

## 注意

- 不推送、不写 `pushed.json`、不碰 VIP 水位
- Matrix **不保证**每片不同出口 IP；本仓库只度量墙钟与失败率
- 验证通过后，再把 workflow 形态迁回 `dashboard`（可选）
