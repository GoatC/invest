-- Phase 2, step 3 (F11): the CAPM cost of equity for single stocks, E(R) = R_f + β (ERP + CRP).
--
-- market_series gains three monthly series, loaded by the nightly job with the secret key once
--   config capm exists, as fractions a year:
--   us_treasury_10y  the US 10-year Treasury yield, the month's last day (FRED DGS10; the
--                    Treasury's daily par yield curve as fallback), R_f for US stocks;
--   tw_govt_10y      the Taiwan 10-year government bond yield, the month's average on the
--                    secondary market (Central Bank of the ROC, open data EG43M01), R_f for
--                    Taiwan stocks;
--   us_implied_erp   Damodaran's implied equity risk premium for the S&P 500 at the start of the
--                    month (ERPbymonth.xlsx, the trailing-12-month figure).
-- capm: the settings, edited on the Cost of equity page and logged: whether β is Blume's adjusted
--   one or the raw slope; the ERP's source (Damodaran's newest month, or the value typed) and the
--   typed value, also used until the series loads; per market, the index β is measured against
--   (config regression), the series of its 10-year yield, the yield used until that series loads,
--   and the country risk premium added to the ERP. The starting values: the ERP 4.23% and
--   Taiwan's premium 0.78% from Damodaran's country table of 5 January 2026 (mature market 4.23%,
--   Taiwan Aa3, 5.01% in all); the yields from the newest months found on 2026-10-28 (US 5.00%
--   for October, Taiwan 1.955% for August). To be checked on the page.

comment on table public.market_series is 'Monthly market series: CAPE, the S&P 500 price and dividend yield (F3), the US 3-month bill (N1), the 10-year yields and the implied ERP (F11) 每月市場資料';

insert into public.config (key, value, desc_en, desc_zh) values
  ('capm', '{
     "beta": "adjusted",
     "erp": {"source": "damodaran", "manual": 0.0423},
     "markets": {
       "US": {"benchmark": "SPX", "risk_free_series": "us_treasury_10y", "risk_free": 0.05, "country_premium": 0},
       "TW": {"benchmark": "TAIEX", "risk_free_series": "tw_govt_10y", "risk_free": 0.01955, "country_premium": 0.0078}
     },
     "last_verified": null,
     "source": "ERP and Taiwan CRP: Damodaran, country risk premiums, 2026-01-05 Damodaran 國家風險溢酬表；yields: FRED DGS10, Central Bank EG43M01, 2026-10-28 殖利率：FRED、中央銀行"
   }',
   'Cost of equity (F11): adjusted or raw β, the ERP''s source and typed value, and per market the index β is measured against, the 10-year yield''s series, the yield used until it loads, and the country risk premium.',
   '權益成本（F11）：使用調整後或原始 β、風險溢酬來源與自訂值，以及各市場計算 β 的指數、10 年期殖利率資料、資料載入前使用的殖利率與國家風險溢酬。');
