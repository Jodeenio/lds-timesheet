create table public.staff_rates (
  user_id uuid primary key references auth.users(id) on delete cascade,
  regular numeric(10,2) check (regular >= 0),
  overtime numeric(10,2) check (overtime >= 0),
  public_holiday numeric(10,2) check (public_holiday >= 0),
  public_holiday_overtime numeric(10,2) check (public_holiday_overtime >= 0),
  updated_at timestamptz not null default now()
);

alter table public.staff_rates enable row level security;
-- Rates are accessed only through the admin-verified Edge Function.
revoke all on public.staff_rates from anon, authenticated;
grant select, insert, update, delete on public.staff_rates to service_role;
