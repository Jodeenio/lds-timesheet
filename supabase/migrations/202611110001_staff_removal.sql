-- Store the explicit choice before deleting the Auth account through its API.
create table public.staff_removal_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  keep_approved_timesheets boolean not null
);

alter table public.staff_removal_requests enable row level security;
revoke all on public.staff_removal_requests from anon, authenticated;
grant select, insert, update, delete on public.staff_removal_requests to service_role;

-- The trigger and Auth deletion share a transaction: either both succeed or
-- neither does. Rates/settings cascade; retained timesheets keep their snapshot
-- and have user_id set null by the existing foreign key.
create function public.cleanup_removed_staff_timesheets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep_approved boolean;
begin
  select keep_approved_timesheets into keep_approved
  from public.staff_removal_requests where user_id = old.id;

  -- Other Supabase account deletion flows retain their existing behaviour.
  if found then
    delete from public.timesheets
    where user_id = old.id
      and (not keep_approved or status <> 'approved');
  end if;
  return old;
end;
$$;

revoke all on function public.cleanup_removed_staff_timesheets() from public, anon, authenticated;

create trigger cleanup_staff_timesheets_before_removal
before delete on auth.users
for each row execute function public.cleanup_removed_staff_timesheets();
