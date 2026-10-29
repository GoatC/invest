-- Phase 3, step 2 (F1): the 30-year life timeline.
--
-- timeline (config): the later goals the timeline marks: a month, an amount in today's money (or
--   null for a milestone) and a name, edited on the page. None here: they are the owner's own,
--   and no goal figures belong in git.

insert into public.config (key, value, desc_en, desc_zh) values
  ('timeline', '{"goals": []}',
   'Life timeline (F1): the later goals marked on the chart, each a month, an amount in today''s money (null for a milestone with no amount) and a name.',
   '人生財務時間軸（F1）：標在圖上的後續目標，每個目標包含月份、以今天幣值計的金額（沒有金額的里程碑為 null）與名稱。');
