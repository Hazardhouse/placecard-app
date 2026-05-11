-- ============================================================
-- PlaceCard: Profiles, Subscriptions & Email Subscribers
-- ============================================================

-- Profiles — extends Supabase Auth users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text not null,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Subscriptions — tracks Stripe billing state
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'per_event', 'event_planner')),
  stripe_customer_id text unique,
  stripe_price_id text,
  stripe_subscription_id text unique,
  status text not null default 'active' check (status in ('active', 'canceled', 'past_due', 'incomplete', 'trialing')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- Email subscribers — for weekly update mailing list
create table public.email_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  user_id uuid references public.profiles(id) on delete set null,
  subscribed boolean default true,
  source text default 'signup',
  created_at timestamptz default now()
);

-- Indexes
create index idx_subscriptions_user_id on public.subscriptions(user_id);
create index idx_subscriptions_stripe_customer on public.subscriptions(stripe_customer_id);
create index idx_email_subscribers_email on public.email_subscribers(email);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.email_subscribers enable row level security;

-- Profiles: users can read/update their own profile
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Subscriptions: users can read their own subscription
create policy "Users can read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Email subscribers: no direct user access (managed by Edge Functions)
-- Service role key used by webhook to insert/update

-- ============================================================
-- Trigger: auto-create profile on signup
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );

  insert into public.subscriptions (user_id, tier, status)
  values (new.id, 'free', 'active');

  insert into public.email_subscribers (email, full_name, user_id, source)
  values (
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.id,
    'signup'
  )
  on conflict (email) do update set user_id = new.id, subscribed = true;

  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Trigger: updated_at auto-update
-- ============================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
