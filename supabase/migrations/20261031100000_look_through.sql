-- Phase 2, step 6 (F14): the combined look-through of core and satellite.
--
-- fund_holdings: each fund's newest holdings file from its issuer, read by the nightly job once a
--   month (Vanguard for VT and VOO, Fubon for 00692): one row per fund, its constituents as
--   compact arrays [key, name, ticker, country, currency, sector, asset type, weight], weights as
--   fractions of the fund. The owner reads them; only the job writes them.
-- company_profiles.sector: a single stock's GICS sector, for the stocks held directly: US ones from
--   the Select Sector SPDR funds' holdings, Taiwan ones from their TWSE industry.
-- look_through (config): which funds have a holdings file and where from, the country of a fund
--   shown whole, the days before a file is read again, how many companies are named, and the map
--   from TWSE industry codes to GICS sectors (a starting map, PRD Section 9).

create table public.fund_holdings (
  fund text primary key references public.securities (ticker) on update cascade,
  as_of date not null,
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  constituents jsonb not null check (jsonb_typeof(constituents) = 'array'),
  loaded_at timestamptz not null default now()
);
comment on table public.fund_holdings is 'Each fund''s newest holdings file from its issuer (F14) 基金成分股';
comment on column public.fund_holdings.constituents is '[key, name, ticker, country, currency, sector, asset type, weight] per line; key "TW:2330" is the ISIN''s country and the ticker 成分股（權重為比例）';

alter table public.fund_holdings enable row level security;
revoke all on table public.fund_holdings from anon, authenticated, service_role;
grant select on table public.fund_holdings to authenticated;
grant select, insert, update, delete on table public.fund_holdings to service_role;
create policy owner_read_only on public.fund_holdings for select to authenticated using ((select private.is_owner()));

alter table public.company_profiles add column sector text check (sector in (
  'Information Technology', 'Financials', 'Health Care', 'Consumer Discretionary', 'Communication Services',
  'Industrials', 'Consumer Staples', 'Energy', 'Materials', 'Utilities', 'Real Estate'
));
comment on column public.company_profiles.sector is 'GICS sector (F14): US from the Select Sector SPDR funds, Taiwan from the TWSE industry GICS 產業';

insert into public.config (key, value, desc_en, desc_zh) values
  ('look_through', '{
     "sources": {"VT": {"source": "vanguard", "id": "VT"}, "VOO": {"source": "vanguard", "id": "VOO"}, "00692": {"source": "fubon", "id": "00692"}},
     "fund_country": {"BIL": "US", "0050": "TW", "009816": "TW", "00922": "TW"},
     "refresh_days": 28,
     "top_companies": 30,
     "tw_sectors": {
       "01": "Materials", "02": "Consumer Staples", "03": "Materials", "04": "Consumer Discretionary", "05": "Industrials",
       "06": "Industrials", "08": "Industrials", "09": "Materials", "10": "Materials", "11": "Consumer Discretionary",
       "12": "Consumer Discretionary", "14": "Real Estate", "15": "Industrials", "16": "Consumer Discretionary",
       "17": "Financials", "18": "Consumer Discretionary", "19": "Industrials", "20": "Industrials", "21": "Materials",
       "22": "Health Care", "23": "Utilities", "24": "Information Technology", "25": "Information Technology",
       "26": "Information Technology", "27": "Information Technology", "28": "Information Technology",
       "29": "Information Technology", "30": "Information Technology", "31": "Information Technology",
       "32": "Communication Services", "33": "Consumer Staples", "34": "Consumer Discretionary", "35": "Industrials",
       "36": "Information Technology", "37": "Consumer Discretionary", "38": "Consumer Discretionary"
     },
     "last_verified": null
   }',
   'Combined look-through (F14): each fund read from its issuer''s holdings file and where from, the country of a fund shown whole, the days before a file is read again, the companies named, and each TWSE industry''s GICS sector.',
   '核心與衛星合併透視（F14）：各基金的成分股來源、未展開基金的國家、成分股重新讀取的天數、列出名稱的公司數，以及證交所各產業對應的 GICS 產業。');
