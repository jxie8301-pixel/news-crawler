'use strict';

/**
 * CNB / 本机冒烟：测出口能否拉 VIP + 个股新闻流（不全量、不推送）。
 *
 * 用法:
 *   node scripts/cnb-stock-smoke.js
 *   SMOKE_CODES=sz002975,sz300750 node scripts/cnb-stock-smoke.js
 */

const https = require('node:https');
const cls = require('../src/cls.js');

const CODES = String(process.env.SMOKE_CODES || 'sz002975,sz300750,sh688981')
  .split(/[,;\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);

function getText(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = https.get(url, { timeout: timeoutMs || 10000 }, function (res) {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        resolve({ status: res.statusCode || 0, body: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    const ms = Date.now() - t0;
    console.log('[ok] ' + label + '  ' + ms + 'ms');
    return { ok: true, ms: ms, value: value };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log('[FAIL] ' + label + '  ' + ms + 'ms  ' + (e && e.message ? e.message : e));
    return { ok: false, ms: ms, error: String(e && e.message ? e.message : e) };
  }
}

async function main() {
  console.log('=== CNB stock-news smoke ===');
  console.log('time=' + new Date().toISOString());
  console.log('codes=' + CODES.join(','));

  const egress = await timed('egress-ip', async function () {
    const r = await getText('https://api.ipify.org?format=text', 8000);
    return String(r.body || '').trim();
  });
  if (egress.ok) console.log('  ip=' + egress.value);

  const vipDirect = await timed('vip-direct cls.cn', async function () {
    const items = await cls.fetchVipArticles({ preferFallback: false, timeout: 20000 });
    return items;
  });
  if (vipDirect.ok) {
    console.log('  count=' + vipDirect.value.length);
    (vipDirect.value || []).slice(0, 3).forEach(function (it) {
      console.log('  - ' + it.id + '  ' + String(it.title || '').slice(0, 48));
    });
  }

  const vipCf = await timed('vip-cf jxie.ccwu.cc/vip', async function () {
    const items = await cls.fetchVipArticles({ preferFallback: true, timeout: 20000 });
    return items;
  });
  if (vipCf.ok) console.log('  count=' + vipCf.value.length);

  const sinceSec = Math.floor(Date.now() / 1000) - 2 * 86400;
  let stockOk = 0;
  let stockFail = 0;
  let listed = 0;
  for (const code of CODES) {
    const r = await timed('stock ' + code, async function () {
      return cls.fetchStockArticles(code, { sinceSec: sinceSec, maxPages: 2 });
    });
    if (!r.ok) {
      stockFail++;
      continue;
    }
    stockOk++;
    listed += r.value.length;
    const sample = (r.value || []).slice(0, 2);
    console.log('  listed=' + r.value.length);
    sample.forEach(function (a) {
      console.log('  - ' + a.id + '  ' + String(a.title || '').slice(0, 40));
    });
    await cls.sleep(120);
  }

  console.log('=== summary ===');
  console.log('vipDirect=' + (vipDirect.ok ? 'ok' : 'fail')
    + ' vipCf=' + (vipCf.ok ? 'ok' : 'fail')
    + ' stockOk=' + stockOk + '/' + CODES.length
    + ' listed=' + listed);

  // 个股流才是采集核心；VIP 直连失败但 CF 成功也可接受
  if (stockOk === 0) process.exit(2);
  if (!vipDirect.ok && !vipCf.ok) process.exit(3);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
