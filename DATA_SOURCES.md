# Data sources

All sources are public, keyless and read at call time. Test fixtures in `test/fixtures/` were downloaded on 2026-11-14.

| Data | URL | Notes |
|---|---|---|
| Daily Treasury par yield curve rates | https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=YYYYMM | 1 month to 30 years. Fixture November 2026: 10 Yr 5.15 and 2 Yr 4.88 on 2026-11-13. |
| Daily Treasury bill rates | ...?data=daily_treasury_bill_rates | Bank discount and coupon-equivalent for 4 to 52 week bills. |
| Daily Treasury real yield curve rates | ...?data=daily_treasury_real_yield_curve | TIPS 5 to 30 years. |

Ranges of more than four months are read by year (`field_tdr_date_value=YYYY`). The feed can take 15 to 20 seconds to answer a cold request, so the current month is cached an hour and closed months and years a week. api.fiscaldata.treasury.gov is not used: it refused Cloudflare Workers with HTTP 525 when measured on 2026-11-14. Treasury data is a US government work and in the public domain.
