begin;
alter table public.staff_data add column custom_rates jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom_rates) = 'object');

-- Backfill the hidden overtime definitions for existing custom types.
update public.staff_data
set work_type_settings = jsonb_set(work_type_settings, '{customOvertimeTypes}',
  coalesce((select jsonb_agg(jsonb_build_object(
    'key', type->>'key' || ':overtime',
    'label', type->>'label' || ' overtime', 'hidden', true))
    from jsonb_array_elements(coalesce(work_type_settings->'customTypes', '[]'::jsonb)) as definitions(type)), '[]'::jsonb))
where work_type_settings is not null;
commit;
