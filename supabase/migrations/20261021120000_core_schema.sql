-- Long-View Investment App: core schema (PRD Section 7; Phase 1, step 2).
--
-- * Money is stored in the trade currency with the day's FX rate, written as TWD per 1 unit of
--   that currency (so 1 for TWD); reports convert to TWD.
-- * Thresholds live in the rules and config tables, never in code.
-- * Row-level security, grants and the owner check follow in the next migration, then the
--   change logs and the reference data from the PRD.

-- Helpers that must never be reachable through the Data API live in their own schema.
create schema if not exists private;
revoke all on schema private from public;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.touch_updated_at() from public;

-- ---------------------------------------------------------------------------
-- Allocation and securities 配置與證券
-- ---------------------------------------------------------------------------

create table public.asset_classes (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name_en text not null,
  name_zh text not null,
  target_weight numeric not null check (target_weight between 0 and 1),
  benchmark_ticker text,
  is_satellite boolean not null default false,
  sleeve text generated always as (case when is_satellite then 'satellite' else 'core' end) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets each security carry the sleeve of its class through a composite foreign key.
  unique (id, sleeve)
);
comment on table public.asset_classes is 'Asset classes and SAA target weights (F6, Investment Principles) 資產類別與 SAA 目標權重';
comment on column public.asset_classes.target_weight is 'Target share of the regular-contribution pool, 0 to 1 一般投入資金池的目標比例（0–1）';
comment on column public.asset_classes.benchmark_ticker is 'Benchmark ETF for class returns, also the N4 VaR proxy 類別報酬基準，亦為 N4 風險值代理';
comment on column public.asset_classes.sleeve is 'core or satellite, derived from is_satellite 核心或衛星，由 is_satellite 推導';

create trigger asset_classes_touch before update on public.asset_classes
  for each row execute function private.touch_updated_at();

create table public.securities (
  ticker text primary key check (ticker ~ '^[A-Z0-9][A-Z0-9.-]*$'),
  name text not null,
  market text not null check (market in ('US', 'TW', 'UK')),
  listing_country text generated always as (market) stored,
  product_type text not null check (product_type in ('equity_etf', 'bond_etf', 'gold', 'cash_mmf', 'stock', 'theme_etf')),
  asset_class_id text not null,
  sleeve text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  domicile text not null check (domicile ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (asset_class_id, sleeve) references public.asset_classes (id, sleeve) on update cascade
);
comment on table public.securities is 'Listed securities the app tracks: holdings, proxies, watchlist names 追蹤的上市證券';
comment on column public.securities.listing_country is 'Where it trades (N6 lens), not what it owns; manual assets count as not listed 上市國家（交易地，非投資地區）';
comment on column public.securities.product_type is 'N6 product lens: equity_etf, bond_etf, gold, cash_mmf, stock, theme_etf 產品類別';
comment on column public.securities.sleeve is 'core or satellite, always that of the asset class 核心或衛星，與資產類別一致';
comment on column public.securities.domicile is 'Fund domicile, ISO country code; US-domiciled funds carry US withholding and estate-tax exposure (F15) 註冊地';
create index securities_asset_class_id_sleeve_idx on public.securities (asset_class_id, sleeve);

-- A new security takes the sleeve of its asset class unless one is given; the composite key above
-- rejects a mismatch and follows a class that moves between core and satellite.
create function private.fill_security_sleeve()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sleeve is null
    or (tg_op = 'UPDATE' and new.asset_class_id is distinct from old.asset_class_id and new.sleeve is not distinct from old.sleeve)
  then
    new.sleeve := (select c.sleeve from public.asset_classes c where c.id = new.asset_class_id);
  end if;
  return new;
end;
$$;
revoke execute on function private.fill_security_sleeve() from public;

create trigger securities_fill_sleeve before insert or update on public.securities
  for each row execute function private.fill_security_sleeve();
create trigger securities_touch before update on public.securities
  for each row execute function private.touch_updated_at();

alter table public.asset_classes
  add constraint asset_classes_benchmark_ticker_fkey
  foreign key (benchmark_ticker) references public.securities (ticker) on update cascade;
create index asset_classes_benchmark_ticker_idx on public.asset_classes (benchmark_ticker);

-- ---------------------------------------------------------------------------
-- Holdings and cash flows 持倉與現金流
-- ---------------------------------------------------------------------------

create table public.transactions (
  id bigint generated always as identity primary key,
  trade_date date not null,
  ticker text not null references public.securities (ticker) on update cascade,
  side text not null check (side in ('buy', 'sell')),
  qty numeric not null check (qty > 0),
  price numeric not null check (price >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  fee numeric not null default 0 check (fee >= 0),
  tax numeric not null default 0 check (tax >= 0),
  fx_rate numeric not null check (fx_rate > 0),
  source text not null default 'manual' check (source in ('manual', 'csv')),
  pool text not null default 'regular' check (pool in ('regular', 'windfall')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_twd_rate_check check (currency <> 'TWD' or fx_rate = 1)
);
comment on table public.transactions is 'Every buy and sell (N5); price, fee and tax in the trade currency 每筆買賣；價格、手續費與稅以交易幣別記錄';
comment on column public.transactions.fx_rate is 'TWD per 1 unit of the trade currency on the trade date; 1 for TWD 交易日匯率（每 1 單位交易幣別的台幣）';
comment on column public.transactions.pool is 'regular or windfall; windfall money never counts toward R1 or R2 一般或大額資金池';
create index transactions_ticker_trade_date_idx on public.transactions (ticker, trade_date);
create index transactions_trade_date_idx on public.transactions (trade_date);
create trigger transactions_touch before update on public.transactions
  for each row execute function private.touch_updated_at();

create table public.cash_flows (
  id bigint generated always as identity primary key,
  flow_date date not null,
  type text not null check (type in ('contribution', 'windfall', 'dividend', 'withdrawal')),
  amount numeric not null check (amount > 0),
  currency text not null default 'TWD' check (currency ~ '^[A-Z]{3}$'),
  fx_rate numeric not null default 1 check (fx_rate > 0),
  amount_twd numeric generated always as (amount * fx_rate) stored,
  pool text not null default 'regular' check (pool in ('regular', 'windfall')),
  ticker text references public.securities (ticker) on update cascade,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_flows_twd_rate_check check (currency <> 'TWD' or fx_rate = 1),
  constraint cash_flows_windfall_pool_check check (type <> 'windfall' or pool = 'windfall'),
  constraint cash_flows_dividend_ticker_check check (type <> 'dividend' or ticker is not null)
);
comment on table public.cash_flows is 'Money in and out (F2, F18); the amount is always positive and the type gives the direction 資金進出；金額為正，方向由類型決定';
comment on column public.cash_flows.amount_twd is 'amount × fx_rate, computed by the database 由資料庫計算';
create index cash_flows_flow_date_idx on public.cash_flows (flow_date);
create index cash_flows_ticker_idx on public.cash_flows (ticker);
create trigger cash_flows_touch before update on public.cash_flows
  for each row execute function private.touch_updated_at();

create table public.manual_assets (
  id bigint generated always as identity primary key,
  name text not null,
  asset_class_id text not null references public.asset_classes (id) on update cascade,
  product_type text not null check (product_type in ('gold', 'cash_mmf')),
  unit text not null check (unit in ('grams', 'TWD')),
  quantity numeric not null check (quantity >= 0),
  valuation_method text not null check (valuation_method in ('twd_gold_price', 'balance')),
  last_value_twd numeric check (last_value_twd >= 0),
  valued_on date,
  pool text not null default 'regular' check (pool in ('regular', 'windfall')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_assets_gold_in_grams_check check ((product_type = 'gold') = (unit = 'grams')),
  constraint manual_assets_method_check check ((unit = 'grams') = (valuation_method = 'twd_gold_price'))
);
comment on table public.manual_assets is 'Non-listed assets (N5): physical gold in grams at the TWD gold price; savings and money-market funds as TWD balances 非上市資產';
create index manual_assets_asset_class_id_idx on public.manual_assets (asset_class_id);
create trigger manual_assets_touch before update on public.manual_assets
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Market data and snapshots 市場資料與快照
-- ---------------------------------------------------------------------------

create table public.prices (
  ticker text not null references public.securities (ticker) on update cascade,
  price_date date not null,
  close numeric not null check (close > 0),
  adj_close numeric check (adj_close > 0),
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  created_at timestamptz not null default now(),
  primary key (ticker, price_date)
);
comment on table public.prices is 'Daily closes in the security currency, from the nightly job 每日收盤價（證券幣別）';
comment on column public.prices.source is 'Feed that supplied the close, e.g. alphavantage, finmind, twse, ishares_nav 資料來源';

create table public.fx_rates (
  pair text not null check (pair ~ '^[A-Z]{3}/[A-Z]{3}$'),
  rate_date date not null,
  rate numeric not null check (rate > 0),
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  created_at timestamptz not null default now(),
  primary key (pair, rate_date)
);
comment on table public.fx_rates is 'Daily FX rates; pair USD/TWD means TWD per 1 USD 每日匯率（USD/TWD 表示 1 美元兌多少台幣）';

create table public.nav_snapshots (
  snapshot_date date primary key,
  total_twd numeric not null check (total_twd >= 0),
  weights_by_class jsonb not null default '{}'::jsonb check (jsonb_typeof(weights_by_class) = 'object'),
  var_95_1w numeric check (var_95_1w >= 0),
  created_at timestamptz not null default now()
);
comment on table public.nav_snapshots is 'Daily NAV after the last market close (F18), with class weights and the N4 VaR 每日淨值快照';
comment on column public.nav_snapshots.weights_by_class is 'Asset-class id to weight, 0 to 1 各資產類別權重';

-- ---------------------------------------------------------------------------
-- Rules engine and proposals 規則引擎與提案
-- ---------------------------------------------------------------------------

create table public.rules (
  id text primary key check (id ~ '^[A-Z][A-Z0-9_]*$'),
  feature text not null,
  desc_en text not null,
  desc_zh text not null,
  condition text not null check (condition ~ '^[a-z][a-z0-9_]*$'),
  threshold jsonb not null default '{}'::jsonb check (jsonb_typeof(threshold) = 'object'),
  action text not null check (action ~ '^[a-z][a-z0-9_]*$'),
  cooldown_days integer not null default 7 check (cooldown_days >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.rules is 'The Investment Policy Statement in executable form (Section 4); every edit is logged in rule_changes 可執行的投資政策聲明';
comment on column public.rules.feature is 'Feature that owns the rule, as in the Section 4 Source column 負責的功能';
comment on column public.rules.condition is 'Evaluator the rules engine runs 規則引擎使用的判斷式';
comment on column public.rules.threshold is 'All numbers the condition uses, editable 判斷用的所有門檻（可調整）';
create trigger rules_touch before update on public.rules
  for each row execute function private.touch_updated_at();

create table public.rule_changes (
  id bigint generated always as identity primary key,
  rule_id text not null references public.rules (id) on update cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  old_value jsonb not null,
  new_value jsonb not null
);
comment on table public.rule_changes is 'Log of rule edits with old and new values, written by a trigger 規則修改紀錄（由觸發器寫入）';
create index rule_changes_rule_id_changed_at_idx on public.rule_changes (rule_id, changed_at);

create table public.proposals (
  id bigint generated always as identity primary key,
  rule_id text not null references public.rules (id) on update cascade,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'approved', 'dismissed', 'filled', 'expired')),
  orders jsonb not null default '[]'::jsonb check (jsonb_typeof(orders) = 'array'),
  dismiss_reason text,
  decided_at timestamptz,
  expires_at timestamptz
);
comment on table public.proposals is 'Proposals a fired rule drafts (L2); Hugo approves, edits or dismisses, then trades by hand 規則觸發的提案';
comment on column public.proposals.orders is 'Draft orders: ticker, side, qty, amount in TWD and trade currency, estimated fee 建議下單清單';
create index proposals_status_created_at_idx on public.proposals (status, created_at);
create index proposals_rule_id_idx on public.proposals (rule_id);

-- ---------------------------------------------------------------------------
-- Windfall 大額資金
-- ---------------------------------------------------------------------------

create table public.windfall_plan (
  id bigint generated always as identity primary key,
  total_twd numeric not null check (total_twd > 0),
  received_on date not null,
  cape_percentile numeric check (cape_percentile between 0 and 100),
  tranche_count integer check (tranche_count > 0),
  tiers_fired jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers_fired) = 'array'),
  current_drawdown_peak numeric check (current_drawdown_peak > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.windfall_plan is 'Windfall deployment plan (F3), core classes only 大額資金分批計畫（僅核心資產）';
create trigger windfall_plan_touch before update on public.windfall_plan
  for each row execute function private.touch_updated_at();

create table public.windfall_tranches (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.windfall_plan (id) on delete cascade,
  due_date date not null,
  amount_twd numeric not null check (amount_twd > 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'accelerated', 'done')),
  proposal_id bigint references public.proposals (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.windfall_tranches is 'Tranches of the windfall plan (F3) 大額資金各批次';
create index windfall_tranches_plan_id_due_date_idx on public.windfall_tranches (plan_id, due_date);
create index windfall_tranches_proposal_id_idx on public.windfall_tranches (proposal_id);
create trigger windfall_tranches_touch before update on public.windfall_tranches
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Security analysis 證券分析
-- ---------------------------------------------------------------------------

create table public.valuations (
  id bigint generated always as identity primary key,
  ticker text not null references public.securities (ticker) on update cascade,
  valuation_date date not null,
  model text not null check (model in ('dcf_fcff', 'ddm', 'multiples')),
  iv_bear numeric,
  iv_base numeric,
  iv_bull numeric,
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  created_at timestamptz not null default now(),
  unique (ticker, valuation_date, model),
  constraint valuations_scenario_order_check check (iv_bear <= iv_base and iv_base <= iv_bull)
);
comment on table public.valuations is 'Intrinsic value per share in the trade currency, bear / base / bull (F12) 每股內在價值';

create table public.beta_results (
  id bigint generated always as identity primary key,
  ticker text not null,
  benchmark text not null check (benchmark ~ '^[A-Z0-9][A-Z0-9_]*$'),
  model text not null check (model in ('1F', '5F')),
  freq text not null check (freq in ('daily', 'weekly', 'monthly')),
  window_years integer not null check (window_years > 0),
  currency_basis text not null default 'local' check (currency_basis in ('local', 'TWD')),
  beta numeric,
  alpha numeric,
  factor_loadings jsonb check (jsonb_typeof(factor_loadings) = 'object'),
  r2 numeric check (r2 between 0 and 1),
  std_err numeric check (std_err >= 0),
  run_date date not null,
  created_at timestamptz not null default now(),
  unique (ticker, benchmark, model, freq, window_years, currency_basis, run_date)
);
comment on table public.beta_results is 'Regression Lab results (N1) for any ticker, so no link to securities 回歸分析結果';
create index beta_results_ticker_run_date_idx on public.beta_results (ticker, run_date);

create table public.red_flags (
  id bigint generated always as identity primary key,
  ticker text not null references public.securities (ticker) on update cascade,
  flag_date date not null,
  indicator text not null check (indicator in (
    'beneish_m', 'altman_z', 'auditor_change', 'going_concern', 'restatement',
    'cash_flow_vs_earnings', 'governance_rating', 'environmental_penalties', 'excluded_business'
  )),
  value numeric,
  level text not null check (level in ('green', 'amber', 'red')),
  coverage_pct numeric check (coverage_pct between 0 and 100),
  created_at timestamptz not null default now(),
  unique (ticker, flag_date, indicator)
);
comment on table public.red_flags is 'Red-flag indicators per company (N3); display only 紅旗指標（僅顯示）';

create table public.attribution (
  id bigint generated always as identity primary key,
  period_start date not null,
  period_end date not null,
  level smallint not null check (level in (1, 2)),
  segment text not null,
  allocation numeric not null,
  selection numeric not null,
  interaction numeric not null,
  fx numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (period_start, period_end, level, segment),
  constraint attribution_period_check check (period_end >= period_start)
);
comment on table public.attribution is 'Brinson–Fachler effects per segment (N2), as fractions of return 績效歸因效果';

create table public.watchlist (
  ticker text primary key references public.securities (ticker) on update cascade,
  added_on date not null default (now() at time zone 'Asia/Taipei')::date,
  buy_threshold numeric check (buy_threshold > 0 and buy_threshold < 1),
  trim_threshold numeric check (trim_threshold > 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.watchlist is 'Watchlist (F12, N3); empty thresholds fall back to the BUY_ZONE and TRIM_ZONE rules 觀察清單';
comment on column public.watchlist.buy_threshold is 'Buy when price <= intrinsic value × this, e.g. 0.75 買入門檻倍數';
comment on column public.watchlist.trim_threshold is 'Trim when price >= intrinsic value × this, e.g. 1.25 減碼門檻倍數';
create trigger watchlist_touch before update on public.watchlist
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Settings, devices and audit 設定、裝置與稽核
-- ---------------------------------------------------------------------------

create table public.config (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  value jsonb not null,
  desc_en text not null,
  desc_zh text not null,
  last_verified date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.config is 'Editable settings outside any single rule: quiet hours, schedules, tax thresholds, CMA 可編輯設定';
comment on column public.config.last_verified is 'When a rule-based value such as a tax threshold was last checked 最後確認日期';
create trigger config_touch before update on public.config
  for each row execute function private.touch_updated_at();

create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique check (endpoint ~ '^https://'),
  keys jsonb not null check (jsonb_typeof(keys) = 'object' and keys ? 'p256dh' and keys ? 'auth'),
  device_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
comment on table public.push_subscriptions is 'Web Push subscriptions, one per device (phone, Mac) 推播訂閱（每台裝置一筆）';

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_key text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
comment on table public.audit_log is 'Edits and deletes of holdings, cash flows, targets and settings, written by triggers (N5) 持倉與設定的修改紀錄';
create index audit_log_table_name_row_key_idx on public.audit_log (table_name, row_key, changed_at);
