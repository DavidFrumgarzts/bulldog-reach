-- Bulldog Reach beta schema. Paste into Supabase → SQL Editor → Run.
-- All tables have RLS on with NO policies: only the server (service role key) can read/write.
-- The browser only talks to Supabase for sign-in; everything else goes through our server.

create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  goal        text not null,
  liked       jsonb not null default '[]'::jsonb,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists plans_user_created on public.plans (user_id, created_at desc);

create table if not exists public.outreach (
  plan_id     uuid not null references public.plans on delete cascade,
  person      text not null,
  user_id     uuid not null references auth.users on delete cascade,
  status      text not null check (status in ('todo','sent','replied','meeting','referred','no_reply')),
  updated_at  timestamptz not null default now(),
  primary key (plan_id, person)
);

create table if not exists public.usage (
  user_id  uuid not null references auth.users on delete cascade,
  day      date not null,
  kind     text not null,
  count    int  not null default 0,
  primary key (user_id, day, kind)
);

alter table public.plans    enable row level security;
alter table public.outreach enable row level security;
alter table public.usage    enable row level security;

-- Atomically count one Grok call. Returns new count, -1 if the user hit today's limit,
-- -2 if the whole app hit its monthly cap.
create or replace function public.bump_usage(p_user uuid, p_kind text, p_limit int, p_monthly_cap int)
returns int language plpgsql security definer set search_path = public as $$
declare c int; m int;
begin
  select coalesce(sum(count), 0) into m from usage where day >= date_trunc('month', now())::date;
  if m >= p_monthly_cap then return -2; end if;
  insert into usage (user_id, day, kind, count) values (p_user, current_date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = usage.count + 1 where usage.count < p_limit
  returning count into c;
  if c is null then return -1; end if;
  return c;
end $$;

revoke all on function public.bump_usage(uuid, text, int, int) from public, anon, authenticated;
