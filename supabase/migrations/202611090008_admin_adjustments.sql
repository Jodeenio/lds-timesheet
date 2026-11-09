alter table public.timesheets
  add column revision integer not null default 1,
  add column adjusted_at timestamptz,
  add column adjusted_by uuid references auth.users(id) on delete set null,
  add column adjusted_shifts jsonb not null default '{}'::jsonb,
  add column adjustment_history jsonb not null default '[]'::jsonb;
