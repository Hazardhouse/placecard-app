-- ============================================================
-- PlaceCard: Waitlist Signups & Referral Tracking
-- ============================================================

-- Waitlist signups
create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text not null,
  referral_code text not null unique,
  referred_by text references public.waitlist_signups(referral_code),
  wants_referral boolean default false,
  created_at timestamptz default now()
);

-- Referral conversions — tracked when a referred user signs up for a paid plan
create table public.referral_conversions (
  id uuid primary key default gen_random_uuid(),
  referrer_code text not null references public.waitlist_signups(referral_code),
  referred_email text not null,
  tier text,
  commission_pct numeric default 15,
  status text default 'pending' check (status in ('pending', 'paid', 'canceled')),
  created_at timestamptz default now()
);

-- Indexes
create index idx_waitlist_referral_code on public.waitlist_signups(referral_code);
create index idx_waitlist_referred_by on public.waitlist_signups(referred_by);
create index idx_referral_conversions_code on public.referral_conversions(referrer_code);

-- RLS
alter table public.waitlist_signups enable row level security;
alter table public.referral_conversions enable row level security;

-- No direct user access — managed by Edge Functions via service role
