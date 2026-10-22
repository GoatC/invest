-- Phase 1, step 8 (F2): the compounding calculator's plan, one config row edited in the app and
-- logged in the audit log like every other setting.
--
-- projection: the plan the actual regular pool is compared with: the month it starts (YYYY-MM),
-- the value at its start (pv) and the first monthly contribution (pmt) in TWD, the yearly step-up
-- of the contribution, the expected yearly return and inflation as fractions, and how many years
-- it runs. Until a plan is saved, start, pv, pmt and expected_return are null and the calculator
-- offers today's regular pool, dca.amount_twd and the capital market assumptions' target mix;
-- step_up, inflation and years are its other starting values (PRD Section 9 keeps them open).
insert into public.config (key, value, desc_en, desc_zh) values
  ('projection', '{"start": null, "pv": null, "pmt": null, "step_up": 0, "expected_return": null, "inflation": 0.02, "years": 30}',
   'Compounding plan (F2): start month, starting value and first monthly contribution in TWD, yearly step-up, expected yearly return and inflation (0.02 = 2%), and years. Null until a plan is saved: the calculator then offers today''s regular pool, dca.amount_twd and the target mix''s return from cma.',
   '複利計畫（F2）：起始月份、起始金額與第一個月投入（台幣）、每年調升比例、預期年報酬與通膨率（0.02 = 2%）及年數。尚未儲存計畫時為 null，計算機改用目前一般投入資金池市值、dca.amount_twd 與 cma 目標配置的預期報酬。');
