-- Phase 3, step 4 (F7): the efficient frontier and capital market line.
--
-- frontier (config): the years of monthly history the covariance reads (10; the nightly job loads
--   them), the fewest common months to run on, the points along the frontier, the yearly risk-free
--   rate the capital market line starts from (1.7%, a TWD time deposit, the same starting value as
--   the Regression Lab's), and each asset class's weight bounds [min, max]: twice its target at
--   most, so the frontier stays near a mix you could hold. Reference only: it never writes the
--   F6 targets.

insert into public.config (key, value, desc_en, desc_zh) values
  ('frontier', '{
     "lookback_years": 10,
     "min_months": 36,
     "points": 40,
     "risk_free": 0.017,
     "bounds": {
       "us_global_equity": [0, 0.5],
       "tw_market_cap": [0, 0.25],
       "global_bonds": [0, 0.45],
       "real_assets": [0, 0.2],
       "strategic_cash": [0, 0.15],
       "us_stocks": [0, 0.15],
       "tw_stocks": [0, 0.1],
       "tactical_themes": [0, 0.1]
     }
   }',
   'Efficient frontier (F7): the years of monthly history the covariance reads, the fewest common months to run on, the points along the frontier, the yearly risk-free rate the capital market line starts from, and each asset class''s weight bounds [min, max] as fractions. Reference only: it never writes the F6 targets.',
   '效率前緣（F7）：共變異數讀取的月報酬歷史年數、執行所需的最少共同月數、前緣上的點數、資本市場線起點的年無風險利率，以及各資產類別的權重上下限 [最小, 最大]（比例）。僅供參考：不會改寫 F6 的目標權重。');
