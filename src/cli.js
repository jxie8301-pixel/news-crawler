'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadConfig } = require('./config.js');
const { scanShard } = require('./scan.js');
const { mergeShards } = require('./merge.js');
const { checkVipGate } = require('./vip_gate.js');

const OUT_DIR = path.join(ROOT, 'out');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function defaultShards(cfg) {
  return parseInt(arg('shards', String(cfg.matrixShards || 5)), 10);
}

function shardOutPath(shard, shards) {
  return path.join(OUT_DIR, 'shard-' + shard + '-of-' + shards + '.json');
}

async function cmdGate() {
  const cfg = loadConfig();
  const force = process.argv.includes('--force') || process.argv.includes('--no-gate');
  const result = await checkVipGate({ force: force });

  console.log('[vip] VIP 列表 ' + result.vipTotal
    + ' ｜ 有效（带个股且非ETF）' + result.eligible
    + ' ｜ 水位已知 ' + result.lastCount
    + ' ｜ 相对水位新增 ' + result.newCount
    + (result.forced ? ' ｜ --force 强制扫描' : ''));

  result.sampleTitles.forEach(function (t) {
    console.log('[vip]   + ' + t.id + '  ' + t.title);
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const gatePath = path.join(OUT_DIR, 'vip-gate.json');
  fs.writeFileSync(gatePath, JSON.stringify(result, null, 1), 'utf8');
  console.log('[vip] 已写入 ' + gatePath);

  if (!result.shouldRun) {
    console.log('[vip] 无新增带个股 VIP，跳过扫描（exit 3）');
    process.exit(3);
  }
  console.log('[vip] 有新增或强制，继续扫描');
}

async function cmdScan() {
  const cfg = loadConfig();
  const shard = parseInt(arg('shard', '0'), 10);
  const shards = defaultShards(cfg);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const t0 = Date.now();
  let lastLog = 0;
  const result = await scanShard({
    shard: shard,
    shards: shards,
    onProgress: function (stats) {
      const now = Date.now();
      if (now - lastLog < 2000 && stats.scanned < stats.stocks) return;
      lastLog = now;
      process.stdout.write('\r[crawler] ' + stats.scanned + '/' + stats.stocks
        + '  listed=' + stats.listed + '  matched=' + stats.matched
        + '  err=' + stats.errors
        + (stats.aborted ? '  ABORT' : '') + '   ');
    },
  });
  console.log('');
  console.log('[crawler] 本片用时 ' + Math.round((Date.now() - t0) / 1000) + 's');

  const outPath = shardOutPath(shard, shards);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 1), 'utf8');
  console.log('[crawler] 已写入 ' + outPath);

  if (result.aborted) {
    process.exit(4);
  }
}

function cmdMerge() {
  const cfg = loadConfig();
  const shards = defaultShards(cfg);
  const paths = [];
  for (let i = 0; i < shards; i++) {
    const p = shardOutPath(i, shards);
    if (!fs.existsSync(p)) {
      console.error('[crawler] 缺少分片文件: ' + p);
      process.exit(1);
    }
    paths.push(p);
  }

  const merged = mergeShards(paths);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mergedPath = path.join(OUT_DIR, 'merged.json');
  fs.writeFileSync(mergedPath, JSON.stringify(merged, null, 1), 'utf8');
  console.log('[crawler] 已写入 ' + mergedPath);

  if (!merged.ok) {
    process.exit(4);
  }
}

const cmd = process.argv[2];
if (cmd === 'gate') {
  cmdGate().catch(function (e) {
    console.error('[vip] 失败:', e);
    process.exit(1);
  });
} else if (cmd === 'scan') {
  cmdScan().catch(function (e) {
    console.error('[crawler] 失败:', e);
    process.exit(1);
  });
} else if (cmd === 'merge') {
  cmdMerge();
} else {
  console.log('用法:');
  console.log('  node src/cli.js gate [--force]');
  console.log('  node src/cli.js scan --shard 0 --shards 5');
  console.log('  node src/cli.js merge --shards 5');
  process.exit(cmd ? 1 : 0);
}
