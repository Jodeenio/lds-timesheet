alter table public.staff_rates
  add column tax_mode text not null default 'none' check (tax_mode in ('none', 'add', 'subtract')),
  add column tax_percent numeric(5,2) not null default 0 check (tax_percent between 0 and 100);
