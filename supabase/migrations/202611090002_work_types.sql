create table public.work_types (
  key text primary key,
  label text not null,
  sort_order integer not null
);
insert into public.work_types (key, label, sort_order) values
  ('regular', 'Regular', 1),
  ('overtime', 'Overtime', 2),
  ('public holiday', 'Public holiday', 3),
  ('public holiday overtime', 'Public holiday overtime', 4);
alter table public.work_types enable row level security;
revoke all on public.work_types from anon, authenticated;
grant select on public.work_types to service_role;

-- NULL means all default types enabled and custom types switched off.
-- Kept on the same UID-keyed row as each employee's rates.
alter table public.staff_rates add column work_type_settings jsonb
  check (work_type_settings is null or jsonb_typeof(work_type_settings) = 'object');
