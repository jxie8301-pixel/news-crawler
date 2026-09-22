'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadConfig } = require('./config.js');
const { scanShard } = require('./scan.js');
const { mergeShards } = require('./merge.js');

const OUT_DIR = path.join(ROOT, 'out');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function shardOutPath(shard, shards) {
  return path.join(OUT_DIR, 'shard-' + shard + '-of-' + shards + '.json');
}

async function cmdScan() {
  const cfg = loadConfig();
  const shard = parseInt(arg('shard', '0'), 10);
  const shards = parseInt(arg('shards', String(cfg.matrixShards || 4)), 10);
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
  const shards = parseInt(arg('shards', String(cfg.matrixShards || 4)), 10);
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
if (cmd === 'scan') {
  cmdScan().catch(function (e) {
    console.error('[crawler] 失败:', e);
    process.exit(1);
  });
} else if (cmd === 'merge') {
  cmdMerge();
} else {
  console.log('用法:');
  console.log('  node src/cli.js scan --shard 0 --shards 4');
  console.log('  node src/cli.js merge --shards 4');
  process.exit(cmd ? 1 : 0);
}
