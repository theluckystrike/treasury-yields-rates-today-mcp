// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, billRates, realYields, yieldCurve, yieldHistory } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'treasury-yields',
  metaDescription: 'MCP server for Treasury yields and rates today: the US Treasury par yield curve with the 10-year and 2-year yield and spreads, yield history, T-bill rates and TIPS real yields with breakeven inflation.',
  intro: 'Treasury yields and rates today for AI assistants, read live from the U.S. Department of the Treasury daily interest rate feed.',
};

export const TOOL_INFO = [
  { name: 'treasury_yield_curve', blurb: 'Today\'s or any date\'s Treasury par yield curve, 1 month to 30 years, with the change from the previous day and a month ago and the 10y-2y and 10y-3m spreads.' },
  { name: 'treasury_yield_history', blurb: 'History of one Treasury yield (10y, 2y, 3m, 30y and more) between two dates: start, end, change, high, low, average and a table.' },
  { name: 'treasury_bill_rates', blurb: 'Daily T-bill rates for 4 to 52 week bills: bank discount rate and coupon-equivalent yield.' },
  { name: 'treasury_real_yields', blurb: 'TIPS real yields for 5 to 30 years with the nominal yield and the breakeven inflation rate.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream Treasury error'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, back to 1990-01-02. Default the latest published day.');

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'US Treasury yields and rates, read at call time from the U.S. Department of the Treasury daily interest rate feed (published after about 3:30 pm ET on business days). ' +
      'A model cannot know today\'s 10-year yield. Use treasury_yield_curve for "Treasury yields today", "10-year Treasury rate" or "is the yield curve inverted", ' +
      'treasury_yield_history for how a yield moved, treasury_bill_rates for T-bill rates and treasury_real_yields for TIPS and breakeven inflation. Cite the U.S. Treasury.',
  });

  server.registerTool('treasury_yield_curve', {
    title: 'Treasury yield curve',
    description:
      'Today\'s (or any date\'s) US Treasury par yield curve: 1-month to 30-year yields including the 10-year and 2-year, the change from the ' +
      'previous business day and from a month earlier, and the 10y-2y and 10y-3m spreads with an inversion flag. Any date back to 1990.',
    inputSchema: { date },
    annotations: { title: 'Treasury yield curve', ...RO },
  }, wrap((a: any) => yieldCurve(fetchText, a)));

  server.registerTool('treasury_yield_history', {
    title: 'Treasury yield history',
    description:
      'History of one Treasury yield (e.g. 10y, 2y, 3m, 30y) between two dates: start, end, change, high, low and average, with a daily or sampled table. ' +
      'Up to 731 days per call, back to 1990.',
    inputSchema: {
      tenor: z.string().min(1).max(20).describe('Maturity: 1m, 1.5m, 2m, 3m, 4m, 6m, 1y, 2y, 3y, 5y, 7y, 10y, 20y or 30y.'),
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD. Default 30 days before end.'),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD. Default today.'),
    },
    annotations: { title: 'Treasury yield history', ...RO },
  }, wrap((a: any) => yieldHistory(fetchText, a)));

  server.registerTool('treasury_bill_rates', {
    title: 'T-bill rates',
    description:
      'Daily US Treasury bill rates for 4, 6, 8, 13, 17, 26 and 52 week bills: the bank discount rate and the coupon-equivalent yield (comparable ' +
      'to a savings or CD rate), with the change from the previous business day.',
    inputSchema: { date },
    annotations: { title: 'T-bill rates', ...RO },
  }, wrap((a: any) => billRates(fetchText, a)));

  server.registerTool('treasury_real_yields', {
    title: 'TIPS real yields and breakeven inflation',
    description:
      'US Treasury real yield curve (TIPS) for 5, 7, 10, 20 and 30 years, the nominal yield for the same maturity, and the breakeven inflation ' +
      'rate the market implies (nominal minus real).',
    inputSchema: { date },
    annotations: { title: 'TIPS real yields', ...RO },
  }, wrap((a: any) => realYields(fetchText, a)));

  return server;
}
