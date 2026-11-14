// Fixtures in test/fixtures/ are the U.S. Treasury daily rate XML feeds for November 2026, downloaded 2026-11-14
// (business days 2026-11-02 to 2026-11-13, no row for the 2026-11-11 holiday). Expected values are read off those files:
// 10 Yr 4.91 on 11-02, 4.86 on 11-06, 5.15 on 11-13; 2 Yr 4.51 on 11-06, 4.88 on 11-13; 3 Mo 4.19 and 4.32;
// 4-week bill 3.95 discount / 4.02 coupon-equivalent on 11-13 (4.04 on 11-12); 10-year TIPS 2.91 and 5-year 2.68 on 11-13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  parseFeed, tenorField, monthsBetween, delta, yieldCurve, yieldHistory, billRates, realYields, InputError, UpstreamError, UTM,
} from '../dist/core.js';

const XML = Object.fromEntries(['daily_treasury_yield_curve', 'daily_treasury_bill_rates', 'daily_treasury_real_yield_curve']
  .map((n) => [n, readFileSync(new URL(`./fixtures/${n}.xml`, import.meta.url), 'utf8')]));
const EMPTY = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';
const seen = [];
// November 2026 is served for the month request and for the 2026 year request; every other month or year is an empty feed.
const f = async (u) => {
  seen.push(u);
  const m = /^https:\/\/home\.treasury\.gov\/resource-center\/data-chart-center\/interest-rates\/pages\/xml\?data=([a-z_]+)&(field_tdr_date_value_month=202611|field_tdr_date_value=2026)$/.exec(u);
  if (m) return XML[m[1]];
  if (u.startsWith('https://home.treasury.gov/')) return EMPTY;
  throw new Error(`HTTP 404 (no fixture for ${u})`);
};
const NOW = new Date('2026-11-14T12:00:00Z');

test('feed parsing reads dates and every numeric field', () => {
  const rows = parseFeed(XML.daily_treasury_yield_curve);
  assert.equal(rows.length, 9); assert.equal(rows[0].date, '2026-11-02'); assert.equal(rows[0].values.BC_10YEAR, 4.91); assert.equal(rows[0].values.BC_1_5MONTH, 4.09);
  assert.ok(!rows.some((r) => r.date === '2026-11-11'));
  assert.equal(parseFeed(XML.daily_treasury_bill_rates)[0].values.ROUND_B1_YIELD_4WK_2, 3.97);
  assert.equal(parseFeed(XML.daily_treasury_real_yield_curve)[0].values.TC_10YEAR, 2.62);
  assert.deepEqual(parseFeed(EMPTY), []);
});

test('tenor names, month ranges and basis-point deltas', () => {
  assert.equal(tenorField('10y'), 'BC_10YEAR'); assert.equal(tenorField('3 month'), 'BC_3MONTH'); assert.equal(tenorField('1.5m'), 'BC_1_5MONTH');
  assert.equal(tenorField('10-year'), 'BC_10YEAR'); assert.equal(tenorField('11y'), null);
  assert.deepEqual(monthsBetween('2025-11-20', '2026-02-01'), ['202511', '202512', '202601', '202602']);
  assert.equal(delta(5.15, 5.10).trim(), '+5bp'); assert.equal(delta(4.0, 4.25).trim(), '-25bp');
});

test('yield curve latest: 2026-11-13, 10-year 5.15 (+5 bp), 2-year 4.88, 10y-2y 27 bp, 10y-3m 83 bp, not inverted', async () => {
  const r = await yieldCurve(f, {}, NOW);
  assert.equal(r.date, '2026-11-13'); assert.equal(r.previous_date, '2026-11-12'); assert.equal(r.ten_year, 5.15); assert.equal(r.two_year, 4.88);
  assert.equal(r.spread_10y_2y_bp, 27); assert.equal(r.spread_10y_3m_bp, 83); assert.equal(r.inverted_10y_2y, false);
  assert.equal(r.curve.find((c) => c.tenor === '10 Yr').change_bp_prev_day, 5);
  assert.match(r.summary, /^Latest published: 2026-11-13/); assert.ok(r.more.includes(UTM));
});

test('yield curve on a Sunday answers with the Friday before: 2026-11-08 gives 2026-11-06, 10-year 4.86, 10y-2y 35 bp', async () => {
  const r = await yieldCurve(f, { date: '2026-11-08' }, NOW);
  assert.equal(r.date, '2026-11-06'); assert.equal(r.exact_date, false); assert.equal(r.ten_year, 4.86); assert.equal(r.spread_10y_2y_bp, 35); assert.equal(r.spread_10y_3m_bp, 67);
  assert.match(r.summary, /no rates were published for 2026-11-08/); assert.match(r.summary, /10 Yr {4}4\.86/);
});

test('yield history 10y 2026-11-01 to 2026-11-13: 9 days, 4.91 to 5.15, +24 bp, high 5.15, low 4.84 on 11-05, average 4.95', async () => {
  const r = await yieldHistory(f, { tenor: '10y', start: '2026-11-01', end: '2026-11-13' }, NOW);
  assert.equal(r.business_days, 9); assert.equal(r.start, 4.91); assert.equal(r.end, 5.15); assert.equal(r.change_bp, 24);
  assert.deepEqual(r.high, { yield: 5.15, date: '2026-11-13' }); assert.deepEqual(r.low, { yield: 4.84, date: '2026-11-05' }); assert.equal(r.average, 4.95);
  assert.equal(r.table.length, 9);
});

test('yield history over five months reads whole years: 2025 and 2026 feeds', async () => {
  seen.length = 0;
  const r = await yieldHistory(f, { tenor: '2y', start: '2025-06-01', end: '2026-11-13' }, NOW);
  assert.equal(r.business_days, 9); assert.equal(r.end, 4.88);
  assert.ok(seen.some((u) => u.endsWith('field_tdr_date_value=2025'))); assert.ok(seen.some((u) => u.endsWith('field_tdr_date_value=2026')));
});

test('T-bill rates 2026-11-13: 4-week 3.95 discount, 4.02 coupon-equivalent, -2 bp; 52-week 4.63', async () => {
  const r = await billRates(f, { date: '2026-11-13' }, NOW);
  assert.equal(r.exact_date, true);
  assert.deepEqual(r.bills[0], { bill: '4 week', discount_rate: 3.95, coupon_equivalent: 4.02, change_bp_prev_day: -2 });
  assert.equal(r.bills.find((b) => b.bill === '52 week').coupon_equivalent, 4.63);
});

test('real yields 2026-11-13: 10-year TIPS 2.91, nominal 5.15, breakeven 2.24; 5-year breakeven 2.30', async () => {
  const r = await realYields(f, { date: '2026-11-13' }, NOW);
  const ten = r.yields.find((y) => y.tenor === '10 Yr'), five = r.yields.find((y) => y.tenor === '5 Yr');
  assert.deepEqual(ten, { tenor: '10 Yr', real: 2.91, nominal: 5.15, breakeven: 2.24, real_change_bp_prev_day: 5 });
  assert.equal(five.breakeven, 2.3);
});

test('input errors: bad tenor, reversed or too long ranges, dates before 1990 or in the future; empty months are upstream errors', async () => {
  await assert.rejects(yieldHistory(f, { tenor: '11y' }, NOW), InputError);
  await assert.rejects(yieldHistory(f, { tenor: '10y', start: '2026-11-13', end: '2026-11-01' }, NOW), InputError);
  await assert.rejects(yieldHistory(f, { tenor: '10y', start: '2023-01-01', end: '2026-11-13' }, NOW), InputError);
  await assert.rejects(yieldCurve(f, { date: '1989-12-29' }, NOW), InputError);
  await assert.rejects(yieldCurve(f, { date: '2026-12-01' }, NOW), InputError);
  await assert.rejects(yieldCurve(f, { date: '2026-02-30x' }, NOW), InputError);
  await assert.rejects(yieldCurve(f, { date: '2026-09-15' }, NOW), UpstreamError);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'treasury-yields-rates-today-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['treasury_yield_curve', 'treasury_yield_history', 'treasury_bill_rates', 'treasury_real_yields']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'treasury_yield_history', arguments: { tenor: '11y' } } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
