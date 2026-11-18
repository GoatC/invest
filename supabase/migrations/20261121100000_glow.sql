-- The Ink (甲) design, chosen by Hugo on 2026-11-18 (docs/design-handoff/): the dashboard poster glows in the colour of
-- the 7-day move, stronger with its size, and the total value passing each NT$100,000 is celebrated once.
--
-- config glow: the thresholds lib/models/glow.ts reads, so none of them is written in code.

insert into public.config (key, value, desc_en, desc_zh) values
  ('glow', '{
     "flat_band_pct": 0.3,
     "full_at_pct": 5,
     "k_min": 0.4,
     "k_flat": 0.55,
     "milestone_step_twd": 100000
   }',
   'Poster glow: a 7-day move under flat_band_pct percent is flat (forget-me-not, strength k_flat); beyond it the glow is red or green, from k_min up to full strength at full_at_pct percent. A milestone is the total value passing a new multiple of milestone_step_twd, celebrated once.',
   '海報光暈：近 7 天漲跌在 flat_band_pct% 以內算持平（勿忘草藍，強度 k_flat）；超過則依漲跌顯示紅或綠，強度從 k_min 起，到 full_at_pct% 時最濃。里程碑：總市值每跨過 milestone_step_twd 的整數倍時慶祝一次。');
