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

-- Only the server (service_role) gets access. Browsers (anon/authenticated) get nothing.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.plans, public.outreach, public.usage to service_role;
grant execute on function public.bump_usage(uuid, text, int, int) to service_role;
revoke all on public.plans, public.outreach, public.usage from anon, authenticated;

-- ---------- v2: cart, calendar feed, resumes, tailoring ----------
create table if not exists public.cart_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  opp         jsonb not null,
  detail      jsonb,
  status      text not null default 'saved' check (status in ('saved','applying','submitted','interview','offer','dropped')),
  done        jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cart_user_created on public.cart_items (user_id, created_at desc);

create table if not exists public.cal_tokens (
  user_id  uuid primary key references auth.users on delete cascade,
  token    text not null unique
);

create table if not exists public.resumes (
  user_id       uuid primary key references auth.users on delete cascade,
  base          jsonb,
  linkedin_url  text,
  source_names  jsonb,
  updated_at    timestamptz not null default now()
);

create table if not exists public.tailored (
  user_id      uuid not null references auth.users on delete cascade,
  cart_id      uuid not null references public.cart_items on delete cascade,
  resume       jsonb,
  suggestions  jsonb,
  decisions    jsonb,
  fit_notes    text,
  keywords     jsonb,
  updated_at   timestamptz not null default now(),
  primary key (user_id, cart_id)
);

alter table public.cart_items enable row level security;
alter table public.cal_tokens enable row level security;
alter table public.resumes    enable row level security;
alter table public.tailored   enable row level security;
grant select, insert, update, delete on public.cart_items, public.cal_tokens, public.resumes, public.tailored to service_role;
revoke all on public.cart_items, public.cal_tokens, public.resumes, public.tailored from anon, authenticated;

-- ---------- v3: onboarding profile ----------
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;
grant select, insert, update, delete on public.profiles to service_role;
revoke all on public.profiles from anon, authenticated;
