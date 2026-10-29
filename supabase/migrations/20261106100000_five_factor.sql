-- Phase 3, step 6 (N1): the Regression Lab's Fama-French five-factor mode.
--
-- factors (config): which region's factors a holding is regressed on by its market (US-listed on
--   the US factors, Taiwan on the emerging markets', London on the developed markets'), the region
--   for the whole portfolio (developed markets: the library's global file stops in 2019), the
--   windows offered in years and the default, the confidence of the intervals, the fewest months a
--   fit needs and the years of factors the nightly job keeps. The factors themselves are Kenneth
--   French's free monthly data, saved in market_series as ff5_<region>_<factor> by the nightly job.

insert into public.config (key, value, desc_en, desc_zh) values
  ('factors', '{
     "regions": {"US": "us", "TW": "emerging", "UK": "developed"},
     "portfolio": "developed",
     "windows": [2, 3, 5, 10],
     "default_window": 3,
     "confidence": 0.95,
     "min_months": 24,
     "keep_years": 11
   }',
   'Fama-French five factors (N1): the region of factors each market''s holdings are regressed on, the region for the whole portfolio, the windows offered in years and the default, the confidence of the intervals, the fewest months a fit needs, and the years of Kenneth French''s monthly factors the nightly job keeps.',
   'Fama–French 五因子（N1）：各市場持股使用的因子區域、整體投資組合使用的區域、提供的期間（年）與預設值、信賴區間的信賴水準、回歸所需的最少月數，以及每夜排程保留的 Kenneth French 月因子年數。');
