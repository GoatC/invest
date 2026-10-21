-- Phase 1, step 4: the nightly job loads a Bank of Taiwan rate for every business day, so trade
-- entry and the CSV import now default to the trade date's rate, and check a typed rate against
-- it, instead of the newest rate. Banks publish no rate on weekends and holidays, so the rate of
-- an earlier day stands in, up to max_age_days old (Lunar New Year closes them for up to 9 days).
update public.config
set value = value || '{"max_age_days": 10}'::jsonb,
    desc_en = 'Trade entry and CSV import: an FX rate is filled in from the trade date''s rate, or the newest one at most max_age_days before it; a rate differing from that one by more than max_gap (0.2 = 20%) is flagged as a likely typo, and can still be saved.',
    desc_zh = '交易登錄與 CSV 匯入：匯率預設帶入交易日的匯率，若當天沒有，則取交易日前 max_age_days 天內最近一筆；與該匯率相差超過 max_gap（0.2 = 20%）時標示為可能輸入錯誤，仍可儲存。'
where key = 'fx_rate_check';
