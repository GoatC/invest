-- N8 volatility alert (added 2026-11-06), step 3: the alert and its proposals.
--
-- Two rules read the saved daily volatility score (volatility_scores):
--   VOLATILITY_ALERT (volatility_score_crosses): the score crosses `tense` (6) or `panic` (8) from
--     below. Tense: buy the watchlist stocks nearest their buy price (within near_buy above it, at
--     most max_stocks), tense_share of the regular pool. Panic: sell the VIX products held and buy
--     the core equity classes (panic_classes) with that and panic_share of the pool. Funded from
--     strategic cash (from_class); satellite buys stay within R1 and R2. A run ends once the score
--     falls reset_gap below the line, so a score wobbling around it fires once. Pushed through the
--     quiet hours (push_in_quiet_hours), as Hugo decided on 2026-11-06.
--   VOLATILITY_HEDGE (volatility_score_calm): the score below `calm` (4) → a small hedge in a VIX
--     product (vehicle 00677U, which trades in Taiwan by day), hedge_share of the pool from
--     strategic cash, never past vol_cap (5%) of the pool in VIX products (Hugo, 2026-11-06) nor
--     R2's satellite target; none while one is held. vix_products are what the panic alert sells.
-- The two VIX products join the securities, so the nightly job prices them: 00677U 富邦VIX and
-- VIXY, ProShares' VIX short-term futures fund (a US fund: 複委託, and US estate tax).

insert into public.securities (ticker, name, market, product_type, asset_class_id, currency, domicile) values
  ('00677U', '富邦VIX', 'TW', 'theme_etf', 'tactical_themes', 'TWD', 'TW'),
  ('VIXY', 'ProShares VIX Short-Term Futures ETF', 'US', 'theme_etf', 'tactical_themes', 'USD', 'US')
on conflict (ticker) do nothing;

insert into public.rules (id, feature, desc_en, desc_zh, condition, threshold, action, cooldown_days, enabled) values
  ('VOLATILITY_ALERT', 'N8',
   'Volatility alert: the volatility score crosses 6 (tense) or 8 (panic) from below. Tense: buy the watchlist stocks nearest their buy price with 2% of the pool; panic: sell the VIX hedge and buy the core equity with it and 5% of the pool. Funded from strategic cash; pushed through the quiet hours.',
   '波動警報：波動分數由下往上穿越 6（緊張）或 8（恐慌）。緊張：以資金池 2% 買進觀察清單中最接近買入價的個股；恐慌：賣出 VIX 避險部位，連同資金池 5% 買進核心股票。資金來自戰略現金；安靜時段照樣推播。',
   'volatility_score_crosses',
   '{"tense": 6, "panic": 8, "reset_gap": 1, "tense_share": 0.02, "panic_share": 0.05, "near_buy": 0.1, "max_stocks": 2, "from_class": "strategic_cash", "panic_classes": ["us_global_equity", "tw_market_cap"], "push_in_quiet_hours": true}',
   'band_proposal', 7, true),
  ('VOLATILITY_HEDGE', 'N8',
   'Volatility hedge: the volatility score below 4 (calm); buy a small hedge in a VIX product with 1% of the pool from strategic cash, never past 5% of the pool in VIX products nor the satellite target; none while one is held.',
   '波動避險：波動分數低於 4（平靜）；以戰略現金買進資金池 1% 的 VIX 商品避險，VIX 商品合計不超過資金池 5% 與衛星目標；已持有時不再提出。',
   'volatility_score_calm',
   '{"calm": 4, "reset_gap": 1, "hedge_share": 0.01, "vol_cap": 0.05, "vehicle": "00677U", "vix_products": ["00677U", "VIXY"], "from_class": "strategic_cash"}',
   'hedge_proposal', 7, true);
