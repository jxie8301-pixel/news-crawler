'use strict';

/**
 * VIP 差集门控（独立实现，不引用 dashboard）。
 * 默认对照 Pages 上 cls-news 的 status.json.lastVipIds。
 */

const fs = require('node:fs');
const https = require('node:https');
const { URL } = require('node:url');
const cls = require('./cls.js');
const { loadConfig } = require('./config.js');

const DEFAULT_STATUS_URL = 'https://jxie8301-pixel.github.io/cls-news/status.json';
const SKIP_TITLE_KWS = ['玩转ETF'];

function httpGetJson(urlStr, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'news-crawler-vip-gate', Accept: 'application/json' },
        timeout: timeoutMs || 20000,
      },
      function (res) {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error('HTTP ' + res.statusCode));
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
      reject(new Error('timeout'));
    });
  });
}

async function loadLastVipIds(cfg) {
  const local = cfg && cfg.lastVipIdsFile;
  if (local && fs.existsSync(local)) {
    try {
      const j = JSON.parse(fs.readFileSync(local, 'utf8'));
      if (Array.isArray(j.lastVipIds)) return j.lastVipIds.map(String);
      if (Array.isArray(j)) return j.map(String);
    } catch (_) { /* fallthrough */ }
  }
  const url = (cfg && cfg.statusUrl) || DEFAULT_STATUS_URL;
  const st = await httpGetJson(url, 20000);
  return Array.isArray(st.lastVipIds) ? st.lastVipIds.map(String) : [];
}

function eligibleVipItems(items) {
  return (items || []).filter(function (it) {
    if (!cls.vipHasStock(it)) return false;
    const title = String(it.title || '');
    if (SKIP_TITLE_KWS.some(function (kw) { return title.indexOf(kw) !== -1; })) return false;
    return true;
  });
}

/**
 * @returns {Promise<{
 *   shouldRun: boolean,
 *   vipTotal: number,
 *   eligible: number,
 *   newCount: number,
 *   newIds: string[],
 *   lastCount: number,
 *   curIds: string[],
 * }>}
 */
async function checkVipGate(opts) {
  opts = opts || {};
  const cfg = Object.assign(loadConfig(), opts);
  const force = !!opts.force || !!opts.noGate;
  const items = await cls.fetchVipArticles({});
  const eligible = eligibleVipItems(items);
  const curIds = eligible.map(function (it) { return String(it.id); });

  let lastIds = [];
  try {
    lastIds = await loadLastVipIds(cfg);
  } catch (e) {
    console.warn('[vip] 读取水位失败，视为无水位继续: ' + (e && e.message ? e.message : e));
  }

  const lastSet = new Set(lastIds);
  const newIds = curIds.filter(function (id) { return !lastSet.has(id); });
  const shouldRun = force || newIds.length > 0;

  return {
    shouldRun: shouldRun,
    forced: force,
    vipTotal: items.length,
    eligible: eligible.length,
    newCount: newIds.length,
    newIds: newIds,
    lastCount: lastIds.length,
    curIds: curIds,
    sampleTitles: eligible
      .filter(function (it) { return newIds.indexOf(String(it.id)) >= 0; })
      .slice(0, 5)
      .map(function (it) {
        return { id: String(it.id), title: String(it.title || '').slice(0, 80) };
      }),
  };
}

module.exports = {
  checkVipGate,
  eligibleVipItems,
  loadLastVipIds,
  DEFAULT_STATUS_URL,
};
