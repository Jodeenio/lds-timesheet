create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  employee_name text not null,
  employee_email text not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  days jsonb not null check (jsonb_typeof(days) = 'object'),
  total_minutes integer not null check (total_minutes > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (user_id, week_start)
);
create index timesheets_week_idx on public.timesheets (week_start desc, submitted_at desc, id);
alter table public.timesheets enable row level security;
revoke all on public.timesheets from anon, authenticated;
grant select, insert, update on public.timesheets to service_role;
