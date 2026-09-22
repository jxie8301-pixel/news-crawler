# news-crawler

与 `dashboard` **无代码引用、无共享依赖**。验证 **VIP 门控 → Matrix 分片扫描 → 合并**。

## 本地

```bash
cd news-crawler
cp config.example.json config.json
mkdir -p data/pools out

# 1) VIP 差集门控（对照 Pages status.json.lastVipIds）
node src/cli.js gate
# 无新增 → exit 3；有新增或 --force → 继续

# 2) 分片扫描（默认 5 片）
node src/cli.js scan --shard 0 --shards 5
# …

# 3) 合并
node src/cli.js merge --shards 5
```

- 输出：`out/vip-gate.json`、`out/shard-{i}-of-{N}.json`、`out/merged.json`
- 任一片超时 → 该片 `exit 4`；**merge 整轮 ok=false**

## 参数（config.json）

| 字段 | 含义 |
|------|------|
| `concurrency` | 每片并发，默认 5 |
| `requestDelayMs` | 间隔下限 80–150ms 随机 |
| `scanTimeoutMinutes` | 单片超时（超时作废该片） |
| `matrixShards` | 默认分片数 **5** |
| `statusUrl` | VIP 水位来源（默认 cls-news Pages status.json） |
| `poolFile` | 股票池 JSON 路径 |

## Actions

`workflow_dispatch` → `.github/workflows/matrix-crawl.yml`

1. **gate**：拉 VIP 列表，对照 `statusUrl` 的 `lastVipIds`；无新增则跳过后续（可用 `force=true` 强制）
2. **setup**：按 `inputs.shards`（默认 **5**）生成 matrix
3. **scan** / **merge**：并行扫描并合并

## 与 dashboard / cls-news 集成思路（未落地）

目标：生产仍由 `dashboard` 负责 VIP 文案、推送、水位；本仓库只证明 Matrix 扫描可用。

推荐迁回路径（保持 dashboard 为主仓）：

1. **门控不变**：继续用现有 `cli.js` VIP 差集（exit 3），只是在「有新增」之后换扫描实现。
2. **扫描替换**：把 `news-crawler` 的 `scanShard` / `mergeShards` 迁入 `dashboard/src/`（或作为可复制的 matrix 作业），用 Actions `strategy.matrix` 替代单机 `scanAllStocks`。
3. **作业链**：`gate → matrix scan → merge → collect/notify → push Pages`；merge `ok=false` 时与现网一致：**不推送、不改水位**。
4. **水位单一来源**：仍只由 dashboard 写 `status.json.lastVipIds`；crawler 门控只读，避免双写。
5. **过渡期**：可继续用本仓库 `workflow_dispatch` 做分片数（4/5/8）压测；确认 5 片稳态后再改 dashboard workflow。

不建议：让 crawler 直接推送 Pages 或写 VIP 水位——职责应留在 dashboard。

## 注意

- Matrix **不保证**每片不同出口 IP
- 验证通过后再迁回 dashboard（可选）
