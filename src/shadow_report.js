'use strict';

/**
 * 影子对照：把本轮 v2 导出与现网 Pages 新闻集比对（只读生产站）。
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { URL } = require('node:url');
const { ROOT } = require('./config.js');

const OUT_DIR = path.join(ROOT, 'out');
const DEFAULT_PROD_NEWS = 'https://jxie8301-pixel.github.io/cls-news/news.json';
const DEFAULT_PROD_STATUS = 'https://jxie8301-pixel.github.io/cls-news/status.json';

function httpGetJson(urlStr, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'cls-news-v2-shadow', Accept: 'application/json' },
        timeout: timeoutMs || 30000,
      },
      function (res) {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error('HTTP ' + res.statusCode + ' ' + urlStr));
            return;
          }
          try { resolve(JSON.parse(data || '{}')); }
          catch (e) { reject(new Error('非 JSON: ' + data.slice(0, 120))); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      reject(new Error('timeout ' + urlStr));
    });
  });
}

function articleIdsFromNewsJson(j) {
  const rows = Array.isArray(j) ? j : (j && Array.isArray(j.rows) ? j.rows : []);
  const set = new Set();
  for (const r of rows) {
    const raw = String((r && (r.articleId || r.id)) || '');
    if (!raw) continue;
    const id = raw.split('#')[0];
    if (id) set.add(id);
  }
  return set;
}

function matchedIdsFromMerged(merged) {
  const set = new Set();
  const arts = (merged && merged.articles) || {};
  for (const id of Object.keys(arts)) {
    if (arts[id] && arts[id].matchedConfig) set.add(String(id));
  }
  return set;
}

function idsFromLocalExport(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  try {
    return articleIdsFromNewsJson(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (_) {
    return new Set();
  }
}

function sorted(set) {
  return Array.from(set).sort();
}

function diffSets(a, b) {
  const onlyA = [];
  const onlyB = [];
  for (const x of a) if (!b.has(x)) onlyA.push(x);
  for (const x of b) if (!a.has(x)) onlyB.push(x);
  onlyA.sort();
  onlyB.sort();
  return { onlyA: onlyA, onlyB: onlyB };
}

/**
 * @returns {Promise<object>}
 */
async function buildShadowReport(opts) {
  opts = opts || {};
  const prodNewsUrl = opts.prodNewsUrl || DEFAULT_PROD_NEWS;
  const prodStatusUrl = opts.prodStatusUrl || DEFAULT_PROD_STATUS;
  const localNews = opts.localNewsPath || path.join(OUT_DIR, 'cls-news-latest.json');
  const mergedPath = opts.mergedPath || path.join(OUT_DIR, 'merged.json');
  const gatePath = opts.gatePath || path.join(OUT_DIR, 'vip-gate.json');

  let prodNews = null;
  let prodStatus = null;
  const errors = [];
  try { prodNews = await httpGetJson(prodNewsUrl); }
  catch (e) { errors.push('prod news: ' + (e.message || e)); }
  try { prodStatus = await httpGetJson(prodStatusUrl); }
  catch (e) { errors.push('prod status: ' + (e.message || e)); }

  const prodIds = prodNews ? articleIdsFromNewsJson(prodNews) : new Set();
  const localIds = idsFromLocalExport(localNews);

  let mergedIds = new Set();
  let mergeOk = null;
  if (fs.existsSync(mergedPath)) {
    try {
      const merged = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
      mergeOk = !!merged.ok;
      mergedIds = matchedIdsFromMerged(merged);
    } catch (e) {
      errors.push('merged: ' + (e.message || e));
    }
  }

  let gate = null;
  if (fs.existsSync(gatePath)) {
    try { gate = JSON.parse(fs.readFileSync(gatePath, 'utf8')); }
    catch (_) { /* ignore */ }
  }

  const vsProd = diffSets(localIds, prodIds);
  const mergeVsLocal = diffSets(mergedIds, localIds);

  return {
    at: new Date().toISOString(),
    pipeline: 'v2-shadow',
    errors: errors,
    gate: gate ? {
      newCount: gate.newCount,
      eligible: gate.eligible,
      shouldRun: gate.shouldRun,
      forced: !!gate.forced,
    } : null,
    mergeOk: mergeOk,
    counts: {
      prodArticles: prodIds.size,
      localExport: localIds.size,
      mergedMatched: mergedIds.size,
      localOnlyVsProd: vsProd.onlyA.length,
      prodOnlyVsLocal: vsProd.onlyB.length,
      mergeOnlyVsLocal: mergeVsLocal.onlyA.length,
      localOnlyVsMerge: mergeVsLocal.onlyB.length,
    },
    sample: {
      localOnlyVsProd: vsProd.onlyA.slice(0, 20),
      prodOnlyVsLocal: vsProd.onlyB.slice(0, 20),
    },
    prodStatus: prodStatus ? {
      publishedAtShanghai: prodStatus.publishedAtShanghai || null,
      rows: prodStatus.rows || null,
      lastVipIds: Array.isArray(prodStatus.lastVipIds) ? prodStatus.lastVipIds.length : null,
    } : null,
  };
}

async function writeShadowReport(opts) {
  const report = await buildShadowReport(opts);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'shadow-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('[shadow] 对照完成');
  console.log('[shadow]   现网文章 ' + report.counts.prodArticles
    + ' ｜ 本轮导出 ' + report.counts.localExport
    + ' ｜ merge命中 ' + report.counts.mergedMatched);
  console.log('[shadow]   仅本轮有 ' + report.counts.localOnlyVsProd
    + ' ｜ 仅现网有 ' + report.counts.prodOnlyVsLocal);
  if (report.errors.length) {
    console.log('[shadow]   警告: ' + report.errors.join('; '));
  }
  console.log('[shadow] 已写入 ' + outPath);
  return { path: outPath, report: report };
}

module.exports = {
  buildShadowReport: buildShadowReport,
  writeShadowReport: writeShadowReport,
  DEFAULT_PROD_NEWS: DEFAULT_PROD_NEWS,
  DEFAULT_PROD_STATUS: DEFAULT_PROD_STATUS,
};
