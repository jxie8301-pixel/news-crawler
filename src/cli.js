'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadConfig } = require('./config.js');
const { scanShard } = require('./scan.js');
const { mergeShards } = require('./merge.js');
const { checkVipGate } = require('./vip_gate.js');
const { hydrateFromMerged } = require('./hydrate.js');
const collectMod = require('./collect.js');
const report = require('./report.js');
const research = require('./research.js');
const notify = require('./notify.js');
const cls = require('./cls.js');

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

function withPoolNames(rows, names) {
  return rows.map(function (r) {
    r.poolNames = (r.pools || []).map(function (k) { return names[k] || k; });
    return r;
  });
}

function rangeLabel(days) {
  const nowSec = Math.floor(Date.now() / 1000);
  return cls.fmtTime(nowSec - days * 86400).slice(0, 10) + ' ~ ' + cls.fmtTime(nowSec).slice(0, 10);
}

function loadVipIdsFromGate() {
  const gatePath = path.join(OUT_DIR, 'vip-gate.json');
  try {
    const j = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
    if (Array.isArray(j.curIds) && j.curIds.length) return j.curIds.map(String);
  } catch (_) { /* ignore */ }
  return [];
}

async function cmdGate() {
  const force = process.argv.includes('--force') || process.argv.includes('--no-gate');
  const assumeNewVip = process.argv.includes('--assume-new-vip');
  const result = await checkVipGate({ force: force, assumeNewVip: assumeNewVip });

  console.log('[vip] VIP 列表 ' + result.vipTotal
    + ' ｜ 有效（带个股且非ETF）' + result.eligible
    + ' ｜ 水位已知 ' + result.lastCount
    + ' ｜ 相对水位新增 ' + result.newCount
    + (result.forced ? ' ｜ --force 强制扫描' : '')
    + (result.assumeNewVip ? ' ｜ --assume-new-vip' : '')
    + (result.fetchError ? ' ｜ fetchError软继续' : ''));

  (result.sampleTitles || []).forEach(function (t) {
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

  if (result.aborted) process.exit(4);
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

  if (!merged.ok) process.exit(4);
}

async function cmdPost() {
  const cfg = collectMod.loadConfig();
  const days = parseInt(arg('days', cfg.days || 1), 10);
  const noPush = process.argv.includes('--no-push');
  const noResearch = process.argv.includes('--no-research');
  const siteLinks = process.argv.includes('--site-links');

  const hyd = await hydrateFromMerged({
    onProgress: function (p) {
      if (p.phase === 'text') {
        process.stdout.write('\r[hydrate] 正文 ' + p.done + '/' + p.total
          + '  newText=' + p.stats.newText + '   ');
      }
    },
  });
  if (hyd.ok === false) {
    console.log('');
    console.log('[post] merge 失败，本轮作废（exit 4）: ' + (hyd.reason || ''));
    process.exit(4);
  }
  console.log('');
  console.log('[hydrate] 注入 ' + hyd.stats.injected
    + ' ｜ 命中栏目 ' + hyd.stats.matched
    + ' ｜ 新正文 ' + hyd.stats.newText
    + ' ｜ 行情 ' + hyd.stats.enriched);

  const pools = collectMod.loadPools();
  const names = {};
  pools.forEach(function (p) { names[p.key] = p.name; });
  const store = hyd.store || collectMod.loadStore();
  const rows = withPoolNames(collectMod.rows(store, { days: days, pool: 'all-a' }), names);

  if (!noResearch) {
    let lastResearchLog = 0;
    const rr = await research.enrichRows(rows, {
      config: cfg,
      onProgress: function (s) {
        const now = Date.now();
        if (now - lastResearchLog < 1500 && s.done < s.total) return;
        lastResearchLog = now;
        process.stdout.write('\r调研 ' + s.done + '/' + s.total
          + ' ｜ 缓存 ' + s.cached + ' ｜ 失败 ' + s.errors + '   ');
      },
    });
    if (rr.refreshed) console.log('');
    console.log('调研结论：股票 ' + rr.total + ' 只 ｜ 本轮更新 ' + rr.refreshed
      + ' ｜ 使用缓存 ' + rr.cached + ' ｜ 失败 ' + rr.errors);
  } else {
    research.attachRows(rows);
  }

  const meta = {
    title: '财联社 沪深A股(非ST) · 目标栏目新闻',
    range: rangeLabel(days),
    poolLabel: '沪深A股(非ST)',
    generatedAt: new Date().toLocaleString('zh-CN'),
  };
  const out = report.exportAll(rows, meta, {
    fileBase: 'cls-news',
    layout: 'table',
    links: siteLinks ? [{ href: 'cards/', label: '卡片版' }, { href: 'perf/', label: '推送复盘' }] : [],
    alsoCards: true,
    cardsLinks: siteLinks ? [{ href: '../', label: '表格版' }, { href: '../perf/', label: '推送复盘' }] : [],
  });
  console.log('表格共 ' + rows.length + ' 条，已导出：');
  console.log('  ' + out.csvPath);
  console.log('  ' + out.htmlPath);
  console.log('  ' + out.jsonPath);
  if (out.cardsPath) console.log('  ' + out.cardsPath);

  const curVipIds = loadVipIdsFromGate();
  const rowArticleIds = new Set(rows.map(function (r) { return String(r.articleId || '').split('#')[0]; }).filter(Boolean));
  const missingVip = (curVipIds || []).filter(function (id) { return !rowArticleIds.has(String(id)); });
  if (missingVip.length) {
    console.warn('[post] VIP 已门控但扫描未命中（通常索引延迟）: ' + missingVip.slice(0, 10).join(','));
  }

  const nowMs = Date.now();
  const statusPath = path.join(report.OUT_DIR, 'status.json');
  let prevVip = [];
  try { prevVip = JSON.parse(fs.readFileSync(statusPath, 'utf8')).lastVipIds || []; } catch (_) {}
  fs.writeFileSync(statusPath, JSON.stringify({
    publishedAt: nowMs,
    publishedAtShanghai: cls.fmtTime(Math.floor(nowMs / 1000)),
    range: meta.range,
    poolLabel: meta.poolLabel,
    days: days,
    rows: rows.length,
    pipeline: 'v2-matrix',
    lastVipIds: curVipIds.length ? curVipIds : prevVip,
  }, null, 2), 'utf8');
  console.log('  ' + statusPath);

  const notifyEnabled = !cfg.notify || cfg.notify.enabled !== false;
  if (notifyEnabled && !noPush) {
    await notify.pushNew(rows, {
      config: cfg,
      dryRun: process.argv.includes('--dry-run-push'),
    });
  } else {
    console.log('[post] 跳过企微推送（disabled / --no-push）');
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
} else if (cmd === 'post') {
  cmdPost().catch(function (e) {
    console.error('[post] 失败:', e);
    process.exit(1);
  });
} else if (cmd === 'perf') {
  require('./push_perf.js');
} else if (cmd === 'shadow') {
  require('./shadow_report.js').writeShadowReport({}).catch(function (e) {
    console.error('[shadow] 失败:', e);
    process.exit(1);
  });
} else {
  console.log('用法 (cls-news v2):');
  console.log('  node src/cli.js gate [--force] [--assume-new-vip]');
  console.log('  node src/cli.js scan --shard 0 --shards 5');
  console.log('  node src/cli.js merge --shards 5');
  console.log('  node src/cli.js post [--site-links] [--no-push] [--no-research]');
  console.log('  node src/cli.js shadow');
  console.log('  node src/cli.js perf');
  process.exit(cmd ? 1 : 0);
}
