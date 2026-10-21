-- Minimal stand-in for the parts of a Supabase database that the migrations rely on, so the
-- schema and its row-level security can be tested on plain Postgres or PGlite:
--   * the anon, authenticated and service_role roles (service_role bypasses RLS, as on Supabase);
--   * auth.users and auth.uid(), which reads the caller's id from the request JWT claims.
-- Like a Supabase project created after 2026-05-30, it grants no table privileges by default.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text unique
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
