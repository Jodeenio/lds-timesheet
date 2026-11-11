-- Browser roles still have no access; the Edge Function enforces owner-only deletion.
grant delete on public.timesheets to service_role;
