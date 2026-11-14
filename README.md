# treasury-yields-rates-today-mcp

Treasury yields and rates today for AI assistants. Ask for the 10-year Treasury yield, whether the yield curve is inverted, what T-bills pay or where breakeven inflation sits, and get the U.S. Treasury's own daily numbers.

This is a Model Context Protocol (MCP) server. It reads the U.S. Department of the Treasury daily interest rate XML feed at call time and needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `treasury_yield_curve` | The par yield curve from 1 month to 30 years for today or any date back to 1990, with the change from the previous business day and a month earlier, and the 10y-2y and 10y-3m spreads with an inversion flag. |
| `treasury_yield_history` | One yield (10y, 2y, 3m, 30y and others) between two dates, up to 731 days per call: start, end, change, high, low, average and a table. |
| `treasury_bill_rates` | Daily bill rates for 4 to 52 week bills: bank discount rate and coupon-equivalent yield. |
| `treasury_real_yields` | TIPS real yields for 5 to 30 years with the nominal yield and breakeven inflation. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=treasury-yields-rates-today-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- Today's yields. Treasury publishes new rates after about 3:30 pm ET every business day.
- Whether a date was a holiday or weekend: the server answers with the business day before and says so.
- The spread and inversion arithmetic in basis points.

## Install

### Hosted (Claude.ai custom connector, ChatGPT developer mode)

Paste this URL. No token, no sign-up.

```
https://treasury-yields-rates-today-mcp.lipmichal.workers.dev/mcp
```

### Claude Code

```
claude mcp add --transport http treasury-yields https://treasury-yields-rates-today-mcp.lipmichal.workers.dev/mcp
```

### Claude Desktop

Claude Desktop adds remote servers under Settings, Connectors, Add custom connector. Paste the URL above.

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "treasury-yields": { "url": "https://treasury-yields-rates-today-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "treasury-yields": { "type": "http", "url": "https://treasury-yields-rates-today-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer.

```
git clone https://github.com/theluckystrike/treasury-yields-rates-today-mcp && cd treasury-yields-rates-today-mcp
npm install && npm run build
claude mcp add treasury-yields -- node $(pwd)/dist/stdio.js
```

## Example prompts

- "What is the 10-year Treasury yield today?"
- "Is the yield curve inverted right now?"
- "How has the 2-year Treasury yield moved over the last month?"
- "What do 13-week T-bills pay?"
- "What is 10-year breakeven inflation?"

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- [U.S. Treasury daily interest rate XML feed](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed): daily_treasury_yield_curve, daily_treasury_bill_rates, daily_treasury_real_yield_curve.

## Limitations

- Treasury par yields on the most recently auctioned securities, not market quotes during the day.
- The feed can take 15 to 20 seconds to answer a cold request. The hosted server caches the current month for an hour and closed months for a week.
- History is limited to 731 days per call.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=treasury-yields-rates-today-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
