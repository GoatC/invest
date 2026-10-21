-- Reference data from the PRD: the Investment Principles (asset classes, target weights, core
-- vehicles), the Section 4 rules with their thresholds, and the settings the rules engine and
-- the weekly review read. None of it is personal: holdings, cash flows and the windfall amount
-- are entered in the app and never stored in git. Every value here stays editable in the app.

insert into public.asset_classes (id, name_en, name_zh, target_weight, is_satellite, sort_order) values
  ('us_global_equity', 'US / global equity', '美股／全球大盤', 0.28, false, 1),
  ('tw_market_cap', 'Taiwan market-cap equity', '台股市值型', 0.12, false, 2),
  ('global_bonds', 'Global bonds', '全球債券', 0.22, false, 3),
  ('real_assets', 'Real assets', '實體資產', 0.10, false, 4),
  ('strategic_cash', 'Strategic cash', '戰略現金', 0.08, false, 5),
  ('us_stocks', 'US stocks', '美股個股', 0.10, true, 6),
  ('tw_stocks', 'Taiwan stocks', '台股個股', 0.05, true, 7),
  ('tactical_themes', 'Tactical themes', '戰術主題', 0.05, true, 8);

-- The core vehicles named in the Investment Principles, plus 0050, the N4 proxy for both Taiwan classes.
insert into public.securities (ticker, name, market, product_type, asset_class_id, currency, domicile) values
  ('VOO', 'Vanguard S&P 500 ETF', 'US', 'equity_etf', 'us_global_equity', 'USD', 'US'),
  ('VT', 'Vanguard Total World Stock ETF', 'US', 'equity_etf', 'us_global_equity', 'USD', 'US'),
  ('00692', '富邦公司治理', 'TW', 'equity_etf', 'tw_market_cap', 'TWD', 'TW'),
  ('009816', '凱基台灣TOP50', 'TW', 'equity_etf', 'tw_market_cap', 'TWD', 'TW'),
  ('00922', '國泰台灣領袖50', 'TW', 'equity_etf', 'tw_market_cap', 'TWD', 'TW'),
  ('0050', '元大台灣50', 'TW', 'equity_etf', 'tw_market_cap', 'TWD', 'TW'),
  ('BNDW', 'Vanguard Total World Bond ETF', 'US', 'bond_etf', 'global_bonds', 'USD', 'US'),
  ('AGGU', 'iShares Core Global Aggregate Bond UCITS ETF', 'UK', 'bond_etf', 'global_bonds', 'USD', 'IE'),
  ('GLDM', 'SPDR Gold MiniShares Trust', 'US', 'gold', 'real_assets', 'USD', 'US'),
  ('BIL', 'SPDR Bloomberg 1-3 Month T-Bill ETF', 'US', 'cash_mmf', 'strategic_cash', 'USD', 'US');

-- Benchmarks follow the N4 proxy table; tactical themes use VT until a theme ETF is held.
update public.asset_classes c
set benchmark_ticker = b.ticker
from (values
  ('us_global_equity', 'VT'), ('tw_market_cap', '0050'), ('global_bonds', 'BNDW'), ('real_assets', 'GLDM'),
  ('strategic_cash', 'BIL'), ('us_stocks', 'VOO'), ('tw_stocks', '0050'), ('tactical_themes', 'VT')
) as b (class_id, ticker)
where c.id = b.class_id;

-- The Section 4 push rules. Rules whose feature ships in Phase 2 (F3, F12, N3) start disabled.
-- Each fires at most once per cooldown_days (7) unless its state changes.
insert into public.rules (id, feature, desc_en, desc_zh, condition, threshold, action, enabled) values
  ('R1', 'Rules',
   'Single-stock cap: no single stock above 5% of the regular-contribution pool; when one is, propose a trim. Windfall money is left out.',
   '單一個股上限：任何單一個股不超過一般投入資金池的 5%；超過時提出減碼提案。大額資金不計入。',
   'single_stock_weight_above', '{"max_weight": 0.05, "pool": "regular"}', 'trim_proposal', true),
  ('R2', 'Rules',
   'Satellite 25% trigger: when the satellite sleeve rises above 25% of the regular-contribution pool, trim it mechanically back to 20%.',
   '衛星 25% 觸發：衛星部位超過一般投入資金池的 25% 時，機械式減碼回 20%。',
   'satellite_weight_above', '{"trigger_weight": 0.25, "target_weight": 0.20, "pool": "regular"}', 'trim_proposal', true),
  ('F8_DRIFT', 'F8',
   'Drift rebalance (5/25 rule): a core class drifts more than 5 percentage points from its target, or more than 25% of the target itself; draft a rebalance list.',
   '偏離再平衡（5/25 規則）：任一核心類別絕對偏離超過 5 個百分點，或相對偏離超過目標的 25%；產生再平衡清單。',
   'class_drift_exceeds', '{"abs_drift": 0.05, "rel_drift": 0.25}', 'rebalance_list', true),
  ('ANNUAL_REVIEW', 'F8',
   'Annual review: on the first weekend of January, run a full rebalance check and review the rules.',
   '年度檢查：每年 1 月第一個週末，做完整再平衡檢查並檢視規則。',
   'first_weekend_of_month', '{"month": 1}', 'annual_review', true),
  ('MONTHLY_CONTRIBUTION', 'F8',
   'Monthly contribution: the day after the DCA date, confirm the fill and send the new cash to at most the two most underweight core classes; up to 20% may go to the satellite while a buy-zone alert is open.',
   '每月投入：定期定額扣款隔日，確認成交，並把新資金投入權重最不足的核心類別（最多兩個）；有買入區警報時最多 20% 可改投衛星。',
   'day_after_dca', '{"max_classes": 2, "satellite_share_with_buy_alert": 0.20}', 'allocate_contribution', true),
  ('WINDFALL_TRANCHE_DUE', 'F3',
   'Windfall tranche due: when a tranche date is reached, draft its order list split by the core targets.',
   '分批到期：分批到期日時，依核心目標權重產生該批下單清單。',
   'tranche_due', '{}', 'tranche_order_list', false),
  ('WINDFALL_ACCELERATION', 'F3',
   'Windfall acceleration: when MSCI ACWI falls 15% from its 52-week high, merge the next tranche into the current one; at 25%, deploy half the remaining balance; at 35%, all of it. Each tier fires once per drawdown.',
   '分批加速：MSCI ACWI 自 52 週高點回落 15% 時，下一批併入本批；回落 25% 投入剩餘資金的一半；回落 35% 全數投入。每個級距在同一波下跌中只觸發一次。',
   'index_drawdown_tier',
   '{"index": "ACWI", "window_weeks": 52, "tiers": [{"drawdown": 0.15, "deploy": "next_tranche"}, {"drawdown": 0.25, "deploy_share_of_remaining": 0.5}, {"drawdown": 0.35, "deploy_share_of_remaining": 1}]}',
   'accelerated_tranche', false),
  ('BUY_ZONE', 'F12',
   'Buy zone: price at or below 75% of the base intrinsic value; add a watchlist entry and a draft order, subject to R1 and R2.',
   '進入買入區：股價低於或等於基本情境內在價值的 75%；加入觀察清單並產生建議單（受 R1／R2 限制）。',
   'price_at_or_below_value_multiple', '{"multiple": 0.75}', 'buy_proposal', false),
  ('TRIM_ZONE', 'F12',
   'Trim zone: price at or above 125% of the base intrinsic value; propose a trim.',
   '進入減碼區：股價高於或等於基本情境內在價值的 125%；提出減碼提案。',
   'price_at_or_above_value_multiple', '{"multiple": 1.25}', 'trim_proposal', false),
  ('VALUATION_UPDATED', 'F12',
   'Valuation updated: a new filing moves the intrinsic value by more than 10%; prompt a review.',
   '估值更新：新財報使內在價值變動超過 10%；提醒重新檢視。',
   'value_change_exceeds', '{"change": 0.10}', 'review_prompt', false),
  ('RED_FLAG_WORSENS', 'N3',
   'Red flag worsens: a holding moves from green to amber or from amber to red; prompt a review.',
   '紅旗惡化：持股燈號由綠轉黃或由黃轉紅；提醒重新檢視。',
   'red_flag_worsens', '{}', 'review_prompt', false),
  ('RED_FLAG_RED', 'N3',
   'Red flag turns red: a satellite holding moves to red; prompt a re-review with an exit option.',
   '紅旗轉紅：衛星持股燈號轉紅；提示重新檢視並附出場選項。',
   'satellite_red_flag', '{}', 're_review_with_exit', false),
  ('US_ESTATE_TAX', 'F15',
   'US estate tax: US-situs assets above US$60,000; suggest Irish-domiciled equivalents.',
   '美國遺產稅：美國資產超過 6 萬美元時，建議改用愛爾蘭註冊的同類 ETF。',
   'us_situs_value_above', '{"usd": 60000}', 'irish_domicile_suggestion', true),
  ('DATA_FAILURE', 'Pipeline',
   'Data failure: a daily job fails twice in a row; send a system alert.',
   '資料異常：每日工作連續失敗兩次時，發出系統警示。',
   'job_failed_consecutively', '{"failures": 2}', 'system_alert', true);

insert into public.config (key, value, desc_en, desc_zh) values
  ('quiet_hours', '{"start": "23:00", "end": "08:00", "time_zone": "Asia/Taipei"}',
   'Quiet hours: no push notifications between these times.',
   '安靜時段：此時段內不推播。'),
  ('weekly_review', '{"day": "sunday", "time": "20:00", "time_zone": "Asia/Taipei"}',
   'Weekly review push; Sunday 20:00 Taipei by default, day and time not chosen yet (PRD Section 9).',
   '每週檢視推播時間；預設週日晚上 8 點（台北時間），星期與時間尚未確定。'),
  ('proposal_expiry_days', '14',
   'Unactioned proposals expire after this many days and are re-evaluated.',
   '未處理的提案經過這麼多天後失效並重新評估。'),
  ('dca', '{"amount_twd": 10000, "day_of_month": null}',
   'Monthly DCA: the amount and the day of the month the broker debits it (day not set yet).',
   '每月定期定額：金額與每月扣款日（扣款日待填）。'),
  ('var', '{"confidence": 0.95, "horizon_weeks": 1, "month_weeks": 4.33, "lookback_years": 3}',
   'VaR card (N4): confidence, horizon in weeks, weeks in the 1-month toggle, and years of weekly returns for the covariance.',
   '風險值卡片（N4）：信賴水準、期間（週）、一個月換算的週數，以及共變異數使用的週報酬年數。'),
  ('windfall_pace', '{"gauge": "sp500_cape_percentile", "cutoffs": [30, 70], "tranches": [6, 12, 24]}',
   'Windfall pace (F3): below the first CAPE percentile cutoff use the first tranche count, up to the second the middle one, above it the last.',
   '大額資金分批節奏（F3）：CAPE 百分位低於第一個門檻用第一個批數，到第二個門檻用中間批數，高於第二個門檻用最後一個批數。');
