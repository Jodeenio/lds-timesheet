begin;
alter table public.timesheets add column denial_reason text;
alter table public.timesheets drop constraint timesheets_status_check;
update public.timesheets set status = 'denied', denial_reason = 'No reason recorded for this earlier review.' where status = 'returned';
alter table public.timesheets add constraint timesheets_status_check check (status in ('pending', 'approved', 'denied'));
alter table public.timesheets add constraint timesheets_denial_reason_check check (
  (status = 'denied' and denial_reason is not null and length(trim(denial_reason)) between 1 and 1000)
  or (status <> 'denied' and denial_reason is null)
);
commit;
