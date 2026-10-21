-- N5 trade entry warns when a typed FX rate is far from the newest known one, the usual sign of a
-- typo such as 3.24 for 32.4. The margin lives here, not in code, so it can be changed in the app
-- (CLAUDE.md: thresholds live in the rules / config tables). The warning never blocks a save.
insert into public.config (key, value, desc_en, desc_zh) values
  ('fx_rate_check', '{"max_gap": 0.2}',
   'Trade entry and CSV import: warn when an FX rate differs from the newest known rate for its currency by more than this share (0.2 = 20%); the trade can still be saved.',
   '交易登錄與 CSV 匯入：匯率與該幣別最近一筆已知匯率相差超過此比例（0.2 = 20%）時提出警示，仍可儲存。');
