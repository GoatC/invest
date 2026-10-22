-- After Phase 1, step 9 (PRD Section 9 open question, decided): Hugo buys US shares through 複委託
-- in fractions (零股), so proposals size US orders in fractions instead of whole shares. Taiwan
-- odd lots are whole shares. orders: the markets whose orders may be fractional, and to how many
-- decimals of a share; edited on the Rules page.
insert into public.config (key, value, desc_en, desc_zh) values
  ('orders', '{"fractional_markets": ["US"], "share_decimals": 4}',
   'Draft orders (rules engine): markets whose share counts may be fractional (US shares through 複委託), and to how many decimals; other markets order whole shares.',
   '建議下單清單（規則引擎）：股數可有小數的市場（經複委託買的美股零股）與小數位數；其他市場以整股下單。');
