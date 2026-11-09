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

## Timesheet storage

Timesheets still save only in this browser, under a separate local-storage key for each Supabase user ID. They do not sync to Supabase or between devices. Signing out clears the visible timesheet but retains that staff member's browser copy for their next login.

Existing anonymous data (`tempo-weekly-v1` and `tempo-v1`) is preserved untouched. It is not automatically assigned to the first staff member who logs in, and shared legacy exports are no longer exposed. Export any needed anonymous entries from the previous app before upgrading.

Local storage is accessible to someone with access to the browser profile. Authentication controls the app's normal UI, not local file access. If timesheets move into Supabase later, enforce access in the database using Row Level Security and policies tied to `auth.uid()`.

## Verify

- Without configuration, confirm the setup message appears and the timesheet stays hidden.
- Sign in with a provisioned staff account, edit a shift, reload, and verify the session and entries restore.
- Sign out, sign in as a second staff member, and verify the first member's entries are not displayed.
- Check invalid credentials, a sign-in email callback, expired sessions, and sign out.

Reference: [Supabase password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword) and [email OTP / magic links](https://supabase.com/docs/reference/javascript/auth-signinwithotp).
