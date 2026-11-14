// Pure core for treasury-yields-rates-today-mcp. The only I/O is keyless reads of the U.S. Treasury daily interest rate XML feed
// (par yield curve, bill rates, real yield curve), done through an injected fetchText and parsed with plain regexes.
//
// Source (public, no key):
//   https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml
//     ?data=daily_treasury_yield_curve|daily_treasury_bill_rates|daily_treasury_real_yield_curve
//     &field_tdr_date_value_month=YYYYMM   or   &field_tdr_date_value=YYYY
//
// The feed can take 15 to 20 seconds to answer a cold request (measured 2026-11-14), so answers are cached: the current
// month for an hour, closed months and years for a week. api.fiscaldata.treasury.gov is not used: it refused Cloudflare
// Workers with HTTP 525 when measured.
import type { FetchText } from './types.js';

export const REPO = 'treasury-yields-rates-today-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;

export const BASE = 'https://home.treasury.gov';
export const SOURCE = 'U.S. Department of the Treasury, Daily Treasury Rates (home.treasury.gov). Percent per year; Treasury publishes after about 3:30 pm ET on business days.';
export const FIRST_DATE = '1990-01-02';
export const MAX_HISTORY_DAYS = 731;

export class InputError extends Error {}
export class UpstreamError extends Error {}

export type Feed = 'daily_treasury_yield_curve' | 'daily_treasury_bill_rates' | 'daily_treasury_real_yield_curve';
export interface Row { date: string; values: Record<string, number> }

export const NOMINAL: [string, string][] = [
  ['BC_1MONTH', '1 Mo'], ['BC_1_5MONTH', '1.5 Mo'], ['BC_2MONTH', '2 Mo'], ['BC_3MONTH', '3 Mo'], ['BC_4MONTH', '4 Mo'],
  ['BC_6MONTH', '6 Mo'], ['BC_1YEAR', '1 Yr'], ['BC_2YEAR', '2 Yr'], ['BC_3YEAR', '3 Yr'], ['BC_5YEAR', '5 Yr'],
  ['BC_7YEAR', '7 Yr'], ['BC_10YEAR', '10 Yr'], ['BC_20YEAR', '20 Yr'], ['BC_30YEAR', '30 Yr'],
];
export const REAL: [string, string][] = [['TC_5YEAR', '5 Yr'], ['TC_7YEAR', '7 Yr'], ['TC_10YEAR', '10 Yr'], ['TC_20YEAR', '20 Yr'], ['TC_30YEAR', '30 Yr']];
export const BILLS: [string, string][] = [
  ['4WK', '4 week'], ['6WK', '6 week'], ['8WK', '8 week'], ['13WK', '13 week'], ['17WK', '17 week'], ['26WK', '26 week'], ['52WK', '52 week'],
];

/** "10y", "10 yr", "10-year", "3m", "3 month", "1.5mo" -> the nominal field name. */
export function tenorField(t: string): string | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*-?\s*(m|mo|mos|mon|month|months|y|yr|yrs|year|years)\s*$/i.exec(t);
  if (!m) return null;
  const unit = m[2].toLowerCase().startsWith('m') ? 'Mo' : 'Yr';
  const hit = NOMINAL.find(([, label]) => label === `${m[1]} ${unit}`);
  return hit ? hit[0] : null;
}

export function parseFeed(xml: string): Row[] {
  const rows: Row[] = [];
  for (const block of xml.split('<m:properties>').slice(1)) {
    const body = block.slice(0, block.indexOf('</m:properties>'));
    const values: Record<string, number> = {};
    let date = '';
    for (const m of body.matchAll(/<d:(\w+)[^>]*>([^<]*)<\/d:\1>/g)) {
      if (m[1] === 'NEW_DATE' || m[1] === 'INDEX_DATE') date = m[2].slice(0, 10);
      else if (m[2] !== '' && !isNaN(Number(m[2]))) values[m[1]] = Number(m[2]);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) rows.push({ date, values });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function feedUrl(feed: Feed, p: string): string {
  const key = p.length === 6 ? 'field_tdr_date_value_month' : 'field_tdr_date_value';
  return `${BASE}/resource-center/data-chart-center/interest-rates/pages/xml?data=${feed}&${key}=${p}`;
}

/** One month (YYYYMM) or one year (YYYY) of a feed. */
export async function period(f: FetchText, feed: Feed, p: string, now = new Date()): Promise<Row[]> {
  const cur = now.toISOString().slice(0, 7).replace('-', '');
  const open = p.length === 6 ? p >= cur : p >= cur.slice(0, 4);
  const xml = await f(feedUrl(feed, p), { cacheTtl: open ? 3600 : 7 * 86400, timeoutMs: 45000, accept: 'application/atom+xml,application/xml,text/xml' });
  if (!xml.includes('<feed')) throw new UpstreamError('home.treasury.gov returned something that is not the rates feed');
  return parseFeed(xml);
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Every row of a feed with from <= date <= to, fetched by month for short ranges and by year for long ones. */
export async function range(f: FetchText, feed: Feed, from: string, to: string, now = new Date()): Promise<Row[]> {
  const months = monthsBetween(from, to);
  const periods = months.length <= 4 ? months : [...new Set(months.map((m) => m.slice(0, 4)))];
  const parts = await Promise.all(periods.map((p) => period(f, feed, p, now)));
  return parts.flat().filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The requested date (or the latest), the business day before it and the row about a month earlier. */
export async function around(f: FetchText, feed: Feed, date: string | undefined, now = new Date()): Promise<{ row: Row; prev?: Row; monthAgo?: Row; exact: boolean }> {
  const target = date ?? now.toISOString().slice(0, 10);
  const rows = await range(f, feed, addDays(target, -40), target, now);
  if (!rows.length) throw new UpstreamError(`Treasury published no ${feed.replace(/_/g, ' ')} on or in the 40 days before ${target}`);
  const i = rows.length - 1;
  const row = rows[i];
  const monthAgoDate = addDays(row.date, -30);
  const monthAgo = [...rows].reverse().find((r) => r.date <= monthAgoDate);
  return { row, prev: rows[i - 1], monthAgo, exact: row.date === target };
}

export const fmt = (v: number | undefined) => (v === undefined ? '  n/a' : v.toFixed(2).padStart(5));
export const bp = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? null : Math.round((a - b) * 100));
export function delta(a: number | undefined, b: number | undefined): string {
  const d = bp(a, b);
  return d === null ? '    ' : `${d > 0 ? '+' : ''}${d}bp`.padStart(6);
}
const r2 = (x: number) => Math.round(x * 100) / 100;

const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
function checkDate(d: string | undefined, now: Date): void {
  if (d === undefined) return;
  if (!isDate(d)) throw new InputError('date must be YYYY-MM-DD');
  if (d < FIRST_DATE) throw new InputError(`Treasury daily rates start on ${FIRST_DATE}`);
  if (d > now.toISOString().slice(0, 10)) throw new InputError('date is in the future');
}
function dateNote(asked: string | undefined, got: string, exact: boolean): string {
  if (!asked) return `Latest published: ${got}`;
  return exact ? `Date: ${got}` : `Date: ${got} (no rates were published for ${asked}; this is the business day before)`;
}
const base = (now: Date) => ({ unit: 'percent per year', as_of: now.toISOString(), source: SOURCE, more: more() });

export async function yieldCurve(f: FetchText, a: { date?: string }, now = new Date()) {
  checkDate(a.date, now);
  const { row, prev, monthAgo, exact } = await around(f, 'daily_treasury_yield_curve', a.date, now);
  const v = row.values;
  const lines = [dateNote(a.date, row.date, exact), '', `Tenor   Yield  vs ${prev?.date ?? 'prev'}  vs ${monthAgo?.date ?? 'month ago'}`];
  const curve: { tenor: string; yield: number; change_bp_prev_day: number | null; change_bp_month: number | null }[] = [];
  for (const [k, label] of NOMINAL) {
    if (v[k] === undefined) continue;
    lines.push(`${label.padEnd(6)}  ${fmt(v[k])}  ${delta(v[k], prev?.values[k])}         ${delta(v[k], monthAgo?.values[k])}`);
    curve.push({ tenor: label, yield: v[k], change_bp_prev_day: bp(v[k], prev?.values[k]), change_bp_month: bp(v[k], monthAgo?.values[k]) });
  }
  const s210 = bp(v.BC_10YEAR, v.BC_2YEAR), s3m10 = bp(v.BC_10YEAR, v.BC_3MONTH);
  lines.push('');
  if (s210 !== null) lines.push(`10y - 2y spread: ${s210} bp${s210 < 0 ? ' (INVERTED)' : ''}`);
  if (s3m10 !== null) lines.push(`10y - 3m spread: ${s3m10} bp${s3m10 < 0 ? ' (INVERTED)' : ''}`);
  lines.push('', 'Par yields (bond-equivalent) on the most recently auctioned securities. bp = basis points (0.01%).');
  return {
    summary: lines.join('\n'), date: row.date, exact_date: exact, previous_date: prev?.date ?? null, month_ago_date: monthAgo?.date ?? null,
    ten_year: v.BC_10YEAR ?? null, two_year: v.BC_2YEAR ?? null, spread_10y_2y_bp: s210, spread_10y_3m_bp: s3m10,
    inverted_10y_2y: s210 === null ? null : s210 < 0, curve, ...base(now),
  };
}

export async function yieldHistory(f: FetchText, a: { tenor: string; start?: string; end?: string }, now = new Date()) {
  const field = tenorField(String(a.tenor ?? ''));
  if (!field) throw new InputError(`unknown tenor "${a.tenor}"; use one of 1m, 1.5m, 2m, 3m, 4m, 6m, 1y, 2y, 3y, 5y, 7y, 10y, 20y, 30y`);
  const today = now.toISOString().slice(0, 10);
  const to = a.end ?? today;
  const from = a.start ?? addDays(to, -30);
  if (!isDate(from) || !isDate(to) || from > to) throw new InputError('start and end must be YYYY-MM-DD with start <= end');
  if (from < FIRST_DATE) throw new InputError(`Treasury daily rates start on ${FIRST_DATE}`);
  const span = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (span > MAX_HISTORY_DAYS) throw new InputError(`ranges are limited to ${MAX_HISTORY_DAYS} days per call; split the request`);
  const rows = (await range(f, 'daily_treasury_yield_curve', from, to, now)).filter((r) => r.values[field] !== undefined);
  const label = NOMINAL.find(([k]) => k === field)![1];
  if (!rows.length) throw new InputError(`no ${label} yields were published between ${from} and ${to}`);
  const xs = rows.map((r) => r.values[field]);
  const max = Math.max(...xs), min = Math.min(...xs), mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const first = rows[0], last = rows[rows.length - 1];
  const hi = rows.find((r) => r.values[field] === max)!, lo = rows.find((r) => r.values[field] === min)!;
  const lines = [
    `${label} Treasury par yield, ${first.date} to ${last.date} (${rows.length} business days)`,
    `Start ${first.values[field].toFixed(2)}%  End ${last.values[field].toFixed(2)}%  Change ${delta(last.values[field], first.values[field]).trim()}`,
    `High ${max.toFixed(2)}% on ${hi.date}  Low ${min.toFixed(2)}% on ${lo.date}  Average ${mean.toFixed(2)}%`,
    '',
  ];
  const step = rows.length > 60 ? Math.ceil(rows.length / 52) : rows.length > 25 ? 5 : 1;
  lines.push(step === 1 ? 'Daily:' : `Every ${step}th business day:`);
  const table: { date: string; yield: number }[] = [];
  for (let i = 0; i < rows.length; i += step) table.push({ date: rows[i].date, yield: rows[i].values[field] });
  if ((rows.length - 1) % step !== 0) table.push({ date: last.date, yield: last.values[field] });
  for (const t of table) lines.push(`  ${t.date}  ${fmt(t.yield)}`);
  return {
    summary: lines.join('\n'), tenor: label, start_date: first.date, end_date: last.date, business_days: rows.length,
    start: first.values[field], end: last.values[field], change_bp: bp(last.values[field], first.values[field]),
    high: { yield: max, date: hi.date }, low: { yield: min, date: lo.date }, average: r2(mean), table, ...base(now),
  };
}

export async function billRates(f: FetchText, a: { date?: string }, now = new Date()) {
  checkDate(a.date, now);
  const { row, prev, exact } = await around(f, 'daily_treasury_bill_rates', a.date, now);
  const v = row.values;
  const lines = [dateNote(a.date, row.date, exact), '', 'Bill      Discount  Coupon-equiv  vs prev day'];
  const bills: { bill: string; discount_rate: number | null; coupon_equivalent: number | null; change_bp_prev_day: number | null }[] = [];
  for (const [k, label] of BILLS) {
    const d = v[`ROUND_B1_CLOSE_${k}_2`], y = v[`ROUND_B1_YIELD_${k}_2`];
    if (d === undefined && y === undefined) continue;
    lines.push(`${label.padEnd(8)}  ${fmt(d)}     ${fmt(y)}        ${delta(y, prev?.values[`ROUND_B1_YIELD_${k}_2`])}`);
    bills.push({ bill: label, discount_rate: d ?? null, coupon_equivalent: y ?? null, change_bp_prev_day: bp(y, prev?.values[`ROUND_B1_YIELD_${k}_2`]) });
  }
  lines.push('', 'Discount = bank discount rate (closing bid). Coupon-equivalent = the investment yield to compare with notes, CDs and savings.');
  return { summary: lines.join('\n'), date: row.date, exact_date: exact, previous_date: prev?.date ?? null, bills, ...base(now) };
}

export async function realYields(f: FetchText, a: { date?: string }, now = new Date()) {
  checkDate(a.date, now);
  const [real, nominal] = await Promise.all([
    around(f, 'daily_treasury_real_yield_curve', a.date, now),
    around(f, 'daily_treasury_yield_curve', a.date, now),
  ]);
  const sameDay = real.row.date === nominal.row.date;
  const lines = [dateNote(a.date, real.row.date, real.exact), '', 'Tenor   Real  Nominal  Breakeven  real vs prev'];
  const rows: { tenor: string; real: number; nominal: number | null; breakeven: number | null; real_change_bp_prev_day: number | null }[] = [];
  for (const [k, label] of REAL) {
    const r = real.row.values[k];
    if (r === undefined) continue;
    const n = sameDay ? nominal.row.values[`BC_${k.slice(3)}`] : undefined;
    lines.push(`${label.padEnd(6)} ${fmt(r)}  ${fmt(n)}    ${n === undefined ? '  n/a' : fmt(n - r)}     ${delta(r, real.prev?.values[k])}`);
    rows.push({ tenor: label, real: r, nominal: n ?? null, breakeven: n === undefined ? null : r2(n - r), real_change_bp_prev_day: bp(r, real.prev?.values[k]) });
  }
  if (!sameDay) lines.push('', `Nominal rates for ${real.row.date} are not published yet, so breakevens are omitted.`);
  lines.push('', 'Breakeven = nominal par yield minus TIPS real yield for the same maturity: the average inflation the market is pricing.');
  return { summary: lines.join('\n'), date: real.row.date, exact_date: real.exact, yields: rows, ...base(now) };
}
