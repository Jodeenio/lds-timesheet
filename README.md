# LDS staff timesheet

Static staff timesheet with Supabase Auth. Serve this folder using an HTTP server or your existing static host.

## Configure staff login

1. Create or choose your Supabase project.
2. In `supabase-config.js`, set `url` to the project URL and `publishableKey` to the project's public publishable key (the legacy public `anon` key also works). Never use a secret or `service_role` key in browser files.
3. In Supabase Authentication settings, enable Email authentication and **disable Allow new users to sign up**. Every authenticated account in this project can open the timesheet, so use a dedicated staff project or ensure all existing accounts belong to staff. Hiding signup in the page alone does not restrict account creation.
4. Under Authentication > URL Configuration, set Site URL to your deployed staff site and add the exact page URL to Redirect URLs, for example `https://staff.ldsairandelectrical.com.au/index.html`. Add your local HTTP URL separately for development.
5. Add staff through Authentication > Users. Create accounts with initial passwords or invite staff by email. Staff can also use **Email me a sign-in link** with an existing account; this flow does not create new users.
6. Configure production SMTP in Supabase for reliable sign-in and invitation emails.

No database tables or SQL migrations are required for login. Sessions persist using the Supabase client and sign out applies to the current browser.

## Admin and staff routing

### Employee settings and rates

Apply `supabase/migrations/202611090005_custom_overtime.sql` after migration 002 and redeploy the function and site. It adds `staff_rates.custom_rates` and backfills a hidden `[custom name] overtime` definition for each existing custom type. Saving work types keeps these definitions in `work_type_settings.customOvertimeTypes`. Both custom base and overtime rates appear in the Rates tab (including when custom types are switched off), with blank/unset and zero remaining distinct. Custom overtime uses a stable key such as `custom:1:overtime`, is generated automatically after eight hours and is never offered as a new manual selection. Previously saved shifts are not rewritten; edit a shift to apply splitting. Rates remain stored by slot when names change or types are switched off.

**Current tables: `work_types` and `staff_rates`.** Shared default definitions live once in `work_types`; employee rates, enabled defaults and custom types live in the UID-keyed `staff_rates` table. Apply migration 001, then 002, then 005. If 001 and 002 are already applied, run only the updated `supabase/migrations/202611090005_custom_overtime.sql`, then redeploy `staff-admin` and the site. Auth account details remain in Supabase Auth.

The **Work types** tab controls each employee's enabled default types and up to three named custom types, with a switch to enable custom types. At least one type must remain enabled. Existing employees keep all defaults until configured; switching custom types off retains their names for later use. Migration 002 seeds the four current default types and keeps work-type settings alongside rates in `staff_rates`.

Staff retrieve only their own enabled work types through the authenticated `my-work-types` action, which does not return rates or another employee's settings. Work type tables remain inaccessible directly from the browser. Reload the staff timesheet after changing assignments. If configuration cannot load, editing pauses and a retry button appears. Existing shifts retain disabled/custom types and saved custom labels, including in CSV exports. New shifts use the first enabled type. Custom shifts split after eight hours into their own hidden overtime type; regular/public-holiday shifts split only when their corresponding overtime type is enabled. Rates remain stored separately within the same employee row; custom base/overtime rates are configurable but pay calculations are not connected.

Validate with two staff accounts: disable a default and add custom types to one account, confirm the other is unchanged, toggle custom types off/on, and reload the timesheet. Confirm old shifts remain readable, the dropdown offers only assigned types, custom shifts over eight hours split into the correct hidden overtime type, and neither account can retrieve or edit the other's assignments.

Open the vertical three-dot button on a staff row for **General** and **Rates** settings. General edits first name, last name, email and phone, sends a password reset email to the saved email address, and contains employee removal. Names continue to populate `user_metadata.full_name`; new invitations and edits also save `first_name` and `last_name`. Existing full names are split at the first space when first opened; review multi-part names before saving. Admin email edits apply directly through the Auth admin API, so double-check addresses before saving.

The `staff_rates` table uses the Auth UID as its primary/foreign key and deletes rates when the user is removed. RLS is enabled and browser roles have no access; the admin-verified function handles reads and writes. Each employee can have separate AUD hourly rates for regular, overtime, public holiday and public holiday overtime. Blank means unset; zero is a valid rate. These settings store rates only; timesheet pay calculations are not yet connected.

Add the exact `welcome/?mode=reset` URL under Supabase Auth redirect URLs. Password reset emails open the existing password setup page with reset wording. Email delivery uses Supabase Auth/SMTP.

Before production use, verify edits persist after reopening settings, metadata such as `onboarding_complete` survives edits, reset emails reach the saved address, rates remain separate for two employees, blank and zero rates remain distinct, and staff/anonymous callers cannot read or change rates. Verify protected admin accounts cannot be removed.

The dashboard's **Remove** action permanently deletes a staff Auth account after confirmation. Administrator accounts are protected, including the signed-in admin; the server enforces these restrictions. Removing an account does not erase timesheets stored in that person's browser. Deploy the updated `staff-admin` Edge Function alongside the dashboard to enable removal. Verify cancellation leaves the account unchanged, a confirmed removal disappears from the list, and staff or unauthenticated requests cannot remove users.

Staff accounts open `index.html`. Accounts with `app_metadata.role` set to `admin` open `dashboard/`. The static host must serve `dashboard/index.html` for `/dashboard/` (and ideally redirect `/dashboard` to `/dashboard/`). Deploy the dashboard folder alongside the other files. Its relative base URL also supports hosting the app under a subdirectory.

To promote an existing account, run this in the **Supabase dashboard SQL Editor**, replacing the email with the intended administrator's email:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"role":"admin"}'::jsonb
where email = 'your-admin@example.com'
returning id, email, raw_app_meta_data;
```

Confirm the returned email is correct. Sign out and back in to verify the admin redirect. To demote the account, run the same statement using `{"role":"staff"}` instead. Accounts without the custom role default to staff. Do not change the built-in Supabase user `role` (`authenticated`), or use editable `user_metadata` for admin permissions.

Role checks fetch the current user from Supabase before showing either workspace. Test an admin login, a staff login, a staff visit directly to `/dashboard/`, and dashboard reload/sign out. Login email links can still return to the existing configured staff page, which routes admins to the dashboard after verifying their role.

The dashboard's staff list and invitations use an Edge Function that checks admin permissions on every request. Browser redirects do not enforce database permissions: future shared timesheet queries must enforce authorization through RLS or server checks. Never expose a service-role key in this app.

## Staff invitations and onboarding

The admin dashboard lists staff accounts above the timesheet section. **Add staff** requires the admin to enter the staff member's first name, last name and email, then sends Supabase's standard invitation email. The name is saved as `full_name` in Auth user metadata. The invitation link opens `welcome/`, where staff enter an optional phone number and a password (at least 12 characters), preserving the name set by the admin. Admin permissions remain in server-controlled app metadata.

### Deploy the required Edge Function

1. Deploy all site files, including `dashboard/`, `welcome/`, `dashboard.js` and `welcome.js`.
2. In Supabase **Edge Functions > Secrets**, add `APP_URL` with your actual app base URL, for example `https://staff.ldsairandelectrical.com.au/`. If hosted under a subdirectory, include that path and a trailing slash. This server setting controls where invitations send users.
3. Create and deploy an Edge Function named **staff-admin** using `supabase/functions/staff-admin/index.ts`. The hosted runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; never copy the service-role key into browser files.
4. Disable the function's gateway **Verify JWT** / legacy JWT verification option. The function verifies the bearer token itself with Supabase Auth and checks `app_metadata.role === 'admin'` for every request. This supports projects using the newer signing keys. CLI deployment reads this setting from `supabase/config.toml`.
5. Under **Authentication > URL Configuration > Redirect URLs**, add the exact welcome URL, for example `https://staff.ldsairandelectrical.com.au/welcome/`. Keep the existing staff URLs too.
6. Configure production SMTP under Authentication. Keep the Invite user email template's confirmation link (`{{ .ConfirmationURL }}`), so Supabase verifies the invitation before redirecting to the welcome page.

If using the Supabase CLI from a machine where it is installed:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set APP_URL=https://staff.ldsairandelectrical.com.au/
supabase functions deploy staff-admin
```

Invitations are not sent automatically by deploying this code. To test, sign in as an admin, invite a new test email, open its invitation in a private browser, complete the details, then refresh the admin staff list. Existing accounts should use normal sign in; the Add staff flow is for new users. Verify a staff token receives HTTP 403 from the function and an unauthenticated request receives HTTP 401. Do not use the Supabase SQL editor to insert Auth users manually.

The staff list includes all Auth accounts in the dedicated staff project, including administrators, with pagination. Submitted timesheets appear below the staff list, grouped by Monday–Sunday week headings with expandable employee shift details. Staff profile metadata is editable by that staff member and must never grant permissions.

## Timesheet submissions and approval

Apply `supabase/migrations/202611090006_timesheets.sql` after the earlier migrations. Deploy the full `supabase/functions/staff-admin` directory, including the new `timesheets.js` helper imported by `index.ts`, and the updated static site. If editing the function in the Supabase dashboard, add `timesheets.js` as a second file before deploying. This adds a `timesheets` table alongside the existing settings tables.

Drafts save locally under a separate key for each Auth UID. **Submit timesheet** uploads the selected week's completed shifts to the server for admin review; blank days count as days off. The server validates dates, work-type assignments, times and overlaps, recalculates totals and overtime, and snapshots employee identity/work-type labels. Pending and approved weeks are locked and load from the server on other devices. An admin can approve or return a pending submission; returned weeks can be edited and resubmitted. Submitted weeks are unique per employee. Approval checks the submission timestamp/status to prevent stale reviews, and repeat submissions cannot overwrite pending/approved sheets.

The admin dashboard groups submissions by week and shows employee names, hours, status and expandable daily shifts, with Approve and Return for changes actions. Load more retrieves older submissions and retains week grouping. Refresh retrieves new submissions. Staff can retrieve only their own weekly submission; list/review actions require the verified admin role. RLS is enabled, browser roles have no table access, and the Edge Function performs server-authorized operations. Removing an employee retains submitted records and their identity snapshot. Rates/pay calculations are not part of approval yet.

Verify a staff submission appears under the correct week, survives sign-out and another device, cannot be edited while pending/approved, and can be resubmitted after return. Verify other staff cannot retrieve it and cannot list or review submissions. Test an overnight shift and an overlapping pair, a disabled work type, repeated submission, and a review made from an outdated page.

Existing anonymous data (`tempo-weekly-v1` and `tempo-v1`) is preserved untouched. It is not automatically assigned to the first staff member who logs in, and shared legacy exports are no longer exposed. Export any needed anonymous entries from the previous app before upgrading.

Local drafts are accessible to someone with access to the browser profile. Signing out clears the visible timesheet but retains that employee's local drafts. Only submitted weeks sync to the server.

## Verify

- Without configuration, confirm the setup message appears and the timesheet stays hidden.
- Sign in with a provisioned staff account, edit a shift, reload, and verify the session and entries restore.
- Sign out, sign in as a second staff member, and verify the first member's entries are not displayed.
- Check invalid credentials, a sign-in email callback, expired sessions, and sign out.

Reference: [Supabase password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword) and [email OTP / magic links](https://supabase.com/docs/reference/javascript/auth-signinwithotp).
