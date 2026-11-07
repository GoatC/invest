-- N8 volatility alert, step 4 (added 2026-11-07): breaking-news alerts. Hugo asked to be told only
-- of news that may move markets, besides the volatility score.
--
-- config news: the topics (each a list of terms in English and Chinese), the window counted
--   (3 hours), the outlets needed (10), how many times its usual count a topic must reach (3;
--   until half a day of counts is saved, 3 × 10 = 30 outlets),
--   the days its usual count is taken over (7), the hours before a topic alerts again (12), and
--   whether the push goes through the quiet hours (yes, as for the volatility alert).
-- news_counts: each run's count of different outlets per topic, the usual count's history,
--   kept for baseline_days and written by the news job only.
-- news_alerts: each breaking-news alert, its count, usual count and newest headlines, written by
--   the job only; the push job pushes each once (notifications kind news).

insert into public.config (key, value, desc_en, desc_zh) values
  ('news', '{
     "window_hours": 3,
     "min_sources": 10,
     "spike": 3,
     "baseline_days": 7,
     "cooldown_hours": 12,
     "push_in_quiet_hours": true,
     "topics": {
       "war": {"en": "War or strikes", "zh": "戰爭／空襲", "terms": ["airstrike", "air strikes", "missile attack", "invasion", "declares war", "strikes on", "空襲", "飛彈攻擊", "軍事攻擊"]},
       "taiwan_strait": {"en": "Taiwan Strait", "zh": "台海情勢", "terms": ["Taiwan Strait", "blockade of Taiwan", "PLA drills", "台海", "封鎖台灣", "解放軍演習", "共軍演習"]},
       "central_bank": {"en": "Emergency central bank move", "zh": "央行緊急行動", "terms": ["emergency rate cut", "emergency rate hike", "emergency meeting", "緊急降息", "緊急升息", "央行緊急"]},
       "crash": {"en": "Market crash", "zh": "市場崩跌", "terms": ["circuit breaker", "market crash", "trading halted", "stocks plunge", "熔斷", "股市崩盤", "股市暴跌", "台股重挫"]},
       "financial": {"en": "Financial crisis", "zh": "金融危機", "terms": ["bank failure", "bank run", "sovereign default", "liquidity crisis", "銀行倒閉", "擠兌", "債務違約", "流動性危機"]},
       "trade": {"en": "Tariffs or sanctions", "zh": "關稅／制裁", "terms": ["new tariffs", "sanctions on", "export controls", "trade war", "加徵關稅", "制裁", "出口管制", "貿易戰"]},
       "disaster": {"en": "Major disaster", "zh": "重大災害", "terms": ["Taiwan earthquake", "major earthquake", "tsunami warning", "強震", "大地震", "海嘯警報"]}
     }
   }',
   'Breaking news (N8): a topic alerts when at least min_sources outlets report it within window_hours, spike times its usual count (the median of its runs over baseline_days); once per cooldown_hours.',
   '前沿新聞（N8）：某主題在 window_hours 小時內至少有 min_sources 家媒體報導、且達平常家數（近 baseline_days 天中位數）的 spike 倍時通知；每 cooldown_hours 小時最多一次。');

create table public.news_counts (
  topic text not null check (topic ~ '^[a-z][a-z0-9_]*$'),
  counted_at timestamptz not null,
  sources integer not null check (sources >= 0),
  primary key (topic, counted_at)
);
comment on table public.news_counts is 'Each run''s count of outlets per news topic (N8), the usual count''s history 新聞主題每次統計的媒體家數';

create table public.news_alerts (
  id bigint generated always as identity primary key,
  topic text not null check (topic ~ '^[a-z][a-z0-9_]*$'),
  detected_at timestamptz not null default now(),
  sources integer not null check (sources > 0),
  baseline numeric check (baseline >= 0),
  window_hours numeric not null check (window_hours > 0),
  headlines jsonb not null check (jsonb_typeof(headlines) = 'array')
);
comment on table public.news_alerts is 'Breaking-news alerts (N8): the topic, outlets counted, usual count and newest headlines 前沿新聞警報';
create index news_alerts_topic_detected_idx on public.news_alerts (topic, detected_at desc);

alter table public.news_counts enable row level security;
alter table public.news_alerts enable row level security;
revoke all on table public.news_counts from anon, authenticated, service_role;
revoke all on table public.news_alerts from anon, authenticated, service_role;
grant select on table public.news_counts, public.news_alerts to authenticated;
grant select, insert, update, delete on table public.news_counts, public.news_alerts to service_role;
create policy owner_read_only on public.news_counts for select to authenticated using ((select private.is_owner()));
create policy owner_read_only on public.news_alerts for select to authenticated using ((select private.is_owner()));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('proposal', 'weekly', 'data_failure', 'test', 'event', 'news'));
