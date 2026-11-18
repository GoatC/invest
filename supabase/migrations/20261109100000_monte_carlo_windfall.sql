-- F5 takes the windfall as F3 runs it (asked after Phase 3): every simulated path meets F3's
-- acceleration on its own market, and an expected windfall is paced as F3 would pace it.
--
-- monte_carlo.gauge_class: the asset class whose simulated returns stand for MSCI ACWI, the gauge
--   rule WINDFALL_ACCELERATION reads (us_global_equity, VT, as config stress.gauge stands for ACWI
--   in F10); null turns acceleration off in the simulation. The tiers themselves are the rule's,
--   and only while the rule is on.
-- monte_carlo.windfall.tranches: null now follows F3's pace (config windfall_pace) at today's
--   CAPE percentile. Switched to null only where no expected windfall was set, so a count already
--   typed with one stays.

update public.config
set value = jsonb_set(value, '{gauge_class}', '"us_global_equity"')
where key = 'monte_carlo' and not (value ? 'gauge_class');

update public.config
set value = jsonb_set(value, '{windfall,tranches}', 'null')
where key = 'monte_carlo' and value -> 'windfall' -> 'amount_twd' = 'null'::jsonb;

update public.config
set desc_en = 'Monte Carlo (F5): paths, the years of history the months are drawn from, the block of consecutive months drawn at a time, the fewest months a run needs, whether swings are scaled to the CMA volatility, the fan''s outer percentiles, the years the figures are read at, the goal in today''s money, an expected windfall (amount, month it arrives, tranches; blank tranches follow F3''s CAPE pace) used until an F3 plan is saved, and the asset class standing for ACWI in F3''s acceleration.',
    desc_zh = '蒙地卡羅（F5）：路徑數、抽樣月報酬的歷史年數、每次連續抽取的月數、執行所需的最少月數、是否把波動縮放到資本市場假設的波動度、扇形圖外緣百分位、讀取數字的年數、以今天幣值計的目標、尚未儲存 F3 計畫前使用的預期大額資金（金額、入帳月份、分批數；分批數留白則依 F3 的 CAPE 節奏），以及 F3 加速投入時代表 ACWI 的資產類別。'
where key = 'monte_carlo';
