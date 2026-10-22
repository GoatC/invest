-- Phase 1, step 6 (F6): two settings for the allocation page. Both are config rows, edited in the
-- app and logged in the audit log like every other setting.
--
-- cma: the capital market assumptions (PRD Module B and Section 7: "CMA per asset class" lives in
-- config). Per asset class id, an expected yearly return and volatility as fractions, with a source
-- note; last_verified records when they were last reviewed. F2, F5 and F7 read them. Empty until
-- the owner sets them (PRD Section 9 keeps them an open question).
--
-- drift_display: the colours of F6's drift. A core class turns red once F8_DRIFT would draft a
-- rebalance, and amber once its drift has used warn_share of that band.
insert into public.config (key, value, desc_en, desc_zh) values
  ('cma', '{}',
   'Capital market assumptions (F6): per asset class id, an expected yearly return and volatility (0.06 = 6%) with a source note; last_verified is when they were last reviewed. F2, F5 and F7 read them.',
   '資本市場假設（F6）：各資產類別的預期年報酬與年化波動度（0.06 = 6%）及來源說明；last_verified 為最後檢視日期。F2、F5、F7 會使用。'),
  ('drift_display', '{"warn_share": 0.5}',
   'Drift colours (F6): a core class turns amber once its drift passes this share of the F8_DRIFT band, and red past the band itself, where F8 drafts a rebalance.',
   '偏離顏色（F6）：核心類別的偏離超過 F8_DRIFT 門檻的這個比例時轉為黃色，超過門檻本身（F8 會產生再平衡清單）時轉為紅色。');
