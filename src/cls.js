'use strict';

/**
 * 财联社 cls.cn 客户端（news-crawler 独立副本，不引用 dashboard）。
 * 仅保留分片扫描所需：签名、个股新闻列表、栏目前缀匹配。
 */

const crypto = require('node:crypto');

const WEB_HOST = 'https://www.cls.cn';
const APP = 'CailianpressWeb';
const SV = '8.7.9';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pair(prefix, value) {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return prefix + '=' + String(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return prefix + '[]';
    return value
      .map((v, i) => pair(prefix + '[' + i + ']', v))
      .filter(Boolean)
      .join('&');
  }
  if (t === 'object') {
    return Object.keys(value)
      .sort()
      .map((k) => pair(prefix + '[' + k + ']', value[k]))
      .filter(Boolean)
      .join('&');
  }
  return null;
}

function queryString(params) {
  return Object.keys(params)
    .sort()
    .map((k) => pair(k, params[k]))
    .filter(Boolean)
    .join('&');
}

function signQuery(qs) {
  const sha1 = crypto.createHash('sha1').update(qs, 'utf8').digest('hex');
  return crypto.createHash('md5').update(sha1, 'utf8').digest('hex');
}

async function httpGet(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Referer: WEB_HOST + '/',
        Accept: 'application/json, text/plain, */*',
      },
    });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function api(path, params = {}, { retries = 3, timeout = 20000 } = {}) {
  const p = Object.assign({ os: 'web', sv: SV, app: APP }, params);
  const qs = queryString(p);
  const url = new URL(WEB_HOST + path);
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('sign', signQuery(qs));

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { status, text } = await httpGet(url.toString(), { timeout });
      if (status >= 400) throw new Error('HTTP ' + status);
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function fetchStockArticles(code, { sinceSec, maxPages = 60 } = {}) {
  const cutoff = sinceSec || Math.floor(Date.now() / 1000) - 7 * 86400;
  const out = [];
  const seen = new Set();
  let lastTime = Math.floor(Date.now() / 1000);

  for (let page = 0; page < maxPages; page++) {
    const body = await api('/es/quotes/articles', {
      keyword: code,
      lastTime,
      rn: 10,
    });
    const list = body && body.data;
    if (!Array.isArray(list) || list.length === 0) break;

    let oldest = Infinity;
    for (const item of list) {
      if (!item || !item.id) continue;
      if (item.ctime < oldest) oldest = item.ctime;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    if (list.length < 10) break;
    if (!isFinite(oldest) || oldest <= cutoff) break;
    lastTime = oldest;
    await sleep(80);
  }

  return out.filter((it) => it.ctime >= cutoff);
}

function titlePrefix(title) {
  const m = /^\s*[【\[]([^】\]]{1,20})[】\]]/.exec(title || '');
  return m ? m[1].trim() : '';
}

function matchPrefix(title, prefixes) {
  const p = titlePrefix(title);
  if (!p) return '';
  for (const want of prefixes) {
    if (p === want) return p;
    if (p.length > want.length && /^[\s·・\-—_]/.test(p.slice(want.length))) return p;
  }
  return '';
}

async function fetchVipArticles({ lastTime } = {}) {
  const body = await api('/featured/v2/home/recommend/article', {
    last_time: String(lastTime || Math.floor(Date.now() / 1000)),
    refresh_Type: '1',
  });
  const data = body && body.data;
  return Array.isArray(data) ? data : [];
}

function vipHasStock(item) {
  const rs = item && item.related_stock;
  if (!Array.isArray(rs)) return false;
  const stockMarkets = new Set(['主板', '创业板', '科创板', '北交所']);
  return rs.some((s) => s && stockMarkets.has(s.market) && Number(s.count || 0) > 0);
}

module.exports = {
  fetchStockArticles,
  fetchVipArticles,
  vipHasStock,
  titlePrefix,
  matchPrefix,
  sleep,
};
