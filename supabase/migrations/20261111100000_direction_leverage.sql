-- N5 trade direction and leverage (added 2026-11-05): a trade can open or close a short position,
-- and a position can be leveraged, so the holdings, R1 / R2 and the risk figures read exposure, not
-- only the money put in.
--
-- transactions.direction: long (buy opens, sell closes) or short (sell opens, buy closes; a sale
--   of borrowed shares). Every trade saved before this migration is long.
-- transactions.leverage: exposure ÷ own money, 1.0 to 10.0 in steps of 0.1. Only the share
--   qty × price ÷ leverage is own money; the rest is borrowed (a long) or posted as margin's
--   counterpart (a short). Every trade saved before this migration is 1.0.
-- config leverage: the highest leverage the trade form offers (the database still accepts up to
--   10.0, so a lower setting never makes a saved trade invalid), and the share of own money left
--   at which a position is flagged as close to a margin call. Display only: no rule reads it.

alter table public.transactions
  add column direction text not null default 'long' check (direction in ('long', 'short')),
  add column leverage numeric(3, 1) not null default 1.0 check (leverage >= 1.0 and leverage <= 10.0);
comment on column public.transactions.direction is 'long: buy opens, sell closes; short: sell opens, buy closes 做多（買進開倉）或做空（賣出開倉）';
comment on column public.transactions.leverage is 'Exposure ÷ own money, 1.0–10.0 in 0.1 steps; numeric(3,1) holds the step 槓桿倍數（曝險 ÷ 自有資金），以 0.1 倍為級距';

insert into public.config (key, value, desc_en, desc_zh) values
  ('leverage', '{"max": 5.0, "margin_call_share": 0.3}',
   'Trade direction and leverage (N5): the highest leverage the trade form offers, in 0.1 steps, and the share of a position''s own money left at which the holdings page warns of a margin call.',
   '交易方向與槓桿（N5）：新增交易表單提供的最高槓桿（以 0.1 倍為級距），以及部位自有資金剩下多少比例時，持倉頁提醒可能被追繳保證金。');
